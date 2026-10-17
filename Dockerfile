# syntax=docker/dockerfile:1
#
# One image, both hosts.
#
#   * Railway builds with this file automatically whenever it is present.
#     Railway's config-as-code files (railway.json / railway.toml) are
#     deprecated and stop being read on 2026-12-01, and new services cannot opt
#     into them at all — so a Dockerfile is the only durable way to pin the
#     build and start behaviour there.
#   * Render uses it when the service runtime is Docker. The bundled
#     render.yaml declares exactly that, so both platforms build the identical
#     artifact and cannot drift apart.
#
# The build context is the repository root, and the application lives in
# discord-clone-src/. Keeping the Dockerfile at the root means neither platform
# needs a "root directory" override to find it.
#
# Multi-stage on purpose: the frontend needs Node only to produce one static
# file, so Node is never present in the runtime image. That also removes the
# nodeenv fallback (which downloads a Node tarball at build time) from the
# critical path — it stays available for the non-Docker deployment route.

# ---------------------------------------------------------------------------
# Stage 1 — build the single-file frontend with a real Node toolchain.
# ---------------------------------------------------------------------------
FROM node:22-slim AS frontend

WORKDIR /build

# Dependencies first: this layer survives source-only changes, so editing a
# component does not re-download the whole tree. --include=dev is required
# because Vite, TypeScript and the Tailwind plugin are devDependencies.
COPY discord-clone-src/package.json discord-clone-src/package-lock.json ./
RUN npm ci --include=dev

COPY discord-clone-src/ ./

# Fail the build here rather than at deploy time if the bundle is missing or
# empty — vite-plugin-singlefile inlines everything into dist/index.html.
RUN npm run build \
 && test -s dist/index.html \
 && echo "[docker] frontend bundle: $(wc -c < dist/index.html) bytes"

# ---------------------------------------------------------------------------
# Stage 2 — runtime. Python only; no Node, no npm, no node_modules.
# ---------------------------------------------------------------------------
FROM python:3.13-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY discord-clone-src/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application source. node_modules/ and dist/ are excluded by .dockerignore, so
# the host's build output can never shadow what stage 1 produced.
COPY discord-clone-src/ ./
COPY --from=frontend /build/dist ./dist

# dist/ is baked into the image, so the runtime must never try to install Node
# or spawn a background build worker. These are the same three switches
# render.yaml sets for the non-Docker route.
ENV AUTO_BUILD_FRONTEND=0 \
    BACKGROUND_BUILD=0 \
    RUN_STARTUP_CHECKS=0 \
    FLASK_DEBUG=0 \
    NODE_ENV=production \
    PORT=8000

# Run unprivileged. /app stays writable by the app user so run.py can persist a
# shared SECRET_KEY when one is not supplied; if the filesystem is mounted
# read-only, run.py falls back to a key file under /tmp that every worker in the
# container shares. Set SECRET_KEY explicitly in production either way — both
# locations are ephemeral on Render and Railway.
RUN groupadd --system app \
 && useradd --system --gid app --home-dir /app --no-create-home app \
 && chown -R app:app /app
USER app

# Railway and Render both route to the injected PORT; EXPOSE only documents the
# default used when nothing injects one.
EXPOSE 8000

# Respected by plain Docker and Compose. Railway uses its own healthcheck path
# setting and Render uses healthCheckPath — point either of those at /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/healthz',timeout=4)"

# Shell form, so ${PORT} is expanded by the shell at container start and the
# host-injected value always wins.
#
#   --workers   >1 is safe now that run.py resolves one shared SECRET_KEY across
#               concurrent workers; without that, an OAuth handoff cookie signed
#               by one worker would fail verification in another.
#   --timeout   the Discord proxy allows 30s upstream, so keep this well clear.
#   --worker-tmp-dir /dev/shm  gunicorn's heartbeat writes a temp file per beat;
#               /dev/shm avoids overlayfs latency inside a container.
CMD gunicorn run:app \
    --bind 0.0.0.0:${PORT:-8000} \
    --workers ${WEB_CONCURRENCY:-2} \
    --threads 4 \
    --worker-class gthread \
    --worker-tmp-dir /dev/shm \
    --timeout 120 \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile -
