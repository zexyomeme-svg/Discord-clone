"""Shared fixtures for the Flask backend tests.

`run.py` reads almost all of its configuration from the environment at import
time, so each test builds a freshly imported module with the env it needs.
"""
from __future__ import annotations

import importlib
import pathlib
import sys

import pytest

SRC_DIR = pathlib.Path(__file__).resolve().parents[1]

# Variables that must be reset between tests so one test's configuration cannot
# leak into the next.
ENV_KEYS = [
    "PUBLIC_BASE_URL",
    "TRUSTED_HOSTS",
    "DISCORD_REDIRECT_URI",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_OAUTH_SCOPES",
    "DISCORD_API_BASE",
    "DISCORD_USER_AGENT",
    "CORS_ORIGINS",
    "SECRET_KEY",
    "OAUTH_STATE_MAX_AGE",
    "OAUTH_HANDOFF_MAX_AGE",
    "MAX_UPLOAD_MB",
    "PROXY_TIMEOUT",
    "APP_NAME",
    "APP_VERSION",
    "APP_GITHUB_URL",
    "APP_SITE_URL",
    "APP_PRESENCE_TEXT",
]

# Never let a test spawn npm or a background build worker.
SAFE_ENV = {
    "AUTO_BUILD_FRONTEND": "0",
    "BACKGROUND_BUILD": "0",
    "RUN_STARTUP_CHECKS": "0",
    "SECRET_KEY": "test-secret-key-not-used-in-production",
}


@pytest.fixture
def make_app(monkeypatch, tmp_path):
    """Import run.py with a controlled environment and return the module."""

    def _make(env: dict[str, str] | None = None, *, with_dist: bool = True):
        monkeypatch.chdir(SRC_DIR)
        if str(SRC_DIR) not in sys.path:
            sys.path.insert(0, str(SRC_DIR))

        for key in ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        for key, value in {**SAFE_ENV, **(env or {})}.items():
            monkeypatch.setenv(key, value)

        sys.modules.pop("run", None)
        run = importlib.import_module("run")

        # Point the SPA routes at a throwaway build directory so the tests do not
        # depend on `npm run build` having been run.
        dist = tmp_path / "dist"
        if with_dist:
            dist.mkdir(parents=True, exist_ok=True)
            (dist / "index.html").write_text(
                "<!doctype html><html><body>SPA_INDEX</body></html>", encoding="utf-8"
            )
            (dist / "asset.txt").write_text("ASSET_BODY", encoding="utf-8")
        run.DIST_DIR = dist
        run.INDEX_FILE = dist / "index.html"
        run.app.config.update(TESTING=True)
        return run

    yield _make

    sys.modules.pop("run", None)


@pytest.fixture
def client(make_app):
    """A test client for a default (OAuth-unconfigured) app."""
    run = make_app()
    return run, run.app.test_client()
