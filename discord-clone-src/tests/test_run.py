"""Backend behaviour and security tests for run.py."""
from __future__ import annotations

import json

import pytest
import requests

from tests.conftest import SRC_DIR  # noqa: F401  (ensures the package is importable)


# ---------------------------------------------------------------------------
# Health + SPA serving
# ---------------------------------------------------------------------------

def test_healthz_reports_shape(client):
    run, c = client
    res = c.get("/healthz")
    assert res.status_code == 200
    body = res.get_json()
    assert body["status"] == "ok"
    assert body["frontendBuilt"] is True
    assert body["buildStatus"] in {"ready", "idle", "building", "checking", "error"}
    assert body["oauthConfigured"] is False


def test_root_serves_the_spa(client):
    _, c = client
    res = c.get("/")
    assert res.status_code == 200
    assert b"SPA_INDEX" in res.data


def test_unknown_client_route_falls_back_to_the_spa(client):
    _, c = client
    res = c.get("/some/client/route")
    assert res.status_code == 200
    assert b"SPA_INDEX" in res.data


def test_real_asset_is_served(client):
    _, c = client
    res = c.get("/asset.txt")
    assert res.status_code == 200
    assert res.data == b"ASSET_BODY"


def test_missing_build_returns_a_self_refreshing_page(make_app):
    run = make_app(with_dist=False)
    c = run.app.test_client()
    res = c.get("/")
    assert res.status_code in (500, 503)
    assert res.headers.get("Retry-After") == "3" or b"build" in res.data.lower()


# ---------------------------------------------------------------------------
# Path traversal
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "path",
    [
        "/../../etc/passwd",
        "/../../../etc/passwd",
        "/..%2f..%2fetc%2fpasswd",
        "/%2e%2e/%2e%2e/etc/passwd",
        "/....//....//etc/passwd",
        "/asset.txt/../../etc/passwd",
    ],
)
def test_path_traversal_cannot_escape_dist(client, path):
    _, c = client
    res = c.get(path, headers={"Accept": "*/*"})
    # Either the SPA fallback or a 404 — never the contents of a system file.
    assert res.status_code in (200, 404)
    assert b"root:" not in res.data
    assert b"/bin/bash" not in res.data


def test_api_paths_do_not_fall_through_to_the_spa(client):
    _, c = client
    for path in ["/api/unknown", "/auth/unknown", "/api/discord/"]:
        res = c.get(path)
        assert res.status_code in (400, 404, 502)
        assert res.headers.get("Content-Type", "").startswith("application/json")


# ---------------------------------------------------------------------------
# Trusted host handling (previously: X-Forwarded-Host was believed blindly)
# ---------------------------------------------------------------------------

def test_forwarded_host_is_not_trusted_by_default(client):
    _, c = client
    res = c.get("/api/oauth/config", headers={
        "X-Forwarded-Host": "evil.example.com",
        "X-Forwarded-Proto": "https",
    })
    assert res.status_code == 200
    body = res.get_json()
    assert body["enabled"] is False
    uri = body["redirectUri"]
    assert uri is None or "evil.example.com" not in uri


def test_forwarded_host_is_rejected_even_when_oauth_is_configured(make_app):
    run = make_app({
        "DISCORD_CLIENT_ID": "client-id",
        "DISCORD_CLIENT_SECRET": "client-secret",
    })
    c = run.app.test_client()
    res = c.get("/api/oauth/config", headers={"X-Forwarded-Host": "evil.example.com"})
    body = res.get_json()
    # The attacker-supplied host must never reach the redirect URI. Falling back
    # to the request's own (trusted) host is acceptable; echoing theirs is not.
    assert body["redirectUri"] is None or "evil.example.com" not in body["redirectUri"]


def test_no_trusted_host_at_all_disables_oauth(make_app):
    """Host and X-Forwarded-Host both untrusted -> OAuth must fail closed."""
    run = make_app({
        "DISCORD_CLIENT_ID": "client-id",
        "DISCORD_CLIENT_SECRET": "client-secret",
    })
    c = run.app.test_client()
    headers = {"Host": "attacker.example", "X-Forwarded-Host": "attacker.example"}
    body = c.get("/api/oauth/config", headers=headers).get_json()
    assert body["enabled"] is False
    assert body["redirectUri"] is None
    assert "PUBLIC_BASE_URL" in body["warning"]


def test_public_base_url_is_authoritative(make_app):
    run = make_app({
        "PUBLIC_BASE_URL": "https://app.example.com",
        "DISCORD_CLIENT_ID": "client-id",
        "DISCORD_CLIENT_SECRET": "client-secret",
    })
    c = run.app.test_client()
    body = c.get("/api/oauth/config", headers={"X-Forwarded-Host": "evil.example.com"}).get_json()
    assert body["enabled"] is True
    assert body["redirectUri"] == "https://app.example.com/auth/discord/callback"


def test_explicit_redirect_uri_wins(make_app):
    run = make_app({
        "DISCORD_REDIRECT_URI": "https://fixed.example.com/cb",
        "DISCORD_CLIENT_ID": "client-id",
        "DISCORD_CLIENT_SECRET": "client-secret",
    })
    c = run.app.test_client()
    body = c.get("/api/oauth/config").get_json()
    assert body["redirectUri"] == "https://fixed.example.com/cb"


