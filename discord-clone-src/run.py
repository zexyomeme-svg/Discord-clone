"""Render-ready Flask entrypoint for the Discord clone.

This app serves the Vite production build from ./dist and exposes a small
same-origin proxy at /api/discord/* so the React app can call Discord's REST API
without relying on public CORS proxies.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

import requests
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
DISCORD_API_BASE = os.environ.get("DISCORD_API_BASE", "https://discord.com/api/v10").rstrip("/")
REQUEST_TIMEOUT = float(os.environ.get("PROXY_TIMEOUT", "30"))


def _cors_origins() -> str | list[str]:
    origins = os.environ.get("CORS_ORIGINS", "*").strip()
    if origins == "*":
        return "*"
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


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
def healthz() -> tuple[dict[str, str], int]:
    return {"status": "ok"}, 200


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

    requested = DIST_DIR / path
    if path and requested.is_file():
        return send_from_directory(DIST_DIR, path)

    index_file = DIST_DIR / "index.html"
    if index_file.exists():
        return send_from_directory(DIST_DIR, "index.html")

    return (
        "Vite build not found. Run `npm run build` before starting the Python server.",
        500,
        {"Content-Type": "text/plain; charset=utf-8"},
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
