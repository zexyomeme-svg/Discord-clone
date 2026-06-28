"""Render-ready Flask entrypoint for the Discord clone.

This app serves the Vite production build from ./dist and exposes a small
same-origin proxy at /api/discord/* so the React app can call Discord's REST API
without relying on public CORS proxies.

If ./dist/index.html is missing, run.py can automatically install Node packages
and run the Vite build before the server starts. This makes `python run.py` and
`gunicorn run:app` work even when the build output was not committed.
"""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
import sys
import secrets
import time
from urllib.parse import urlencode
from pathlib import Path
from typing import Iterable

import requests
from flask import Flask, Response, jsonify, make_response, redirect, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
INDEX_FILE = DIST_DIR / "index.html"
PACKAGE_JSON = BASE_DIR / "package.json"
PACKAGE_LOCK = BASE_DIR / "package-lock.json"
NODE_MODULES = BASE_DIR / "node_modules"
NODE_MODULE_BIN = NODE_MODULES / ".bin"
NODE_VERSION = os.environ.get("NODE_VERSION", "20.20.2")
NODEENV_DIR = Path(os.environ.get("NODEENV_DIR", str(BASE_DIR / ".nodeenv")))
NODEENV_BIN = NODEENV_DIR / ("Scripts" if os.name == "nt" else "bin")
LOCAL_NPM = NODEENV_BIN / ("npm.cmd" if os.name == "nt" else "npm")

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

_build_error: str | None = None


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


def _startup_env() -> dict[str, str]:
    """Environment for npm commands. Force devDependencies for Vite builds."""
    env = os.environ.copy()
    extra_path = [str(NODE_MODULE_BIN), str(NODEENV_BIN)]
    existing_path = env.get("PATH", "")
    # npm package lifecycle scripts need a POSIX shell. Some hosts provide a very
    # small PATH during startup, so include common system directories explicitly.
    fallback_path = "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"
    env["PATH"] = os.pathsep.join(extra_path + [existing_path, fallback_path])
    env["NPM_CONFIG_PRODUCTION"] = "false"
    env["npm_config_production"] = "false"
    return env


def _run_command(command: list[str], description: str) -> None:
    """Run a setup command and raise a helpful error if it fails."""
    print(f"[startup] {description}: {' '.join(command)}", flush=True)
    try:
        subprocess.run(command, cwd=BASE_DIR, check=True, env=_startup_env())
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Could not run `{command[0]}`. Make sure Node.js/npm are installed, "
            "or keep nodeenv in requirements.txt so run.py can install Node automatically."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"{description} failed with exit code {exc.returncode}.") from exc


def _find_npm() -> str | None:
    """Return an npm executable from env, local nodeenv, or system PATH."""
    configured = os.environ.get("NPM_BINARY")
    if configured:
        configured_path = Path(configured)
        if configured_path.exists() or shutil.which(configured):
            return configured

    if LOCAL_NPM.exists():
        return str(LOCAL_NPM)

    system_npm = shutil.which("npm")
    if system_npm:
        return system_npm

    return None


def _ensure_npm() -> str:
    """Ensure npm exists. If needed, install a local Node runtime via nodeenv."""
    npm = _find_npm()
    if npm:
        return npm

    try:
        import nodeenv  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            "npm was not found and nodeenv is not installed. Run `pip install -r requirements.txt` "
            "after requirements.txt has been updated, then restart the server."
        ) from exc

    _run_command(
        [sys.executable, "-m", "nodeenv", "--node", NODE_VERSION, "--prebuilt", str(NODEENV_DIR)],
        f"Installing local Node.js {NODE_VERSION} runtime",
    )

    npm = _find_npm()
    if not npm:
        raise RuntimeError("nodeenv finished, but npm is still not available.")
    return npm


def ensure_frontend_build(force: bool = False) -> None:
    """Build the Vite frontend automatically when dist/index.html is missing.

    Pass force=True for deployment/build commands so dist always reflects the
    current source files.
    """
    global _build_error

    if INDEX_FILE.exists() and not force:
        return

    if not AUTO_BUILD_FRONTEND:
        _build_error = (
            "Vite build not found and AUTO_BUILD_FRONTEND is disabled. "
            "Run `npm install && npm run build`, or set AUTO_BUILD_FRONTEND=1."
        )
        print(f"[startup] {_build_error}", file=sys.stderr, flush=True)
        return

    if not PACKAGE_JSON.exists():
        _build_error = f"Cannot build frontend because {PACKAGE_JSON.name} was not found."
        print(f"[startup] {_build_error}", file=sys.stderr, flush=True)
        return

    try:
        npm = _ensure_npm()

        # Always run install when the build is missing. This fixes stale or production-only
        # node_modules folders where devDependencies such as Vite are absent, which causes
        # `npm run build` to fail with exit code 127.
        install_command = [npm, "ci", "--include=dev"] if PACKAGE_LOCK.exists() else [npm, "install", "--include=dev"]
        _run_command(install_command, "Installing frontend dependencies")

        _run_command([npm, "run", "build"], "Building frontend")
    except RuntimeError as exc:
        _build_error = str(exc)
        print(f"[startup] {_build_error}", file=sys.stderr, flush=True)
        return

    if INDEX_FILE.exists():
        _build_error = None
        print(f"[startup] Frontend build ready: {INDEX_FILE}", flush=True)
    else:
        _build_error = "Frontend build command completed, but dist/index.html was not created."
        print(f"[startup] {_build_error}", file=sys.stderr, flush=True)


# Build during import for `gunicorn run:app`, where the __main__ block is not
# executed. Skip here for `python run.py --build-only` so it does one forced
# build in the __main__ block instead of building twice.
if "--build-only" not in sys.argv:
    ensure_frontend_build()

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
def healthz() -> tuple[dict[str, str | bool | None], int]:
    return {
        "status": "ok",
        "frontendBuilt": INDEX_FILE.exists(),
        "buildError": _build_error,
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

    if not code or not state or not saved_state or not secrets.compare_digest(state, saved_state) or state_age > OAUTH_STATE_MAX_AGE:
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
        response = redirect(f"/?oauth_error=token_exchange_failed")
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

    if not INDEX_FILE.exists():
        ensure_frontend_build()

    requested = DIST_DIR / path
    if path and requested.is_file():
        return send_from_directory(DIST_DIR, path)

    if INDEX_FILE.exists():
        return send_from_directory(DIST_DIR, "index.html")

    return (
        "Frontend build failed or is missing. "
        f"{_build_error or 'Run `npm install && npm run build` and restart the server.'}",
        500,
        {"Content-Type": "text/plain; charset=utf-8"},
    )


if __name__ == "__main__":
    if "--build-only" in sys.argv:
        ensure_frontend_build(force=True)
        if INDEX_FILE.exists() and _build_error is None:
            print("[startup] Build-only check completed successfully.", flush=True)
            raise SystemExit(0)
        print(f"[startup] Build-only check failed: {_build_error}", file=sys.stderr, flush=True)
        raise SystemExit(1)

    port = int(os.environ.get("PORT", "8000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