def test_trusted_hosts_allows_a_listed_forwarded_host(make_app):
    run = make_app({
        "TRUSTED_HOSTS": "app.example.com",
        "DISCORD_CLIENT_ID": "client-id",
        "DISCORD_CLIENT_SECRET": "client-secret",
    })
    c = run.app.test_client()
    body = c.get("/api/oauth/config", headers={
        "X-Forwarded-Host": "app.example.com",
        "X-Forwarded-Proto": "https",
    }).get_json()
    assert body["enabled"] is True
    assert body["redirectUri"] == "https://app.example.com/auth/discord/callback"


def test_localhost_is_trusted_for_local_development(client):
    _, c = client
    body = c.get("/api/oauth/config", headers={"X-Forwarded-Host": "localhost:5173"}).get_json()
    assert body["redirectUri"] is None or "localhost:5173" in body["redirectUri"]


# ---------------------------------------------------------------------------
# OAuth2 login / callback
# ---------------------------------------------------------------------------

def test_login_route_fails_closed_without_credentials(client):
    _, c = client
    res = c.get("/auth/discord/login")
    assert res.status_code == 503
    assert b"DISCORD_CLIENT_ID" in res.data


def test_login_route_fails_closed_without_a_trusted_url(make_app):
    run = make_app({
        "DISCORD_CLIENT_ID": "client-id",
        "DISCORD_CLIENT_SECRET": "client-secret",
    })
    c = run.app.test_client()
    res = c.get("/auth/discord/login", headers={
        "Host": "attacker.example",
        "X-Forwarded-Host": "evil.example.com",
    })
    assert res.status_code == 503
    assert b"PUBLIC_BASE_URL" in res.data
    assert b"attacker.example" not in res.data
    assert b"evil.example.com" not in res.data


def test_login_redirects_to_discord_with_state_cookie(make_app):
    run = make_app({
        "PUBLIC_BASE_URL": "https://app.example.com",
        "DISCORD_CLIENT_ID": "client-id",
        "DISCORD_CLIENT_SECRET": "client-secret",
    })
    c = run.app.test_client()
    res = c.get("/auth/discord/login")
    assert res.status_code == 302
    location = res.headers["Location"]
    assert location.startswith("https://discord.com/oauth2/authorize?")
    assert "client_id=client-id" in location
    assert "response_type=code" in location
    assert "state=" in location
    assert "redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fdiscord%2Fcallback" in location

    cookies = res.headers.getlist("Set-Cookie")
    assert any("discord_oauth_state=" in ck for ck in cookies)
    assert any("HttpOnly" in ck for ck in cookies)


@pytest.mark.parametrize(
    "raw_error, expected",
    [
        ("access_denied", "access_denied"),
        ("server_error", "server_error"),
        ('"><script>alert(1)</script>', "authorization_failed"),
        ("a" * 500, "authorization_failed"),
        ("../../etc/passwd", "authorization_failed"),
    ],
)
def test_callback_error_param_is_never_reflected_verbatim(client, raw_error, expected):
    _, c = client
    res = c.get("/auth/discord/callback", query_string={"error": raw_error})
    assert res.status_code == 302
    location = res.headers["Location"]
    assert location == f"/?oauth_error={expected}"
    assert "<script>" not in location


def test_callback_rejects_a_missing_state(client):
    _, c = client
    res = c.get("/auth/discord/callback", query_string={"code": "abc"})
    assert res.status_code == 302
    assert res.headers["Location"] == "/?oauth_error=invalid_state"


def test_callback_rejects_a_mismatched_state(client):
    _, c = client
    c.set_cookie("discord_oauth_state", "expected-state")
    c.set_cookie("discord_oauth_state_ts", "9999999999")
    res = c.get("/auth/discord/callback", query_string={"code": "abc", "state": "other-state"})
    assert res.headers["Location"] == "/?oauth_error=invalid_state"


def test_callback_rejects_an_expired_state(make_app):
    run = make_app({"OAUTH_STATE_MAX_AGE": "60"})
    c = run.app.test_client()
    c.set_cookie("discord_oauth_state", "s")
    c.set_cookie("discord_oauth_state_ts", "1000000000")  # far in the past
    res = c.get("/auth/discord/callback", query_string={"code": "abc", "state": "s"})
    assert res.headers["Location"] == "/?oauth_error=invalid_state"


def test_callback_rejects_a_non_numeric_state_timestamp(client):
    _, c = client
    c.set_cookie("discord_oauth_state", "s")
    c.set_cookie("discord_oauth_state_ts", "not-a-number")
    res = c.get("/auth/discord/callback", query_string={"code": "abc", "state": "s"})
    assert res.headers["Location"] == "/?oauth_error=invalid_state"


# ---------------------------------------------------------------------------
# OAuth2 token handoff (signed cookie, never a query string)
# ---------------------------------------------------------------------------

def test_exchange_rejects_a_missing_cookie(client):
    _, c = client
    res = c.post("/api/oauth/exchange")
    assert res.status_code == 400
    assert res.get_json()["error"] == "no_pending_authorization"


