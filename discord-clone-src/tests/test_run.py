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
