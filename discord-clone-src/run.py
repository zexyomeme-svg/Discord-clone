"""Render-ready Flask entrypoint for the Discord clone.

This app serves the Vite production build from ./dist and exposes a small
same-origin proxy at /api/discord/* so the React app can call Discord's REST API
without relying on public CORS proxies.

Frontend install/build/check work lives in `build_frontend.py`. `run.py` starts
the web server immediately and, when needed, launches that tool in the
background so the site becomes reachable faster. For Render's build phase, use
`python build_frontend.py --build-only` (still supported via
`python run.py --build-only` as a thin wrapper).
"""

from __future__ import annotations

import base64
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode

import requests
from flask import Flask, Response, jsonify, make_response, redirect, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
INDEX_FILE = DIST_DIR / "index.html"

DISCORD_API_BASE = os.environ.get("DISCORD_API_BASE", "https://discord.com/api/v10").rstrip("/")
DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "").strip()
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "").strip()
DISCORD_OAUTH_SCOPES = os.environ.get("DISCORD_OAUTH_SCOPES", "identify email guilds").strip()
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
OAUTH_STATE_MAX_AGE = int(os.environ.get("OAUTH_STATE_MAX_AGE", "600"))
REQUEST_TIMEOUT = float(os.environ.get("PROXY_TIMEOUT", "30"))
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

# Lazy-imported helpers from build_frontend (status + background spawn).
_build_helpers_loaded = False
_read_build_status = None
_get_build_error = None
_start_background_build = None
_ensure_frontend_build = None


def _load_build_helpers() -> None:
    """Import build helpers without failing hard if the module is temporarily broken."""
    global _build_helpers_loaded, _read_build_status, _get_build_error
    global _start_background_build, _ensure_frontend_build

    if _build_helpers_loaded:
        return

    try:
        from build_frontend import (  # type: ignore
            ensure_frontend_build,
            get_build_error,
            read_build_status,
            start_background_build,
        )

        _read_build_status = read_build_status
        _get_build_error = get_build_error
        _start_background_build = start_background_build
        _ensure_frontend_build = ensure_frontend_build
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


def _external_base_url() -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    forwarded_proto = request.headers.get("X-Forwarded-Proto", request.scheme)
    forwarded_host = request.headers.get("X-Forwarded-Host", request.host)
    return f"{forwarded_proto}://{forwarded_host}"


def _oauth_redirect_uri() -> str:
    configured = os.environ.get("DISCORD_REDIRECT_URI", "").strip()
    if configured:
        return configured
    return f"{_external_base_url()}/auth/discord/callback"


def _oauth_configured() -> bool:
    return bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET)


def _encode_oauth_token(access_token: str) -> str:
    return base64.urlsafe_b64encode(access_token.encode("utf-8")).decode("ascii")


def _decode_oauth_token(encoded: str) -> str:
    return base64.urlsafe_b64decode(encoded.encode("ascii")).decode("utf-8")


def _make_state_cookie(state: str):
    response = make_response()
    response.set_cookie(
        "discord_oauth_state",
        state,
        max_age=OAUTH_STATE_MAX_AGE,
        httponly=True,
        secure=request.headers.get("X-Forwarded-Proto", request.scheme) == "https",
        samesite="Lax",
    )
    response.set_cookie(
        "discord_oauth_state_ts",
        str(int(time.time())),
        max_age=OAUTH_STATE_MAX_AGE,
        httponly=True,
        secure=request.headers.get("X-Forwarded-Proto", request.scheme) == "https",
        samesite="Lax",
    )
    return response


def _clear_state_cookies(response):
    response.delete_cookie("discord_oauth_state")
    response.delete_cookie("discord_oauth_state_ts")
    return response


def _cors_origins() -> str | list[str]:
    origins = os.environ.get("CORS_ORIGINS", "*").strip()
    if origins == "*":
        return "*"
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