def test_exchange_rejects_a_tampered_cookie(client):
    run, c = client
    good = run._encode_oauth_token("secret-access-token")
    c.set_cookie("discord_oauth_handoff", good[:-2] + "xx")
    res = c.post("/api/oauth/exchange")
    assert res.status_code == 400
    assert res.get_json()["error"] == "handoff_expired_or_invalid"
    assert b"secret-access-token" not in res.data


def test_exchange_rejects_a_forged_plaintext_cookie(client):
    _, c = client
    c.set_cookie("discord_oauth_handoff", "secret-access-token")
    res = c.post("/api/oauth/exchange")
    assert res.status_code == 400


def test_exchange_returns_the_token_and_clears_the_cookie(client):
    run, c = client
    signed = run._encode_oauth_token("real-access-token")
    c.set_cookie("discord_oauth_handoff", signed)
    res = c.post("/api/oauth/exchange")
    assert res.status_code == 200
    assert res.get_json() == {"ok": True, "accessToken": "real-access-token"}
    # The cookie must be cleared so the token cannot be collected twice.
    assert any("discord_oauth_handoff=;" in ck for ck in res.headers.getlist("Set-Cookie"))


def test_exchange_rejects_an_expired_handoff(make_app):
    run = make_app({"OAUTH_HANDOFF_MAX_AGE": "-1"})
    signed = run._encode_oauth_token("token")
    # max_age=0 means "already expired" to URLSafeTimedSerializer.
    assert run._decode_oauth_token(signed, max_age=-1) is None
    c = run.app.test_client()
    c.set_cookie("discord_oauth_handoff", signed)
    assert c.post("/api/oauth/exchange").status_code == 400


def test_handoff_cookie_is_scoped_to_the_exchange_path(make_app):
    run = make_app({
        "PUBLIC_BASE_URL": "https://app.example.com",
        "DISCORD_CLIENT_ID": "cid",
        "DISCORD_CLIENT_SECRET": "csec",
    })

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"access_token": "tok", "expires_in": 604800}

    original = run.requests.post
    run.requests.post = lambda *a, **k: FakeResponse()
    try:
        c = run.app.test_client()
        c.set_cookie("discord_oauth_state", "st")
        c.set_cookie("discord_oauth_state_ts", "9999999999")
        res = c.get("/auth/discord/callback", query_string={"code": "c", "state": "st"})
    finally:
        run.requests.post = original

    assert res.status_code == 302
    # The token must NOT be in the URL.
    assert res.headers["Location"] == "/?oauth_pending=1"
    assert "tok" not in res.headers["Location"]

    cookie_header = [ck for ck in res.headers.getlist("Set-Cookie") if "discord_oauth_handoff=" in ck]
    assert cookie_header, "expected a handoff cookie"
    assert "HttpOnly" in cookie_header[0]
    assert "Path=/api/oauth/exchange" in cookie_header[0]


# ---------------------------------------------------------------------------
# Discord proxy
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "endpoint",
    [
        "../etc/passwd",
        "..%2f..%2fetc",
        "/leading-slash",
        "https://evil.example.com/x",
        "//evil.example.com/x",
        "@evil.example.com/x",
        "users/../../secrets",
    ],
)
def test_proxy_rejects_endpoints_that_could_escape_the_api_base(client, endpoint):
    _, c = client
    res = c.get(f"/api/discord/{endpoint}")
    # Werkzeug rejects some of these during routing (404); the rest are caught by
    # _is_safe_endpoint (400). Either way the request must not be proxied.
    assert res.status_code in (400, 404)
    if res.status_code == 400:
        assert res.get_json()["message"] == "Invalid Discord API endpoint."
    assert b"evil.example.com" not in res.data
    assert b"root:" not in res.data


@pytest.mark.parametrize(
    "endpoint",
    ["users/@me", "channels/123/messages", "guilds/123/members", "oauth2/applications/@me"],
)
def test_is_safe_endpoint_accepts_real_discord_paths(client, endpoint):
    run, _ = client
    assert run._is_safe_endpoint(endpoint) is True


def test_proxy_forwards_and_returns_upstream_body(client, monkeypatch):
    run, c = client

    class Upstream:
        status_code = 200
        content = b'{"id":"1","username":"bot"}'
        headers = {"Content-Type": "application/json", "X-Ratelimit-Remaining": "9"}

    captured = {}

    def fake_request(**kwargs):
        captured.update(kwargs)
        return Upstream()

    monkeypatch.setattr(run.requests, "request", fake_request)

    res = c.get(
        "/api/discord/users/@me",
        headers={"Authorization": "Bot tok", "User-Agent": "Mozilla/5.0 (browser)"},
    )
    assert res.status_code == 200
    assert res.get_json() == {"id": "1", "username": "bot"}
    assert res.headers["X-Ratelimit-Remaining"] == "9"

    # The upstream URL must stay on Discord.
    assert captured["url"].startswith(run.DISCORD_API_BASE)
    assert captured["url"].endswith("/users/@me")
    # Authorization is forwarded; the browser User-Agent is not.
    assert captured["headers"]["Authorization"] == "Bot tok"
    assert "Mozilla" not in captured["headers"]["User-Agent"]
    assert captured["headers"]["User-Agent"].startswith("DiscordBot")
    # Hop-by-hop headers are dropped.
    assert "Host" not in captured["headers"]
    assert "Content-Length" not in captured["headers"]


def test_proxy_failure_does_not_leak_internals(client, monkeypatch):
    run, c = client

    def boom(**kwargs):
        raise requests.ConnectionError(
            "HTTPSConnectionPool(host='discord.com', port=443): Max retries exceeded "
            "(Caused by SSLError(SSLZeroReturnError(6, 'TLS/SSL connection has been closed (_ssl.c:992)')))"
        )

    monkeypatch.setattr(run.requests, "request", boom)
    res = c.get("/api/discord/users/@me")
    assert res.status_code == 502
    body = res.get_data(as_text=True)
    assert "SSLZeroReturnError" not in body
    assert "_ssl.c" not in body
    assert "HTTPSConnectionPool" not in body
    assert "Discord API proxy request failed." in body


def test_options_is_answered_locally_without_proxying(client, monkeypatch):
    run, c = client

    def fail(**kwargs):
        raise AssertionError(f"proxy reached upstream for {kwargs.get('method')}")

    monkeypatch.setattr(run.requests, "request", fail)
    # Flask synthesises the OPTIONS response from the routing table, so CORS
    # preflight never reaches Discord.
    assert c.options("/api/discord/users/@me").status_code == 200


def test_trace_is_refused_and_not_proxied(client, monkeypatch):
    run, c = client

    def fail(**kwargs):
        raise AssertionError("TRACE must never be proxied")

    monkeypatch.setattr(run.requests, "request", fail)
    assert c.open("/api/discord/users/@me", method="TRACE").status_code in (404, 405)


def test_head_may_proxy(client, monkeypatch):
    """Flask derives HEAD from the GET rule and does invoke the view.

    Discord supports HEAD on its REST routes, so proxying it is correct; the body
    is discarded by the WSGI layer.
    """
    run, c = client
    seen = {}

    class Upstream:
        status_code = 200
        content = b""
        headers = {"Content-Type": "application/json"}

    def fake(**kwargs):
        seen["method"] = kwargs["method"]
        return Upstream()

    monkeypatch.setattr(run.requests, "request", fake)
    assert c.head("/api/discord/users/@me").status_code == 200
    assert seen["method"] == "HEAD"


# ---------------------------------------------------------------------------
# Headers and CORS
# ---------------------------------------------------------------------------

def test_security_headers_are_present(client):
    _, c = client
    res = c.get("/")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Referrer-Policy"] == "no-referrer"
    csp = res.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    # The CDN must be allowed or avatars/emoji would break.
    assert "cdn.discordapp.com" in csp
    # The gateway must be allowed or realtime updates would break.
    assert "wss://gateway.discord.gg" in csp


def test_no_wildcard_cors_by_default(client):
    _, c = client
    res = c.get("/api/oauth/config", headers={"Origin": "https://evil.example.com"})
    assert res.headers.get("Access-Control-Allow-Origin") in (None, "")


def test_wildcard_cors_is_opt_in(make_app):
    """CORS_ORIGINS=* must be set explicitly; flask-cors then reflects the Origin."""
    run = make_app({"CORS_ORIGINS": "*"})
    c = run.app.test_client()
    res = c.get("/api/oauth/config", headers={"Origin": "https://any.example.com"})
    # flask-cors echoes the requesting origin rather than a literal "*" so that
    # credentialed requests work. Either form means the origin was allowed.
    assert res.headers.get("Access-Control-Allow-Origin") in ("*", "https://any.example.com")


def test_specific_origins_are_honoured(make_app):
    run = make_app({"CORS_ORIGINS": "https://good.example.com"})
    c = run.app.test_client()
    res = c.get("/api/oauth/config", headers={"Origin": "https://good.example.com"})
    assert res.headers.get("Access-Control-Allow-Origin") == "https://good.example.com"


def test_upload_limit_is_configured(client):
    run, _ = client
    assert run.app.config["MAX_CONTENT_LENGTH"] == 32 * 1024 * 1024


def test_upload_limit_is_configurable(make_app):
    run = make_app({"MAX_UPLOAD_MB": "8"})
    assert run.app.config["MAX_CONTENT_LENGTH"] == 8 * 1024 * 1024


def test_oversized_upload_is_rejected_with_json(client):
    run, c = client
    res = c.post(
        "/api/discord/channels/1/messages",
        data={"payload_json": "x" * (run.app.config["MAX_CONTENT_LENGTH"] + 10)},
        content_type="multipart/form-data",
    )
    assert res.status_code == 413
    assert res.get_json()["message"].startswith("Upload too large.")


def test_logout_revokes_and_reports(client, monkeypatch):
    run, c = client
    calls = {}

    class Resp:
        status_code = 200

        def raise_for_status(self):
            return None

    def fake_post(url, **kwargs):
        calls["url"] = url
        calls["data"] = kwargs.get("data")
        return Resp()

    monkeypatch.setattr(run.requests, "post", fake_post)

    # Without OAuth credentials configured, revocation is skipped but the call
    # still succeeds and clears cookies.
    res = c.post("/auth/discord/logout", json={"accessToken": "tok"})
    assert res.status_code == 200
    assert res.get_json()["ok"] is True
    assert res.get_json()["revoked"] is False
    assert "url" not in calls


