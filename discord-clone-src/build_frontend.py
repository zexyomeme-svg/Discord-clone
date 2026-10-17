#!/usr/bin/env python3
"""Frontend build, validation, and maintenance tool for the Discord clone.

This module owns Node/npm install + Vite build work so `run.py` can start the
Flask app immediately. `run.py` may spawn this script in the background when
`dist/index.html` is missing, or call it synchronously via CLI flags.

Usage:
  python build_frontend.py                 # build if dist is missing
  python build_frontend.py --force         # always rebuild
  python build_frontend.py --build-only    # force rebuild, exit 0/1 (Render)
  python build_frontend.py --check         # validate project files / tools only
  python build_frontend.py --background    # same as default; marks status file
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
# The application lives in a subdirectory of the repository, but both hosting
# platforms discover their config from the repository root: Render looks for
# render.yaml there by default, and Railway builds with a Dockerfile it finds
# there. So deployment config is checked at both levels.
REPO_ROOT = BASE_DIR.parent
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
STATUS_FILE = BASE_DIR / ".frontend_build_status.json"
LOCK_FILE = BASE_DIR / ".frontend_build.lock"
RUN_PY = BASE_DIR / "run.py"
REQUIREMENTS = BASE_DIR / "requirements.txt"
# render.yaml may sit at the repository root (what Render's Blueprint discovers
# without a custom path) or beside the app. Prefer the root, accept either.
RENDER_YAML_ROOT = REPO_ROOT / "render.yaml"
RENDER_YAML_LOCAL = BASE_DIR / "render.yaml"
RENDER_YAML = RENDER_YAML_ROOT if RENDER_YAML_ROOT.exists() else RENDER_YAML_LOCAL
DOCKERFILE = REPO_ROOT / "Dockerfile"
DOCKERIGNORE = REPO_ROOT / ".dockerignore"
TSCONFIG = BASE_DIR / "tsconfig.json"
VITE_CONFIG = BASE_DIR / "vite.config.ts"
SRC_DIR = BASE_DIR / "src"

AUTO_BUILD_FRONTEND = os.environ.get("AUTO_BUILD_FRONTEND", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def _now() -> float:
    return time.time()


def _write_status(
    status: str,
    *,
    error: str | None = None,
    message: str | None = None,
    checks: list[dict[str, Any]] | None = None,
    pid: int | None = None,
) -> None:
    payload: dict[str, Any] = {
        "status": status,
        "error": error,
        "message": message,
        "checks": checks or [],
        "pid": pid if pid is not None else os.getpid(),
        "updated_at": _now(),
        "frontend_built": INDEX_FILE.exists(),
        "index_path": str(INDEX_FILE),
    }
    try:
        STATUS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"[build] warning: could not write status file: {exc}", file=sys.stderr, flush=True)


def read_build_status() -> dict[str, Any]:
    """Return the latest build status dict (safe defaults if missing)."""
    if not STATUS_FILE.exists():
        return {
            "status": "ready" if INDEX_FILE.exists() else "idle",
            "error": None,
            "message": None,
            "checks": [],
            "pid": None,
            "updated_at": None,
            "frontend_built": INDEX_FILE.exists(),
            "index_path": str(INDEX_FILE),
        }
    try:
        data = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("status file is not an object")
        data.setdefault("frontend_built", INDEX_FILE.exists())
        data.setdefault("error", None)
        data.setdefault("status", "idle")
        return data
    except (OSError, json.JSONDecodeError, ValueError):
        return {
            "status": "ready" if INDEX_FILE.exists() else "idle",
            "error": None,
            "message": "status file unreadable",
            "checks": [],
            "pid": None,
            "updated_at": None,
            "frontend_built": INDEX_FILE.exists(),
            "index_path": str(INDEX_FILE),
        }


def get_build_error() -> str | None:
    status = read_build_status()
    if status.get("status") == "error":
        return status.get("error") or "Frontend build failed."
    if not INDEX_FILE.exists() and status.get("status") != "building":
        return status.get("error")
    return status.get("error")


class BuildLock:
    """Simple cross-process exclusive lock using an exclusive lock file."""

    def __init__(self, path: Path = LOCK_FILE) -> None:
        self.path = path
        self._handle = None

    def acquire(self, blocking: bool = False) -> bool:
        flags = os.O_CREAT | os.O_RDWR
        if not blocking:
            # O_EXCL only helps on create; use exclusive open + platform lock.
            pass
        try:
            self._handle = open(self.path, "a+", encoding="utf-8")
        except OSError:
            return False

        try:
            if os.name == "nt":
                # Best-effort on Windows; exclusive rename fallback below if needed.
                try:
                    import msvcrt

                    self._handle.seek(0)
                    msvcrt.locking(self._handle.fileno(), msvcrt.LK_NBLCK, 1)
                except OSError:
                    self.release()
                    return False
            else:
                import fcntl

                flags_lock = fcntl.LOCK_EX
                if not blocking:
                    flags_lock |= fcntl.LOCK_NB
                try:
                    fcntl.flock(self._handle.fileno(), flags_lock)
                except BlockingIOError:
                    self.release()
                    return False
                except OSError:
                    self.release()
                    return False
        except Exception:
            self.release()
            return False

        try:
            self._handle.seek(0)
            self._handle.truncate()
            self._handle.write(f"{os.getpid()}\n{time.time()}\n")
            self._handle.flush()
        except OSError:
            pass
        return True

    def release(self) -> None:
        if self._handle is None:
            return
        try:
            if os.name == "nt":
                try:
                    import msvcrt

                    self._handle.seek(0)
                    msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
            else:
                import fcntl

                try:
                    fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
                except OSError:
                    pass
        finally:
            try:
                self._handle.close()
            except OSError:
                pass
            self._handle = None

    def __enter__(self) -> "BuildLock":
        return self

    def __exit__(self, *args: object) -> None:
        self.release()


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
    print(f"[build] {description}: {' '.join(command)}", flush=True)
    try:
        subprocess.run(command, cwd=BASE_DIR, check=True, env=_startup_env())
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Could not run `{command[0]}`. Make sure Node.js/npm are installed, "
            "or keep nodeenv in requirements.txt so build_frontend.py can install Node automatically."
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


def check_project_files() -> list[dict[str, Any]]:
    """Validate expected project files and basic tool availability."""
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "ok": ok, "detail": detail})
        mark = "ok" if ok else "FAIL"
        print(f"[check] [{mark}] {name}{': ' + detail if detail else ''}", flush=True)

    required_files = {
        "package.json": PACKAGE_JSON,
        "run.py": RUN_PY,
        "requirements.txt": REQUIREMENTS,
        "tsconfig.json": TSCONFIG,
        "vite.config.ts": VITE_CONFIG,
        "src/": SRC_DIR,
        "index.html": BASE_DIR / "index.html",
        "build_frontend.py": BASE_DIR / "build_frontend.py",
    }
    for name, path in required_files.items():
        exists = path.exists()
        add(f"file:{name}", exists, str(path) if exists else f"missing: {path}")

    # Deployment config. render.yaml is accepted at either level, and the
    # Dockerfile is what Railway builds with (and what Render uses when the
    # service runtime is Docker), so both are reported rather than one.
    add(
        "file:render.yaml",
        RENDER_YAML.exists(),
        str(RENDER_YAML) if RENDER_YAML.exists()
        else f"missing: looked in {RENDER_YAML_ROOT} and {RENDER_YAML_LOCAL}",
    )
    add(
        "file:Dockerfile",
        DOCKERFILE.exists(),
        str(DOCKERFILE) if DOCKERFILE.exists()
        else "missing: Railway builds with a Dockerfile when one is present",
    )
    add(
        "file:.dockerignore",
        DOCKERIGNORE.exists(),
        str(DOCKERIGNORE) if DOCKERIGNORE.exists()
        else "missing: without it node_modules/ and dist/ are copied into the build context",
    )

    add("python", True, sys.version.split()[0])

    npm = _find_npm()
    add("npm", bool(npm), npm or "not found (nodeenv fallback available at build time)")

    # itsdangerous is imported directly by run.py to sign the one-time OAuth2
    # handoff cookie, so it is checked alongside the other runtime modules.
    for module_name in ("flask", "flask_cors", "requests", "gunicorn", "itsdangerous"):
        try:
            __import__(module_name)
            add(f"python-module:{module_name}", True)
        except ImportError:
            add(f"python-module:{module_name}", False, "not installed (pip install -r requirements.txt)")

    if RUN_PY.exists():
        try:
            subprocess.run(
                [sys.executable, "-m", "py_compile", str(RUN_PY)],
                check=True,
                cwd=BASE_DIR,
                capture_output=True,
            )
            add("py_compile:run.py", True)
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or b"").decode("utf-8", errors="replace")[:300]
            add("py_compile:run.py", False, detail or f"exit {exc.returncode}")

    try:
        subprocess.run(
            [sys.executable, "-m", "py_compile", str(BASE_DIR / "build_frontend.py")],
            check=True,
            cwd=BASE_DIR,
            capture_output=True,
        )
        add("py_compile:build_frontend.py", True)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", errors="replace")[:300]
        add("py_compile:build_frontend.py", False, detail or f"exit {exc.returncode}")

    add("dist/index.html", INDEX_FILE.exists(), str(INDEX_FILE) if INDEX_FILE.exists() else "not built yet")

    if NODE_MODULES.exists():
        add("node_modules", True, str(NODE_MODULES))
    else:
        add("node_modules", True, "absent (will be installed during build if needed)")

    return checks


def ensure_frontend_build(force: bool = False) -> bool:
    """Build the Vite frontend when dist/index.html is missing (or force=True).

    Returns True when INDEX_FILE exists after the attempt.
    """
    if INDEX_FILE.exists() and not force:
        _write_status("ready", message="Frontend build already present.")
        print(f"[build] Frontend already built: {INDEX_FILE}", flush=True)
        return True

    if not AUTO_BUILD_FRONTEND and not force:
        error = (
            "Vite build not found and AUTO_BUILD_FRONTEND is disabled. "
            "Run `python build_frontend.py --build-only`, or set AUTO_BUILD_FRONTEND=1."
        )
        _write_status("error", error=error)
        print(f"[build] {error}", file=sys.stderr, flush=True)
        return False

    if not PACKAGE_JSON.exists():
        error = f"Cannot build frontend because {PACKAGE_JSON.name} was not found."
        _write_status("error", error=error)
        print(f"[build] {error}", file=sys.stderr, flush=True)
        return False

    lock = BuildLock()
    if not lock.acquire(blocking=False):
        # Another process is already building.
        print("[build] Another build is already in progress; waiting not required.", flush=True)
        _write_status(
            "building",
            message="Build already running in another process.",
            pid=None,
        )
        # Poll briefly for readiness when a concurrent build is active.
        deadline = _now() + 120
        while _now() < deadline:
            if INDEX_FILE.exists():
                _write_status("ready", message="Frontend became available from concurrent build.")
                return True
            status = read_build_status()
            if status.get("status") == "error":
                return False
            time.sleep(1.0)
        return INDEX_FILE.exists()

    try:
        _write_status("building", message="Installing dependencies and building frontend...")
        try:
            npm = _ensure_npm()

            # Always run install when the build is missing/forced. This fixes stale or
            # production-only node_modules folders where devDependencies such as Vite
            # are absent, which causes `npm run build` to fail with exit code 127.
            install_command = (
                [npm, "ci", "--include=dev"] if PACKAGE_LOCK.exists() else [npm, "install", "--include=dev"]
            )
            _run_command(install_command, "Installing frontend dependencies")
            _run_command([npm, "run", "build"], "Building frontend")
        except RuntimeError as exc:
            error = str(exc)
            _write_status("error", error=error)
            print(f"[build] {error}", file=sys.stderr, flush=True)
            return False

        if INDEX_FILE.exists():
            _write_status("ready", message=f"Frontend build ready: {INDEX_FILE}")
            print(f"[build] Frontend build ready: {INDEX_FILE}", flush=True)
            return True

        error = "Frontend build command completed, but dist/index.html was not created."
        _write_status("error", error=error)
        print(f"[build] {error}", file=sys.stderr, flush=True)
        return False
    finally:
        lock.release()


def start_background_build(*, force: bool = False, check: bool = True) -> subprocess.Popen | None:
    """Spawn this script in a detached child process. Returns the Popen handle or None."""
    if not AUTO_BUILD_FRONTEND and not force:
        print("[build] AUTO_BUILD_FRONTEND disabled; not starting background build.", flush=True)
        return None

    # Avoid stacking background jobs if one is already building recently.
    status = read_build_status()
    if status.get("status") == "building":
        updated = status.get("updated_at") or 0
        if isinstance(updated, (int, float)) and _now() - float(updated) < 600:
            print("[build] Background build already marked as in progress.", flush=True)
            return None

    if INDEX_FILE.exists() and not force and not check:
        return None

    cmd = [sys.executable, str(BASE_DIR / "build_frontend.py"), "--background"]
    if force:
        cmd.append("--force")
    if check:
        cmd.append("--check")
    # When dist exists and not forcing, only run checks (no rebuild).
    if INDEX_FILE.exists() and not force:
        cmd.append("--check-only")

    print(f"[build] Starting background worker: {' '.join(cmd)}", flush=True)
    _write_status("building" if (force or not INDEX_FILE.exists()) else "checking", message="Background worker started.")

    # Detach stdio so gunicorn/flask workers are not blocked by child pipes.
    log_path = BASE_DIR / ".frontend_build.log"
    try:
        log_handle = open(log_path, "a", encoding="utf-8")
    except OSError:
        log_handle = subprocess.DEVNULL

    try:
        creationflags = 0
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(
                subprocess, "DETACHED_PROCESS", 0
            )
        popen_kwargs: dict[str, Any] = {
            "cwd": str(BASE_DIR),
            "stdout": log_handle,
            "stderr": subprocess.STDOUT,
            "stdin": subprocess.DEVNULL,
            "env": os.environ.copy(),
            "close_fds": os.name != "nt",
        }
        if os.name == "nt":
            popen_kwargs["creationflags"] = creationflags
        else:
            popen_kwargs["start_new_session"] = True

        proc = subprocess.Popen(cmd, **popen_kwargs)
    except OSError as exc:
        error = f"Failed to start background build worker: {exc}"
        _write_status("error", error=error)
        print(f"[build] {error}", file=sys.stderr, flush=True)
        if log_handle not in (subprocess.DEVNULL, None):
            try:
                log_handle.close()
            except Exception:
                pass
        return None

    # Parent no longer needs the log handle.
    if log_handle not in (subprocess.DEVNULL, None):
        try:
            log_handle.close()
        except Exception:
            pass

    print(f"[build] Background worker pid={proc.pid}", flush=True)
    return proc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build and validate the Discord clone frontend.")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Force a frontend build and exit with status 0/1 (used by Render buildCommand).",
    )
    parser.add_argument("--force", action="store_true", help="Force rebuild even if dist/index.html exists.")
    parser.add_argument("--check", action="store_true", help="Run project file/tool checks.")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only run checks; do not build.",
    )
    parser.add_argument(
        "--background",
        action="store_true",
        help="Hint that this process was started by run.py in the background.",
    )
    args = parser.parse_args(argv)

    mode = "background" if args.background else "foreground"
    print(f"[build] build_frontend.py starting ({mode})", flush=True)

    checks: list[dict[str, Any]] = []
    if args.check or args.check_only or args.build_only:
        checks = check_project_files()
        failed = [c for c in checks if not c.get("ok")]
        # Soft failures for optional python modules during pure frontend build are ok,
        # but missing core project files should fail --build-only / --check-only.
        #
        # Deployment config is soft too, and for a specific reason: inside the
        # Docker image those files are deliberately absent. .dockerignore keeps
        # render.yaml, the Dockerfile and itself out of the build context because
        # nothing at runtime reads them — they are consumed by the host platform
        # during the build. Treating them as hard failures would make
        # `--check-only` fail in the exact image that is correctly built.
        soft_failures = {
            "npm",
            "node_modules",
            "dist/index.html",
            "file:render.yaml",
            "file:Dockerfile",
            "file:.dockerignore",
        }
        hard_failures = [
            c
            for c in failed
            if not str(c.get("name", "")).startswith("python-module:")
            and c.get("name") not in soft_failures
        ]
        if hard_failures and (args.check_only or args.build_only):
            msg = "Project checks reported hard failures."
            _write_status("error", error=msg, checks=checks, message=msg)
            print(f"[check] {msg}", file=sys.stderr, flush=True)
            if args.check_only:
                return 1

    if args.check_only:
        status_label = "ready" if INDEX_FILE.exists() else "idle"
        _write_status(status_label, checks=checks, message="Checks completed.")
        print("[check] Check-only completed.", flush=True)
        return 0

    force = bool(args.force or args.build_only)
    ok = ensure_frontend_build(force=force)

    # Re-run a light post-build check so status includes dist result.
    if args.check or args.build_only or args.background:
        checks = check_project_files()

    if ok:
        _write_status("ready", checks=checks, message="Build completed successfully.")
        if args.build_only:
            print("[build] Build-only check completed successfully.", flush=True)
        return 0

    error = get_build_error() or "Frontend build failed."
    _write_status("error", error=error, checks=checks)
    if args.build_only:
        print(f"[build] Build-only check failed: {error}", file=sys.stderr, flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
