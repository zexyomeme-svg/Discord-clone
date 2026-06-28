# Discord Clone — Render Ready

A Discord-style web client built with React, Vite, Tailwind CSS, Zustand, and a small Flask server for production hosting on Render. The app uses a Discord **bot token** entered in the login form and stores it only in the browser's local storage. `run.py` automatically installs/builds the frontend if `dist/index.html` is missing.

> **Important:** This project is intended for bot-token based testing/development. Keep tokens private, never commit secrets, and follow Discord's Developer Terms and API rules.

## What was optimized for Render

- Added `run.py`, a Flask entrypoint that:
  - automatically finds npm, or installs a local Node.js runtime with `nodeenv` if npm is unavailable,
  - automatically runs `npm ci --include=dev`/`npm install --include=dev` and `npm run build` if `dist/index.html` is missing,
  - serves the Vite production build from `dist/`,
  - provides a `/healthz` health check with frontend build status,
  - provides a same-origin `/api/discord/*` proxy to avoid browser CORS issues for Discord REST API calls.
- Added `requirements.txt` with Flask, Gunicorn, CORS, Requests, and `nodeenv` dependencies.
- Added `render.yaml` with build and start commands.
- Updated the frontend API service to use the local Flask proxy for same-origin REST requests and normalize bot tokens automatically.
- Updated package metadata and build scripts.
- Updated Vite to a patched version and verified TypeScript/build output.
- Added `.gitignore` and `.env.example`.

## Project structure

```text
.
├── run.py                  # Flask/Gunicorn entrypoint for Render
├── requirements.txt        # Python dependencies
├── render.yaml             # Optional Render Blueprint config
├── package.json            # Frontend dependencies and scripts
├── vite.config.ts          # Vite build config
├── index.html
└── src/
    ├── components/         # React UI components
    ├── services/           # Discord API client
    ├── store/              # Zustand state
    └── index.css           # Tailwind/theme styles
```

## Local development

### 1. Install dependencies

```bash
npm install
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
```

### 2. Run the React dev server

```bash
npm run dev
```

Open the Vite URL printed in the terminal. For full API functionality without CORS errors, test the production server locally instead, because `python run.py` provides the `/api/discord/*` proxy used by the frontend.

### 3. Start the full Python server locally

```bash
python run.py
```

`run.py` checks for `dist/index.html` at startup. If the file is missing, it automatically installs frontend dependencies and runs `npm run build`, then starts Flask. Open <http://localhost:8000>.

If you want to build manually first, you can still run:

```bash
npm run build
python run.py
```

## Deploy on Render

### Option A: Render Blueprint

1. Push this folder to a Git repository.
2. In Render, choose **New +** → **Blueprint**.
3. Select your repository.
4. Render will use `render.yaml` automatically.

### Option B: Manual Web Service

Create a new Render **Web Service** with these settings:

- **Environment:** Python
- **Build Command:**

  ```bash
  pip install -r requirements.txt && python run.py --build-only
  ```

- **Start Command:**

  ```bash
  gunicorn run:app --bind 0.0.0.0:$PORT
  ```

- **Health Check Path:** `/healthz`

`run.py --build-only` uses system npm when available. If npm is unavailable, it uses `nodeenv` from `requirements.txt` to install a local Node.js runtime automatically. You can set `NODE_VERSION=20.20.2` or use the included `render.yaml`.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` locally / set by Render | Port for Flask/Gunicorn. |
| `DISCORD_API_BASE` | `https://discord.com/api/v10` | Upstream Discord REST API base URL. |
| `CORS_ORIGINS` | `*` | CORS setting for `/api/*`; same-origin production use usually does not need this changed. |
| `PROXY_TIMEOUT` | `30` | Discord proxy request timeout in seconds. |
| `FLASK_DEBUG` | `0` | Set to `1` only for local debugging. |
| `AUTO_BUILD_FRONTEND` | `1` | When enabled, `run.py` automatically installs/builds the Vite frontend if `dist/index.html` is missing. Set to `0` to disable. |
| `NODE_VERSION` | `20.20.2` | Node.js version for the local `nodeenv` fallback when system npm is unavailable. |
| `NODEENV_DIR` | `.nodeenv` | Directory for the local Node.js runtime installed by `nodeenv`. |
| `NPM_BINARY` | unset | Optional explicit path/name for npm. |

## Login / token format

Paste your bot token directly into the login form. The app accepts either of these formats:

```text
YOUR_BOT_TOKEN
Bot YOUR_BOT_TOKEN
```

The frontend normalizes the value before sending requests, so the Discord API receives the expected `Authorization: Bot ...` header.

## Notes and limitations

- The Flask proxy handles Discord REST API calls only. The Discord Gateway WebSocket connection is still made directly from the browser.
- The app expects a Discord bot token entered in the login form. Do not hard-code this token in source code or environment variables.
- Some Discord API features require privileged bot intents and proper server permissions.
- `vite-plugin-singlefile` is enabled, so the production build is a compact single `dist/index.html` bundle.
- On Render, the `render.yaml` build command runs `python run.py --build-only`, which builds the frontend with system npm or the `nodeenv` fallback. The startup auto-build remains as a safety net for missing build output.

## Verification commands used

```bash
npm install
npx tsc --noEmit
npm run build
python -m py_compile run.py
python run.py --build-only
python run.py
```