def test_logout_calls_discord_revocation_when_configured(make_app, monkeypatch):
    run = make_app({
        "DISCORD_CLIENT_ID": "cid",
        "DISCORD_CLIENT_SECRET": "csec",
    })
    c = run.app.test_client()
    calls = {}

    class Resp:
        status_code = 200

    def fake_post(url, **kwargs):
        calls["url"] = url
        calls["data"] = kwargs.get("data")
        return Resp()

    monkeypatch.setattr(run.requests, "post", fake_post)
    res = c.post("/auth/discord/logout", json={"accessToken": "tok"})
    assert res.get_json()["revoked"] is True
    assert calls["url"].endswith("/oauth2/token/revoke")
    assert calls["data"] == {"token": "tok"}


def test_logout_survives_a_revocation_failure(make_app, monkeypatch):
    run = make_app({
        "DISCORD_CLIENT_ID": "cid",
        "DISCORD_CLIENT_SECRET": "csec",
    })
    c = run.app.test_client()

    def boom(*a, **k):
        raise requests.ConnectionError("offline")

    monkeypatch.setattr(run.requests, "post", boom)
    res = c.post("/auth/discord/logout", json={"accessToken": "tok"})
    assert res.status_code == 200
    assert res.get_json() == {"ok": True, "revoked": False}


# ---------------------------------------------------------------------------
# Secret key handling
# ---------------------------------------------------------------------------

def test_secret_key_comes_from_the_environment(make_app):
    run = make_app({"SECRET_KEY": "explicit-key"})
    assert run.app.secret_key == "explicit-key"


def test_secret_key_file_is_gitignored():
    """The generated key must never be committable."""
    root_ignore = (SRC_DIR.parent / ".gitignore").read_text(encoding="utf-8")
    app_ignore = (SRC_DIR / ".gitignore").read_text(encoding="utf-8")
    combined = root_ignore + app_ignore
    assert ".flask_secret_key" in combined or ".env" in combined


# ---------------------------------------------------------------------------
# GET /api/app-info — attribution for the UI and the bot's Discord presence
# ---------------------------------------------------------------------------

APP_INFO_KEYS = {
    "name",
    "version",
    "githubUrl",
    "siteUrl",
    "githubDisplay",
    "siteDisplay",
    "presenceText",
    "presenceEditable",
}


def test_app_info_reports_the_documented_shape(client):
    run, c = client
    res = c.get("/api/app-info")
    assert res.status_code == 200
    assert set(res.get_json()) == APP_INFO_KEYS


def test_app_info_defaults_point_at_the_real_repository_and_deployment(client):
    run, c = client
    body = res_body = c.get("/api/app-info").get_json()
    assert body["githubUrl"] == "https://github.com/zexyomeme-svg/Discord-clone"
    assert body["siteUrl"] == "https://discord-clone-render.onrender.com"
    assert body["presenceEditable"] is True
    assert res_body["version"] == run.APP_VERSION


def test_display_urls_strip_the_scheme_for_text_only_contexts(client):
    run, c = client
    body = c.get("/api/app-info").get_json()
    assert body["githubDisplay"] == "github.com/zexyomeme-svg/Discord-clone"
    assert body["siteDisplay"] == "discord-clone-render.onrender.com"


def test_display_urls_strip_a_trailing_slash(make_app):
    run = make_app({"APP_GITHUB_URL": "https://github.com/o/r/"})
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["githubDisplay"] == "github.com/o/r"


@pytest.mark.parametrize(
    "env",
    [
        {"APP_NAME": "Renamed"},
        {"APP_VERSION": "9.9.9"},
        {"APP_GITHUB_URL": "https://github.com/someone/else"},
        {"APP_SITE_URL": "https://example.com"},
    ],
)
def test_app_info_is_configurable_from_the_environment(make_app, env):
    """Every field must be overridable at runtime, without a rebuild."""
    run = make_app(env)
    body = run.app.test_client().get("/api/app-info").get_json()
    value = next(iter(env.values()))
    assert value in body.values() or any(
        isinstance(v, str) and v.startswith(value.rstrip("/").replace("https://", ""))
        for v in body.values()
    )


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
        "file:///etc/passwd",
        "vbscript:msgbox(1)",
        "//evil.example/no-scheme",
        "https://",
        "https://github.com@evil.example/zexyomeme-svg/Discord-clone",
        "https://user:pass@github.com/o/r",
    ],
)
def test_unsafe_urls_are_never_published_as_hrefs(make_app, url):
    """These become `href`s in the browser, so a bad env value is an XSS vector."""
    run = make_app({"APP_GITHUB_URL": url, "APP_SITE_URL": ""})
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["githubUrl"] is None
    assert body["githubDisplay"] is None
    assert "javascript" not in json.dumps(body).lower()


def test_safe_urls_survive_validation(make_app):
    run = make_app(
        {
            "APP_GITHUB_URL": "https://github.com/o/r",
            "APP_SITE_URL": "http://127.0.0.1:8000",
        }
    )
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["githubUrl"] == "https://github.com/o/r"
    assert body["siteUrl"] == "http://127.0.0.1:8000"


def test_site_url_falls_back_to_public_base_url(make_app):
    """A fork that configured OAuth advertises its own site, not this one.

    PUBLIC_BASE_URL is already required to be the public address of the service,
    so it is the best available default and keeps the two from disagreeing.
    """
    run = make_app({"PUBLIC_BASE_URL": "https://my-fork.onrender.com"})
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["siteUrl"] == "https://my-fork.onrender.com"
    assert body["siteDisplay"] == "my-fork.onrender.com"
    assert "discord-clone-render.onrender.com" not in body["presenceText"]


