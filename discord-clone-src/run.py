"""Render-ready Flask entrypoint for the Discord clone.

This app serves the Vite production build from ./dist and exposes a small
same-origin proxy at /api/discord/* so the React app can call Discord's REST API
without relying on public CORS proxies.

Frontend install/build/check work lives in `build_frontend.py`. `run.py` starts
the web server immediately and, when the build output is missing, launches that
tool in the background so the site becomes reachable faster. For Render's build
phase, use `python build_frontend.py --build-only`.

Security notes
--------------
* The Discord proxy is same-origin by design and does NOT advertise a wildcard
  CORS origin. Set `CORS_ORIGINS` explicitly if you need to allow other origins.
* Absolute URLs (OAuth redirect URIs) are only ever built from `PUBLIC_BASE_URL`
  or a host listed in `TRUSTED_HOSTS`. Request headers such as
  `X-Forwarded-Host` are not trusted on their own, so the redirect URI cannot be
  pointed at an attacker-controlled domain.
* The OAuth2 access token is handed back to the SPA in a signed, short-lived
  cookie and collected once via POST /api/oauth/exchange. It never appears in a
  URL, so it cannot leak through access logs, browser history or Referer.
* Upstream proxy failures are logged server-side; the client receives a generic
  message instead of the raw exception text.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode, urlsplit

import requests
from flask import Flask, Response, jsonify, make_response, redirect, request, send_from_directory
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
INDEX_FILE = DIST_DIR / "index.html"
SECRET_FILE = BASE_DIR / ".flask_secret_key"

DISCORD_API_BASE = os.environ.get("DISCORD_API_BASE", "https://discord.com/api/v10").rstrip("/")
DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "").strip()
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "").strip()
DISCORD_OAUTH_SCOPES = os.environ.get("DISCORD_OAUTH_SCOPES", "identify email guilds").strip()
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
OAUTH_STATE_MAX_AGE = int(os.environ.get("OAUTH_STATE_MAX_AGE", "600"))
# Lifetime of the one-time OAuth handoff cookie. Short on purpose.
OAUTH_HANDOFF_MAX_AGE = int(os.environ.get("OAUTH_HANDOFF_MAX_AGE", "120"))
REQUEST_TIMEOUT = float(os.environ.get("PROXY_TIMEOUT", "30"))
# Discord allows 25 MB per message upload for bots; 32 MB leaves room for the
# multipart envelope without letting the proxy buffer unbounded bodies.
MAX_UPLOAD_MB = float(os.environ.get("MAX_UPLOAD_MB", "32"))

AUTO_BUILD_FRONTEND = os.environ.get("AUTO_BUILD_FRONTEND", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
# When dist is missing at import time, kick off a background build instead of
# blocking Flask/Gunicorn startup. Set BACKGROUND_BUILD=0 to disable spawning.
BACKGROUND_BUILD = os.environ.get("BACKGROUND_BUILD", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
# Run the light file/tool checks on startup even when dist exists. Off by
# default so a multi-worker Gunicorn boot does not spawn a subprocess per worker.
RUN_STARTUP_CHECKS = os.environ.get("RUN_STARTUP_CHECKS", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

# Lazy-imported helpers from build_frontend (status + background spawn).
_build_helpers_loaded = False
_read_build_status = None
_get_build_error = None
_start_background_build = None


def _load_build_helpers() -> None:
    """Import build helpers without failing hard if the module is temporarily broken."""
    global _build_helpers_loaded, _read_build_status, _get_build_error, _start_background_build

    if _build_helpers_loaded:
        return

    try:
        from build_frontend import (  # type: ignore
            get_build_error,
            read_build_status,
            start_background_build,
        )

        _read_build_status = read_build_status
        _get_build_error = get_build_error
        _start_background_build = start_background_build
        _build_helpers_loaded = True
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[startup] warning: could not import build_frontend helpers: {exc}", file=sys.stderr, flush=True)
        _build_helpers_loaded = False


def _status_snapshot() -> dict[str, Any]:
    _load_build_helpers()
    if _read_build_status is not None:
        return _read_build_status()
    return {
        "status": "ready" if INDEX_FILE.exists() else "idle",
        "error": None,
        "message": None,
        "frontend_built": INDEX_FILE.exists(),
    }


def _current_build_error() -> str | None:
    _load_build_helpers()
    if _get_build_error is not None:
        return _get_build_error()
    if not INDEX_FILE.exists():
        return "Frontend build is missing. Run `python build_frontend.py --build-only`."
    return None


def _kick_background_build(*, force: bool = False, check: bool = False) -> None:
    """Non-blocking: start build_frontend.py in the background if needed."""
    if not AUTO_BUILD_FRONTEND and not force:
        return
    if not BACKGROUND_BUILD and not force:
        return

    _load_build_helpers()
    if _start_background_build is None:
        # Fallback: spawn the script directly without importing helpers.
        cmd = [sys.executable, str(BASE_DIR / "build_frontend.py"), "--background"]
        if force:
            cmd.append("--force")
        if check:
            cmd.append("--check")
        if INDEX_FILE.exists() and not force:
            cmd.append("--check-only")
        try:
            kwargs: dict[str, Any] = {
                "cwd": str(BASE_DIR),
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.DEVNULL,
                "stdin": subprocess.DEVNULL,
                "close_fds": os.name != "nt",
            }
            if os.name != "nt":
                kwargs["start_new_session"] = True
            subprocess.Popen(cmd, **kwargs)
            print(f"[startup] Spawned background build worker: {' '.join(cmd)}", flush=True)
        except OSError as exc:
            print(f"[startup] Failed to spawn background build: {exc}", file=sys.stderr, flush=True)
        return

    try:
        _start_background_build(force=force, check=check)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[startup] Background build helper failed: {exc}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Secret key. Needed to sign the OAuth handoff cookie. Persisted to a gitignored
# file so multiple Gunicorn workers on the same dyno share one key; in a real
# deployment set SECRET_KEY explicitly.
# ---------------------------------------------------------------------------
def _resolve_secret_key() -> str:
    configured = os.environ.get("SECRET_KEY", "").strip()
    if configured:
        return configured

    try:
        existing = SECRET_FILE.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    except OSError:
        pass

    generated = secrets.token_urlsafe(48)
    try:
        # Best-effort persistence. Create-then-rename avoids a partial read by a
        # concurrently starting worker.
        tmp = SECRET_FILE.with_suffix(f".tmp.{os.getpid()}")
        tmp.write_text(generated, encoding="utf-8")
        os.replace(tmp, SECRET_FILE)
        try:
            os.chmod(SECRET_FILE, 0o600)
        except OSError:
            pass
    except OSError as exc:
        print(f"[startup] warning: could not persist SECRET_KEY ({exc}); using a per-process key", file=sys.stderr, flush=True)
    return generated


app = Flask(__name__, static_folder=None)
app.secret_key = _resolve_secret_key()
app.config["MAX_CONTENT_LENGTH"] = int(MAX_UPLOAD_MB * 1024 * 1024)


def _cors_origins() -> str | list[str]:
    """Origins allowed to call /api/* cross-origin.

    Defaults to same-origin only (no Access-Control-Allow-Origin header). The
    previous `*` default turned the deployment into an open Discord API relay
    that any website could drive through this origin.
    """
    origins = os.environ.get("CORS_ORIGINS", "").strip()
    if not origins:
        return []
    if origins == "*":
        return "*"
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


_configured_origins = _cors_origins()
if _configured_origins:
    CORS(app, resources={r"/api/*": {"origins": _configured_origins}})


# ---------------------------------------------------------------------------
# Trusted-host handling for building absolute URLs.
# ---------------------------------------------------------------------------
_DEFAULT_TRUSTED_HOSTS = {"localhost", "127.0.0.1", "[::1]", "0.0.0.0"}


def _trusted_hosts() -> set[str]:
    hosts = {h.strip().lower() for h in os.environ.get("TRUSTED_HOSTS", "").split(",") if h.strip()}
    hosts |= _DEFAULT_TRUSTED_HOSTS
    if PUBLIC_BASE_URL:
        try:
            host = urlsplit(PUBLIC_BASE_URL).hostname
            if host:
                hosts.add(host.lower())
        except ValueError:
            pass
    return hosts


def _is_trusted_host(host: str | None) -> bool:
    if not host:
        return False
    hostname = host.split(":", 1)[0].strip().lower()
    return hostname in _trusted_hosts()


def _external_base_url() -> str | None:
    """Return a trusted absolute base URL, or None when one cannot be established.

    `PUBLIC_BASE_URL` wins. Otherwise the request's forwarded host is used only
    if it is explicitly trusted. Falling back to whatever `X-Forwarded-Host`
    says would let a caller dictate the OAuth redirect URI.
    """
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL

    forwarded_host = request.headers.get("X-Forwarded-Host", "").strip()
    if forwarded_host and _is_trusted_host(forwarded_host):
        proto = request.headers.get("X-Forwarded-Proto", "").strip().lower()
        if proto not in {"http", "https"}:
            proto = request.scheme if request.scheme in {"http", "https"} else "https"
        return f"{proto}://{forwarded_host}"

    if _is_trusted_host(request.host):
        return request.host_url.rstrip("/")

    return None


def _oauth_redirect_uri() -> str | None:
    configured = os.environ.get("DISCORD_REDIRECT_URI", "").strip()
    if configured:
        return configured
    base = _external_base_url()
    if not base:
        return None
    return f"{base}/auth/discord/callback"


def _oauth_configured() -> bool:
    return bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET)


_serializer = URLSafeTimedSerializer(app.secret_key, salt="disclone-oauth-handoff")


def _encode_oauth_token(access_token: str) -> str:
    """Sign the access token for the one-time handoff cookie."""
    return _serializer.dumps({"at": access_token})


def _decode_oauth_token(signed: str, max_age: int = OAUTH_HANDOFF_MAX_AGE) -> str | None:
    try:
        payload = _serializer.loads(signed, max_age=max_age)
    except (BadSignature, SignatureExpired):
        return None
    except Exception:
        return None
    token = payload.get("at") if isinstance(payload, dict) else None
    return token if isinstance(token, str) and token else None


def _is_secure_request() -> bool:
    proto = request.headers.get("X-Forwarded-Proto", request.scheme).strip().lower()
    return proto == "https" or request.is_secure


def _make_state_cookie(response, state: str):
    secure = _is_secure_request()
    response.set_cookie(
        "discord_oauth_state",
        state,
        max_age=OAUTH_STATE_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="Lax",
    )
    response.set_cookie(
        "discord_oauth_state_ts",
        str(int(time.time())),
        max_age=OAUTH_STATE_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="Lax",
    )
    return response


def _clear_state_cookies(response):
    response.delete_cookie("discord_oauth_state")
    response.delete_cookie("discord_oauth_state_ts")
    return response


HOP_BY_HOP_HEADERS: set[str] = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}

DISCORD_USER_AGENT = os.environ.get(
    "DISCORD_USER_AGENT",
    "DiscordBot (https://github.com/zexyomeme-svg/Discord-clone, 1.0)",
)

FORWARDED_REQUEST_HEADERS: set[str] = {
    "authorization",
    "content-type",
    "accept",
    "accept-language",
    "x-audit-log-reason",
}

FORWARDED_RESPONSE_HEADERS: set[str] = {
    "content-type",
    "cache-control",
    "etag",
    "last-modified",
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-ratelimit-reset-after",
    "x-ratelimit-bucket",
    "x-ratelimit-scope",
}


def _select_request_headers() -> dict[str, str]:
    """Forward only headers Discord needs; never forward browser hop-by-hop headers."""
    headers: dict[str, str] = {}
    for name, value in request.headers.items():
        lowered = name.lower()
        if lowered in HOP_BY_HOP_HEADERS:
            continue
        if lowered in FORWARDED_REQUEST_HEADERS:
            headers[name] = value

    # Do not forward the browser's User-Agent. Discord/Cloudflare can block Bot API
    # calls that look like they came from a normal browser and return
    # {"message":"internal network error","code":40333}. Use a bot-style UA.
    headers["Accept"] = headers.get("Accept", "application/json")
    headers["User-Agent"] = DISCORD_USER_AGENT
    return headers


def _select_response_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    selected: dict[str, str] = {}
    for name, value in headers:
        lowered = name.lower()
        if lowered in HOP_BY_HOP_HEADERS:
            continue
        if lowered in FORWARDED_RESPONSE_HEADERS:
            selected[name] = value
    return selected


def _is_safe_endpoint(endpoint: str) -> bool:
    """Reject endpoint paths that could escape the Discord API base URL."""
    if not endpoint or endpoint.startswith("/"):
        return False
    if "://" in endpoint:
        return False
    # No dot-segments, no userinfo trickery, no backslash normalisation games.
    segments = endpoint.replace("\\", "/").split("/")
    if any(segment in {".", ".."} for segment in segments):
        return False
    if "@" in segments[0]:
        return False
    return True


@app.after_request
def _apply_security_headers(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    # The SPA is fully self-contained (vite-plugin-singlefile), so it needs no
    # external scripts. cdn.discordapp.com is required for avatars/emoji.
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net; "
        "media-src 'self' blob: https://cdn.discordapp.com https://media.discordapp.net; "
        "connect-src 'self' https://discord.com wss://gateway.discord.gg wss://*.discord.gg; "
        "font-src 'self' data:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none'",
    )
    return response


@app.get("/healthz")
def healthz() -> tuple[dict[str, Any], int]:
    status = _status_snapshot()
    return {
        "status": "ok",
        "frontendBuilt": INDEX_FILE.exists(),
        "buildStatus": status.get("status"),
        "buildError": _current_build_error(),
        "buildMessage": status.get("message"),
        "backgroundBuild": BACKGROUND_BUILD,
        "oauthConfigured": _oauth_configured(),
    }, 200


@app.get("/api/oauth/config")
def oauth_config() -> tuple[dict[str, Any], int]:
    redirect_uri = _oauth_redirect_uri()
    payload: dict[str, Any] = {
        "enabled": bool(_oauth_configured() and redirect_uri),
        "clientId": DISCORD_CLIENT_ID,
        "scopes": DISCORD_OAUTH_SCOPES,
        "redirectUri": redirect_uri,
    }
    if _oauth_configured() and not redirect_uri:
        payload["warning"] = (
            "OAuth2 credentials are set but no trusted public URL is available. "
            "Set PUBLIC_BASE_URL (or TRUSTED_HOSTS / DISCORD_REDIRECT_URI)."
        )
    return payload, 200


@app.get("/auth/discord/login")
def discord_oauth_login():
    if not _oauth_configured():
        return (
            "Discord OAuth2 is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.\n",
            503,
            {"Content-Type": "text/plain; charset=utf-8"},
        )

    redirect_uri = _oauth_redirect_uri()
    if not redirect_uri:
        print(
            "[oauth] refusing to start: no trusted public URL. Set PUBLIC_BASE_URL.",
            file=sys.stderr,
            flush=True,
        )
        return (
            "Discord OAuth2 cannot start because the server cannot determine a trusted "
            "public URL. Set PUBLIC_BASE_URL to the public address of this app "
            "(for example https://your-app.onrender.com), or set DISCORD_REDIRECT_URI.\n",
            503,
            {"Content-Type": "text/plain; charset=utf-8"},
        )

    state = secrets.token_urlsafe(32)
    params = {
        "response_type": "code",
        "client_id": DISCORD_CLIENT_ID,
        "scope": DISCORD_OAUTH_SCOPES,
        "state": state,
        "redirect_uri": redirect_uri,
        "prompt": request.args.get("prompt", "consent"),
    }
    response = _make_state_cookie(make_response(), state)
    response.headers["Location"] = f"https://discord.com/oauth2/authorize?{urlencode(params)}"
    response.status_code = 302
    return response


@app.get("/auth/discord/callback")
def discord_oauth_callback():
    error = request.args.get("error")
    if error:
        # Only echo a whitelisted error slug; never reflect arbitrary input.
        safe_error = error if error.replace("_", "").isalnum() and len(error) <= 64 else "authorization_failed"
        response = redirect(f"/?oauth_error={safe_error}")
        return _clear_state_cookies(response)

    code = request.args.get("code")
    state = request.args.get("state")
    saved_state = request.cookies.get("discord_oauth_state")
    saved_ts = request.cookies.get("discord_oauth_state_ts", "0")

    try:
        state_age = int(time.time()) - int(saved_ts)
    except ValueError:
        state_age = OAUTH_STATE_MAX_AGE + 1

    if (
        not code
        or not state
        or not saved_state
        or not secrets.compare_digest(state, saved_state)
        or state_age > OAUTH_STATE_MAX_AGE
    ):
        response = redirect("/?oauth_error=invalid_state")
        return _clear_state_cookies(response)

    redirect_uri = _oauth_redirect_uri()
    if not redirect_uri:
        response = redirect("/?oauth_error=server_misconfigured")
        return _clear_state_cookies(response)

    try:
        token_response = requests.post(
            f"{DISCORD_API_BASE}/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            auth=(DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET),
            timeout=REQUEST_TIMEOUT,
        )
        token_response.raise_for_status()
        token_data = token_response.json()
        access_token = token_data["access_token"]
        if not isinstance(access_token, str) or not access_token:
            raise ValueError("Discord returned no access_token")
    except Exception as exc:
        response = redirect("/?oauth_error=token_exchange_failed")
        print(f"[oauth] token exchange failed: {exc}", file=sys.stderr, flush=True)
        return _clear_state_cookies(response)

    # Hand the token over in a signed, short-lived, HttpOnly cookie instead of a
    # query string. The SPA exchanges it once via POST /api/oauth/exchange.
    response = make_response(redirect("/?oauth_pending=1"))
    response.set_cookie(
        "discord_oauth_handoff",
        _encode_oauth_token(access_token),
        max_age=OAUTH_HANDOFF_MAX_AGE,
        httponly=True,
        secure=_is_secure_request(),
        samesite="Lax",
        path="/api/oauth/exchange",
    )
    expires_in = token_data.get("expires_in") if isinstance(token_data, dict) else None
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        # Non-HttpOnly so the SPA can show when the session expires. No secret.
        response.set_cookie(
            "discord_oauth_expires_in",
            str(int(expires_in)),
            max_age=OAUTH_HANDOFF_MAX_AGE,
            httponly=False,
            secure=_is_secure_request(),
            samesite="Lax",
        )
    return _clear_state_cookies(response)


@app.post("/api/oauth/exchange")
def discord_oauth_exchange():
    """One-time collection of the signed OAuth handoff cookie."""
    signed = request.cookies.get("discord_oauth_handoff")
    if not signed:
        return jsonify({"ok": False, "error": "no_pending_authorization"}), 400

    access_token = _decode_oauth_token(signed)
    if not access_token:
        response = jsonify({"ok": False, "error": "handoff_expired_or_invalid"})
        response.delete_cookie("discord_oauth_handoff", path="/api/oauth/exchange")
        return response, 400

    response = jsonify({"ok": True, "accessToken": access_token})
    response.delete_cookie("discord_oauth_handoff", path="/api/oauth/exchange")
    return response


@app.post("/auth/discord/logout")
def discord_oauth_logout():
    """Revoke the OAuth2 token server-side, then clear the handoff cookie.

    Without revocation, logging out only cleared localStorage and left a valid
    Discord access token in existence until it expired naturally.
    """
    payload = request.get_json(silent=True) or {}
    token = payload.get("accessToken")
    revoked = False

    if isinstance(token, str) and token and _oauth_configured():
        try:
            requests.post(
                f"{DISCORD_API_BASE}/oauth2/token/revoke",
                data={"token": token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                auth=(DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET),
                timeout=REQUEST_TIMEOUT,
            )
            revoked = True
        except Exception as exc:
            print(f"[oauth] token revocation failed: {exc}", file=sys.stderr, flush=True)

    response = jsonify({"ok": True, "revoked": revoked})
    response.delete_cookie("discord_oauth_handoff", path="/api/oauth/exchange")
    response.delete_cookie("discord_oauth_expires_in")
    return response


@app.route("/api/discord/<path:endpoint>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def discord_proxy(endpoint: str) -> Response:
    """Forward same-origin frontend requests to Discord's REST API."""
    if not _is_safe_endpoint(endpoint):
        return jsonify({"message": "Invalid Discord API endpoint."}), 400

    url = f"{DISCORD_API_BASE}/{endpoint}"

    try:
        upstream = requests.request(
            method=request.method,
            url=url,
            params=request.args,
            data=request.get_data() if request.method in {"POST", "PUT", "PATCH"} else None,
            headers=_select_request_headers(),
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as exc:
        # Log the detail server-side; do not leak internals to the browser.
        print(f"[proxy] {request.method} /{endpoint} failed: {exc}", file=sys.stderr, flush=True)
        return jsonify({
            "message": "Discord API proxy request failed.",
            "hint": "The server could not reach Discord. This may be a network or upstream issue.",
        }), 502

    return Response(
        upstream.content,
        status=upstream.status_code,
        headers=_select_response_headers(upstream.headers.items()),
    )


@app.errorhandler(413)
def request_entity_too_large(_err):
    return jsonify({
        "message": f"Upload too large. The proxy accepts at most {int(MAX_UPLOAD_MB)} MB per request.",
    }), 413


BUILDING_PAGE = (
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta http-equiv='refresh' content='3'>"
    "<title>Building frontend…</title>"
    "<style>body{font-family:system-ui,sans-serif;background:#313338;color:#f2f3f5;"
    "display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}"
    ".card{max-width:28rem;padding:2rem;background:#2b2d31;border-radius:12px;"
    "box-shadow:0 8px 24px rgba(0,0,0,.35)}h1{font-size:1.25rem;margin:0 0 .75rem}"
    "p{margin:.4rem 0;line-height:1.45;color:#b5bac1}code{color:#dbdee1}"
    "a{color:#00a8fc}</style>"
    "</head><body><div class='card'>"
    "<h1>Building frontend…</h1>"
    "<p>The web server started immediately. "
    "<code>build_frontend.py</code> is installing/building the Vite app in the background.</p>"
    "<p>This page refreshes automatically. Status: <code>__BUILD_STATUS__</code></p>"
    "<p>Health: <a href='/healthz'>/healthz</a></p>"
    "</div></body></html>"
)


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path: str):
    """Serve the built React app and support client-side routes."""
    if path.startswith("api/") or path.startswith("auth/"):
        return jsonify({"message": "Not found"}), 404

    # If the build is still running in the background, keep the worker alive and
    # return a temporary page instead of blocking the request on npm/vite.
    if not INDEX_FILE.exists():
        status = _status_snapshot()
        build_state = str(status.get("status") or "idle")
        if build_state not in {"building", "checking"}:
            _kick_background_build(force=False, check=True)
            status = _status_snapshot()
            build_state = str(status.get("status") or "building")

        error = _current_build_error()
        if build_state == "error" or error:
            return (
                "Frontend build failed or is missing.\n"
                f"{error or 'Run `python build_frontend.py --build-only` and restart the server.'}\n",
                500,
                {"Content-Type": "text/plain; charset=utf-8"},
            )

        # Non-blocking wait page while the background worker finishes.
        # NOTE: .replace() rather than str.format() — the page contains CSS, whose
        # braces format() would try to interpret as replacement fields.
        return (
            BUILDING_PAGE.replace("__BUILD_STATUS__", build_state),
            503,
            {"Content-Type": "text/html; charset=utf-8", "Retry-After": "3"},
        )

    # `send_from_directory` runs the path through werkzeug's safe_join, so any
    # traversal attempt raises NotFound rather than escaping DIST_DIR. The
    # explicit is_file() check only decides between "serve this asset" and
    # "fall through to the SPA route".
    requested = (DIST_DIR / path).resolve() if path else None
    if requested is not None and requested.is_file() and requested.is_relative_to(DIST_DIR.resolve()):
        return send_from_directory(DIST_DIR, path)

    return send_from_directory(DIST_DIR, "index.html")


# ---------------------------------------------------------------------------
# Fast startup: never block import on npm install / vite build.
# ---------------------------------------------------------------------------
if "--build-only" not in sys.argv:
    if INDEX_FILE.exists():
        print(f"[startup] Frontend present: {INDEX_FILE} (server starting immediately)", flush=True)
        if BACKGROUND_BUILD and AUTO_BUILD_FRONTEND and RUN_STARTUP_CHECKS:
            _kick_background_build(force=False, check=True)
    else:
        print(
            "[startup] dist/index.html missing — starting server immediately and "
            "building frontend in the background via build_frontend.py",
            flush=True,
        )
        _kick_background_build(force=False, check=True)


if __name__ == "__main__":
    # Backwards-compatible wrapper: delegate forced builds to build_frontend.py
    # so Render / docs that still call `python run.py --build-only` keep working.
    if "--build-only" in sys.argv:
        print(
            "[startup] Delegating --build-only to build_frontend.py "
            "(prefer: python build_frontend.py --build-only)",
            flush=True,
        )
        result = subprocess.run(
            [sys.executable, str(BASE_DIR / "build_frontend.py"), "--build-only", "--check"],
            cwd=str(BASE_DIR),
        )
        raise SystemExit(result.returncode)

    port = int(os.environ.get("PORT", "8000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    print(f"[startup] Starting Flask on 0.0.0.0:{port} (frontend build never blocks startup)", flush=True)
    app.run(host="0.0.0.0", port=port, debug=debug)