# ---------------------------------------------------------------------------
# Fast startup: never block import on npm install / vite build.
# If dist is already present, optionally run light checks in the background.
# If dist is missing, spawn build_frontend.py in the background and keep going.
# ---------------------------------------------------------------------------
if "--build-only" not in sys.argv:
    if INDEX_FILE.exists():
        print(f"[startup] Frontend present: {INDEX_FILE} (server starting immediately)", flush=True)
        # Optional non-blocking health/tool checks in the background.
        if BACKGROUND_BUILD and AUTO_BUILD_FRONTEND:
            _kick_background_build(force=False, check=True)
    else:
        print(
            "[startup] dist/index.html missing — starting server immediately and "
            "building frontend in the background via build_frontend.py",
            flush=True,
        )
        _kick_background_build(force=False, check=True)

app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/api/*": {"origins": _cors_origins()}})

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
    "DiscordBot (https://arena.ai, 1.0)",
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
    }, 200


@app.get("/api/oauth/config")
def oauth_config() -> tuple[dict[str, str | bool], int]:
    return {
        "enabled": _oauth_configured(),
        "clientId": DISCORD_CLIENT_ID,
        "scopes": DISCORD_OAUTH_SCOPES,
        "redirectUri": _oauth_redirect_uri(),
    }, 200


@app.get("/auth/discord/login")
def discord_oauth_login():
    if not _oauth_configured():
        return (
            "Discord OAuth2 is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.",
            503,
            {"Content-Type": "text/plain; charset=utf-8"},
        )

    state = secrets.token_urlsafe(32)
    params = {
        "response_type": "code",
        "client_id": DISCORD_CLIENT_ID,
        "scope": DISCORD_OAUTH_SCOPES,
        "state": state,
        "redirect_uri": _oauth_redirect_uri(),
        "prompt": request.args.get("prompt", "consent"),
    }
    response = _make_state_cookie(state)
    response.headers["Location"] = f"https://discord.com/oauth2/authorize?{urlencode(params)}"
    response.status_code = 302
    return response


@app.get("/auth/discord/callback")
def discord_oauth_callback():
    error = request.args.get("error")
    if error:
        response = redirect(f"/?oauth_error={error}")
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

    try:
        token_response = requests.post(
            f"{DISCORD_API_BASE}/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _oauth_redirect_uri(),
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            auth=(DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET),
            timeout=REQUEST_TIMEOUT,
        )
        token_response.raise_for_status()
        token_data = token_response.json()
        access_token = token_data["access_token"]
    except Exception as exc:
        response = redirect("/?oauth_error=token_exchange_failed")
        print(f"[oauth] token exchange failed: {exc}", file=sys.stderr, flush=True)
        return _clear_state_cookies(response)

    response = redirect(f"/?oauth_token={_encode_oauth_token(access_token)}")
    return _clear_state_cookies(response)


@app.route("/api/discord/<path:endpoint>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def discord_proxy(endpoint: str) -> Response:
    """Forward same-origin frontend requests to Discord's REST API."""
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
        return jsonify({"message": "Discord API proxy request failed", "detail": str(exc)}), 502

    response = Response(
        upstream.content,
        status=upstream.status_code,
        headers=_select_response_headers(upstream.headers.items()),
    )
    return response


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path: str):
    """Serve the built React app and support client-side routes."""
    if path.startswith("api/"):
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
        return (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<meta http-equiv='refresh' content='3'>"
            "<title>Building frontend…</title>"
            "<style>body{font-family:system-ui,sans-serif;background:#313338;color:#f2f3f5;"
            "display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}"
            ".card{max-width:28rem;padding:2rem;background:#2b2d31;border-radius:12px;"
            "box-shadow:0 8px 24px rgba(0,0,0,.35)}h1{font-size:1.25rem;margin:0 0 .75rem}"
            "p{margin:.4rem 0;line-height:1.45;color:#b5bac1}code{color:#dbdee1}</style>"
            "</head><body><div class='card'>"
            "<h1>Building frontend…</h1>"
            "<p>The web server started immediately. "
            "<code>build_frontend.py</code> is installing/building the Vite app in the background.</p>"
            "<p>This page refreshes automatically. Status: "
            f"<code>{build_state}</code></p>"
            "<p>Health: <a href='/healthz' style='color:#00a8fc'>/healthz</a></p>"
            "</div></body></html>",
            503,
            {"Content-Type": "text/html; charset=utf-8", "Retry-After": "3"},
        )

    requested = DIST_DIR / path
    if path and requested.is_file():
        return send_from_directory(DIST_DIR, path)

    return send_from_directory(DIST_DIR, "index.html")


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