def test_explicit_site_url_beats_public_base_url(make_app):
    run = make_app(
        {
            "PUBLIC_BASE_URL": "https://backend.internal",
            "APP_SITE_URL": "https://public-site.example",
        }
    )
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["siteUrl"] == "https://public-site.example"


def test_presence_text_names_the_repo_and_the_deployment(client):
    run, c = client
    text = c.get("/api/app-info").get_json()["presenceText"]
    assert text == (
        "Disclone · github.com/zexyomeme-svg/Discord-clone"
        " · discord-clone-render.onrender.com"
    )
    assert len(text) <= run.PRESENCE_TEXT_MAX


def test_presence_text_drops_the_site_when_both_would_not_fit(make_app):
    """The repo is the thing being promoted, so it loses the site, not itself."""
    long_path = "a" * 70
    run = make_app(
        {
            "APP_GITHUB_URL": f"https://github.com/{long_path}",
            "APP_SITE_URL": "https://example.com",
        }
    )
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["presenceText"] == f"Disclone · github.com/{long_path}"
    assert "example.com" not in body["presenceText"]
    assert len(body["presenceText"]) <= run.PRESENCE_TEXT_MAX


@pytest.mark.parametrize("extra", ["", "x" * 50, "x" * 500])
def test_presence_text_never_exceeds_the_activity_state_limit(make_app, extra):
    """Discord's activity `state` is capped; the bot must not send more."""
    run = make_app(
        {
            "APP_NAME": "Disclone" + extra,
            "APP_GITHUB_URL": "https://github.com/o/r",
            "APP_SITE_URL": "https://example.com",
        }
    )
    body = run.app.test_client().get("/api/app-info").get_json()
    assert len(body["presenceText"]) <= run.PRESENCE_TEXT_MAX


def test_explicit_presence_text_pins_the_status(make_app):
    run = make_app({"APP_PRESENCE_TEXT": "Handwritten status"})
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["presenceText"] == "Handwritten status"
    assert body["presenceEditable"] is False


def test_explicit_presence_text_is_still_truncated(make_app):
    run = make_app({"APP_PRESENCE_TEXT": "y" * 300})
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["presenceText"] == "y" * run.PRESENCE_TEXT_MAX
    assert len(body["presenceText"]) == run.PRESENCE_TEXT_MAX


def test_presence_text_is_empty_when_the_repo_url_is_unusable(make_app):
    """No repo to name -> no status to broadcast, rather than a stray separator."""
    run = make_app({"APP_GITHUB_URL": "javascript:alert(1)"})
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["presenceText"] == ""


def test_app_info_leaks_no_secrets(client):
    run, c = client
    body = c.get("/api/app-info").get_json()
    blob = json.dumps(body).lower()
    for forbidden in ("secret", "token", "client_id", "cookie"):
        assert forbidden not in blob


# ---------------------------------------------------------------------------
# Hosting platform detection — the same code must work on Render and Railway
# ---------------------------------------------------------------------------

def test_platform_is_local_when_no_host_variables_are_present(make_app):
    run = make_app()
    assert run.PLATFORM == "local"
    assert run.PUBLIC_BASE_URL == ""
    assert run.PUBLIC_BASE_URL_SOURCE == "unset"


def test_render_is_detected_and_supplies_the_public_url(make_app):
    run = make_app({
        "RENDER": "true",
        "RENDER_SERVICE_ID": "srv-abc123",
        "RENDER_EXTERNAL_URL": "https://myapp.onrender.com",
    })
    assert run.PLATFORM == "render"
    assert run.PUBLIC_BASE_URL == "https://myapp.onrender.com"
    assert run.PUBLIC_BASE_URL_SOURCE == "render-injected"


def test_render_is_detected_from_the_service_id_alone(make_app):
    """RENDER=true is documented, but RENDER_SERVICE_ID is the sturdier signal."""
    run = make_app({"RENDER_SERVICE_ID": "srv-abc123"})
    assert run.PLATFORM == "render"


def test_railway_is_detected_and_gains_an_https_scheme(make_app):
    """Railway injects a bare host, not a URL — the scheme has to be added."""
    run = make_app({
        "RAILWAY_SERVICE_NAME": "disclone",
        "RAILWAY_PROJECT_ID": "proj-1",
        "RAILWAY_PUBLIC_DOMAIN": "disclone-production.up.railway.app",
        "RAILWAY_PRIVATE_DOMAIN": "disclone.railway.internal",
    })
    assert run.PLATFORM == "railway"
    assert run.PUBLIC_BASE_URL == "https://disclone-production.up.railway.app"
    assert run.PUBLIC_BASE_URL_SOURCE == "railway-injected"


