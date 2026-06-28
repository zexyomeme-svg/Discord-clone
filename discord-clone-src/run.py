"""Render-ready Flask entrypoint for the Discord clone.

This app serves the Vite production build from ./dist and exposes a small
same-origin proxy at /api/discord/* so the React app can call Discord's REST API
without relying on public CORS proxies.

If ./dist/index.html is missing, run.py can automatically install Node packages
and run the Vite build before the server starts. This makes `python run.py` and
`gunicorn run:app` work even when the build output was not committed.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable

import requests
from flask import Flask, Response, jsonify, request, send_from_directory
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
REQUEST_TIMEOUT = float(os.environ.get("PROXY_TIMEOUT", "30"))
AUTO_BUILD_FRONTEND = os.environ.get("AUTO_BUILD_FRONTEND", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

_build_error: str | None = None


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


def ensure_frontend_build() -> None:
    """Build the Vite frontend automatically when dist/index.html is missing."""
    global _build_error

    if INDEX_FILE.exists():
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


# Build during import as well as when running `python run.py`; this is important
# for `gunicorn run:app`, where the __main__ block is not executed.
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

FORWARDED_REQUEST_HEADERS: set[str] = {
    "authorization",
    "content-type",
    "accept",
    "accept-language",
    "user-agent",
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

    headers.setdefault("Accept", "application/json")
    headers.setdefault("User-Agent", "discord-clone-render/1.0")
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
        ensure_frontend_build()
        if INDEX_FILE.exists() and _build_error is None:
            print("[startup] Build-only check completed successfully.", flush=True)
            raise SystemExit(0)
        print(f"[startup] Build-only check failed: {_build_error}", file=sys.stderr, flush=True)
        raise SystemExit(1)

    port = int(os.environ.get("PORT", "8000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