def test_railway_without_a_public_domain_fails_closed(make_app):
    """No generated domain means no public URL; OAuth must not invent one."""
    run = make_app({
        "RAILWAY_SERVICE_NAME": "disclone",
        "RAILWAY_PRIVATE_DOMAIN": "disclone.railway.internal",
        "DISCORD_CLIENT_ID": "cid",
        "DISCORD_CLIENT_SECRET": "sec",
    })
    assert run.PLATFORM == "railway"
    assert run.PUBLIC_BASE_URL == ""
    # The test client otherwise defaults Host to `localhost`, which is trusted
    # on purpose so local development needs no configuration. Send the host a
    # real Railway request would carry.
    res = run.app.test_client().get(
        "/api/oauth/config",
        headers={"Host": "disclone-production.up.railway.app"},
    )
    body = res.get_json()
    assert body["enabled"] is False
    assert body["redirectUri"] is None
    # The warning has to say what to actually do on this platform.
    assert "Networking" in body["warning"]
    assert "RAILWAY_PUBLIC_DOMAIN" in body["warning"]


def test_railway_private_domain_is_never_used_as_a_public_url(make_app):
    """The .railway.internal name is not reachable from a browser."""
    run = make_app({
        "RAILWAY_PRIVATE_DOMAIN": "disclone.railway.internal",
        "RAILWAY_SERVICE_NAME": "disclone",
    })
    assert "railway.internal" not in run.PUBLIC_BASE_URL


def test_explicit_public_base_url_beats_the_platform_value(make_app):
    """A custom domain or preview environment is the operator's call."""
    run = make_app({
        "PUBLIC_BASE_URL": "https://chat.example.com",
        "RENDER": "true",
        "RENDER_EXTERNAL_URL": "https://myapp.onrender.com",
    })
    assert run.PUBLIC_BASE_URL == "https://chat.example.com"
    assert run.PUBLIC_BASE_URL_SOURCE == "PUBLIC_BASE_URL"


def test_custom_domain_via_railway_public_domain(make_app):
    run = make_app({
        "RAILWAY_PUBLIC_DOMAIN": "chat.example.com",
        "RAILWAY_SERVICE_NAME": "disclone",
    })
    assert run.PUBLIC_BASE_URL == "https://chat.example.com"


@pytest.mark.parametrize(
    "value",
    ["javascript:alert(1)", "file:///etc/passwd", "//myapp.onrender.com", "data:text/html,x"],
)
def test_a_non_http_scheme_injected_as_the_public_url_is_rejected(make_app, value):
    """These become OAuth redirect bases, so anything but http(s) is dropped."""
    run = make_app({"RENDER": "true", "RENDER_EXTERNAL_URL": value})
    assert run.PUBLIC_BASE_URL == ""
    assert run.PUBLIC_BASE_URL_SOURCE == "unset"


def test_other_platforms_are_named_but_do_not_invent_a_url(make_app):
    assert make_app({"FLY_APP_NAME": "disclone-fly"}).PLATFORM == "fly"
    assert make_app({"DYNO": "web.1"}).PLATFORM == "heroku"
    assert make_app({"FLY_APP_NAME": "x"}).PUBLIC_BASE_URL == ""


def test_healthz_reports_the_platform_and_url_source(make_app):
    run = make_app({
        "RENDER": "true",
        "RENDER_EXTERNAL_URL": "https://myapp.onrender.com",
    })
    body = run.app.test_client().get("/healthz").get_json()
    assert body["platform"] == "render"
    assert body["publicBaseUrl"] == "https://myapp.onrender.com"
    assert body["publicBaseUrlSource"] == "render-injected"


def test_healthz_reports_a_null_url_when_none_is_known(make_app):
    body = make_app().app.test_client().get("/healthz").get_json()
    assert body["publicBaseUrl"] is None
    assert body["platform"] == "local"


def test_oauth_redirect_uri_is_derived_on_render(make_app):
    run = make_app({
        "RENDER": "true",
        "RENDER_EXTERNAL_URL": "https://myapp.onrender.com",
        "DISCORD_CLIENT_ID": "cid",
        "DISCORD_CLIENT_SECRET": "sec",
    })
    body = run.app.test_client().get("/api/oauth/config").get_json()
    assert body["enabled"] is True
    assert body["redirectUri"] == "https://myapp.onrender.com/auth/discord/callback"


def test_oauth_redirect_uri_is_derived_on_railway(make_app):
    run = make_app({
        "RAILWAY_PUBLIC_DOMAIN": "disclone-production.up.railway.app",
        "RAILWAY_SERVICE_NAME": "disclone",
        "DISCORD_CLIENT_ID": "cid",
        "DISCORD_CLIENT_SECRET": "sec",
    })
    body = run.app.test_client().get("/api/oauth/config").get_json()
    assert body["enabled"] is True
    assert body["redirectUri"] == (
        "https://disclone-production.up.railway.app/auth/discord/callback"
    )


def test_attribution_follows_the_platform_url(make_app):
    """A Railway deploy must advertise Railway, not this project's Render URL."""
    run = make_app({
        "RAILWAY_PUBLIC_DOMAIN": "disclone-production.up.railway.app",
        "RAILWAY_SERVICE_NAME": "disclone",
    })
    body = run.app.test_client().get("/api/app-info").get_json()
    assert body["siteUrl"] == "https://disclone-production.up.railway.app"
    assert body["siteDisplay"] == "disclone-production.up.railway.app"
    assert "onrender.com" not in body["presenceText"]


def test_a_forwarded_host_still_cannot_override_the_platform_url(make_app):
    run = make_app({
        "RENDER": "true",
        "RENDER_EXTERNAL_URL": "https://myapp.onrender.com",
        "DISCORD_CLIENT_ID": "cid",
        "DISCORD_CLIENT_SECRET": "sec",
    })
    res = run.app.test_client().get("/auth/discord/login", headers={
        "Host": "attacker.example",
        "X-Forwarded-Host": "evil.example.com",
    })
    assert res.status_code in (302, 503)
    location = res.headers.get("Location", "")
    assert "evil.example.com" not in location
    assert "attacker.example" not in location
    if location:
        assert "myapp.onrender.com" in location


# ---------------------------------------------------------------------------
# SECRET_KEY resolution across Gunicorn workers
# ---------------------------------------------------------------------------

def test_explicit_secret_key_always_wins(make_app, tmp_path):
    run = make_app({"SECRET_KEY": "explicit"})
    assert run.app.secret_key == "explicit"


def test_an_existing_key_file_is_reused_not_regenerated(make_app, tmp_path, monkeypatch):
    """A restart must not invalidate an in-flight OAuth handoff cookie."""
    # Empty SECRET_KEY, otherwise the explicit-value branch returns first and
    # this test would pass without exercising the file logic at all.
    run = make_app({"SECRET_KEY": ""})
    key_file = tmp_path / ".flask_secret_key"
    key_file.write_text("persisted-key", encoding="utf-8")
    monkeypatch.setattr(run, "SECRET_FILE", key_file)
    monkeypatch.setattr(run, "FALLBACK_SECRET_FILE", tmp_path / "fallback")
    assert run._resolve_secret_key() == "persisted-key"


def test_a_generated_key_is_persisted_for_other_workers(make_app, tmp_path, monkeypatch):
    run = make_app({"SECRET_KEY": ""})
    key_file = tmp_path / ".flask_secret_key"
    monkeypatch.setattr(run, "SECRET_FILE", key_file)
    monkeypatch.setattr(run, "FALLBACK_SECRET_FILE", tmp_path / "fallback")

    first = run._resolve_secret_key()
    assert first
    assert key_file.read_text(encoding="utf-8").strip() == first
    # A second worker starting later reads the same key rather than making one.
    assert run._resolve_secret_key() == first


def test_concurrent_workers_converge_on_one_key(make_app, tmp_path, monkeypatch):
    """The actual multi-worker bug: two workers claiming at once.

    os.replace() makes each write atomic and the post-write re-read makes both
    callers return whatever landed last, so the OAuth cookie signed by one
    worker still verifies in the other.
    """
    run = make_app()
    key_file = tmp_path / ".flask_secret_key"
    monkeypatch.setattr(run, "SECRET_FILE", key_file)
    monkeypatch.setattr(run, "FALLBACK_SECRET_FILE", tmp_path / "fallback")

    run._claim_secret_file(key_file, "worker-a-key")
    second = run._claim_secret_file(key_file, "worker-b-key")

    assert second == "worker-b-key"
    assert key_file.read_text(encoding="utf-8").strip() == second
    # And a later read agrees with it.
    assert run._read_secret(key_file) == second


def test_an_unwritable_app_dir_falls_back_to_a_shared_runtime_dir(
    make_app, tmp_path, monkeypatch
):
    """Container images are frequently read-only outside /tmp.

    Every worker in one container shares /tmp, which is exactly what a shared
    signing key needs, so the fallback keeps multi-worker OAuth working on a
    read-only image instead of degrading to per-process keys.
    """
    run = make_app({"SECRET_KEY": ""})

    # A path whose parent is a regular file can never be created.
    blocker = tmp_path / "read-only-app-dir"
    blocker.write_text("not a directory", encoding="utf-8")
    unwritable = blocker / ".flask_secret_key"

    fallback = tmp_path / "runtime" / "disclone_flask_secret_key"
    monkeypatch.setattr(run, "SECRET_FILE", unwritable)
    monkeypatch.setattr(run, "FALLBACK_SECRET_FILE", fallback)

    key = run._resolve_secret_key()
    assert key and len(key) >= 32
    assert not unwritable.exists()
    assert fallback.read_text(encoding="utf-8").strip() == key


def test_a_second_worker_reuses_the_fallback_key(make_app, tmp_path, monkeypatch):
    """The fallback must be shared, not per-process."""
    run = make_app({"SECRET_KEY": ""})
    blocker = tmp_path / "read-only-app-dir"
    blocker.write_text("not a directory", encoding="utf-8")
    fallback = tmp_path / "runtime" / "disclone_flask_secret_key"
    monkeypatch.setattr(run, "SECRET_FILE", blocker / ".flask_secret_key")
    monkeypatch.setattr(run, "FALLBACK_SECRET_FILE", fallback)

    first = run._resolve_secret_key()
    assert first and len(first) >= 32
    assert run._resolve_secret_key() == first
    assert fallback.read_text(encoding="utf-8").strip() == first


def test_claim_secret_file_reports_failure_rather_than_raising(make_app, tmp_path):
    run = make_app()
    # A path whose parent is a regular file cannot be created.
    blocker = tmp_path / "blocker"
    blocker.write_text("x", encoding="utf-8")
    impossible = blocker / "sub" / "key"
    assert run._claim_secret_file(impossible, "candidate") is None
    assert run._read_secret(impossible) is None
