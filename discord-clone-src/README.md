# Discord Clone — Render Ready

A Discord-style web client built with React, Vite, Tailwind CSS, Zustand, and a small Flask server for production hosting on Render. The app uses a Discord **bot token** entered in the login form and stores it only in the browser's local storage. Personal account/user tokens are intentionally not supported.

Startup is optimized for speed: **`run.py` never blocks on npm install or Vite builds**. Frontend install/build/check work lives in **`build_frontend.py`**, which `run.py` can launch in the background so the website becomes reachable immediately.

> **Important:** This project is intended for official bot-token based testing/development. Keep tokens private, never commit secrets, and follow Discord's Developer Terms and API rules.

## What was optimized for Render

- Added `run.py`, a Flask entrypoint that:
  - starts the web server immediately (no blocking frontend build on import),
  - launches `build_frontend.py` in the **background** when `dist/index.html` is missing (or for light file/tool checks),
  - serves the Vite production build from `dist/`,
  - provides a `/healthz` health check with frontend build status,
  - provides a same-origin `/api/discord/*` proxy to avoid browser CORS issues for Discord REST API calls.
- Added `build_frontend.py`, the dedicated frontend build / project-check tool:
  - finds npm, or installs a local Node.js runtime with `nodeenv` if npm is unavailable,
  - runs `npm ci --include=dev` / `npm install --include=dev` and `npm run build`,
  - writes `.frontend_build_status.json` for `/healthz`,
  - supports `--build-only`, `--force`, `--check`, and `--background`.
- Added `requirements.txt` with Flask, Gunicorn, CORS, Requests, and `nodeenv` dependencies.
- Added `render.yaml` with build and start commands.
- Updated the frontend API service to use the local Flask proxy for same-origin REST requests and normalize bot tokens automatically.
- Updated package metadata and build scripts.
- Updated Vite to a patched version and verified TypeScript/build output.
- Added `.gitignore` and `.env.example`.

## Project structure

```text
.
├── run.py                  # Flask/Gunicorn entrypoint (fast startup)
├── build_frontend.py       # Frontend install/build/check worker
├── requirements.txt        # Python dependencies
├── render.yaml             # Optional Render Blueprint config
├── package.json            # Frontend dependencies and scripts
├── vite.config.ts          # Vite build config
├── index.html
├── dist/                   # Production Vite build (served by Flask)
└── src/
    ├── components/         # React UI components
    ├── services/           # Discord API client
    ├── store/              # Zustand state
    └── index.css           # Tailwind/theme styles
```

## How startup works (fast open)

| Command | What it does |
| --- | --- |
| `python run.py` | Starts Flask **immediately**. If `dist/` is missing, spawns `build_frontend.py` in the background. Until the build finishes, `/` returns a temporary “Building frontend…” page that auto-refreshes. |
| `gunicorn run:app` | Same non-blocking behavior on worker import. |
| `python build_frontend.py --build-only` | Synchronous forced rebuild + project checks (used by Render’s build phase). |
| `python run.py --build-only` | Thin wrapper that delegates to `build_frontend.py --build-only` for backwards compatibility. |
| `python build_frontend.py --check` | Validates expected files/tools without forcing a rebuild. |

Status is exposed at `/healthz`:

```json
{
  "status": "ok",
  "frontendBuilt": true,
  "buildStatus": "ready",
  "buildError": null,
  "buildMessage": "...",
  "backgroundBuild": true
}
```

Background activity is logged to `.frontend_build.log` and summarized in `.frontend_build_status.json` (both are gitignored).

## Local development

### 1. Install dependencies

```bash
npm install
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Run the React dev server

```bash
npm run dev
```

Open the Vite URL printed in the terminal. For full API functionality without CORS errors, test the production server locally instead, because `python run.py` provides the `/api/discord/*` proxy used by the frontend.

### 3. Start the full Python server locally (fast)

```bash
python run.py
```

`run.py` starts Flask right away on <http://localhost:8000>. If `dist/index.html` is missing, it starts `build_frontend.py` in the background so the server is not blocked by `npm install` / `npm run build`.

Recommended production-like flow (build once, then start quickly):

```bash
python build_frontend.py --build-only
python run.py
```

You can still build with npm directly:

```bash
npm run build
python run.py
```

### 4. Manual checks / rebuild tools

```bash
# Project file + tool checks (and build only if dist is missing)
python build_frontend.py --check

# Force a clean rebuild
python build_frontend.py --force

# Render-style build gate
python build_frontend.py --build-only
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
  pip install -r requirements.txt && python build_frontend.py --build-only
  ```

- **Start Command:**

  ```bash
  gunicorn run:app --bind 0.0.0.0:$PORT
  ```

- **Health Check Path:** `/healthz`

`build_frontend.py --build-only` uses system npm when available. If npm is unavailable, it uses `nodeenv` from `requirements.txt` to install a local Node.js runtime automatically. You can set `NODE_VERSION=20.20.2` or use the included `render.yaml`.

Because the heavy frontend build runs in Render’s **build** phase, the **start** command only imports `run:app` and binds Gunicorn quickly. Background rebuild remains available as a safety net if `dist/` is ever missing at runtime.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` locally / set by Render | Port for Flask/Gunicorn. |
| `DISCORD_API_BASE` | `https://discord.com/api/v10` | Upstream Discord REST API base URL. |
| `CORS_ORIGINS` | `*` | CORS setting for `/api/*`; same-origin production use usually does not need this changed. |
| `PROXY_TIMEOUT` | `30` | Discord proxy request timeout in seconds. |
| `FLASK_DEBUG` | `0` | Set to `1` only for local debugging. |
| `AUTO_BUILD_FRONTEND` | `1` | When enabled, missing `dist/index.html` triggers a frontend build (via background worker from `run.py`, or synchronously from `build_frontend.py`). Set to `0` to disable. |
| `BACKGROUND_BUILD` | `1` | When enabled, `run.py` spawns `build_frontend.py` in the background instead of blocking startup. Set to `0` to disable background spawning. |
| `NODE_VERSION` | `20.20.2` | Node.js version for the local `nodeenv` fallback when system npm is unavailable. |
| `NODEENV_DIR` | `.nodeenv` | Directory for the local Node.js runtime installed by `nodeenv`. |
| `NPM_BINARY` | unset | Optional explicit path/name for npm. |
| `DISCORD_USER_AGENT` | `DiscordBot (https://arena.ai, 1.0)` | Bot-style User-Agent used by the Flask Discord API proxy. Do not use a browser User-Agent. |
| `DISCORD_CLIENT_ID` | unset | Discord OAuth2 application client ID. |
| `DISCORD_CLIENT_SECRET` | unset | Discord OAuth2 application client secret. |
| `DISCORD_OAUTH_SCOPES` | `identify email guilds` | OAuth2 scopes requested at login. |
| `PUBLIC_BASE_URL` | unset | Public site URL (used to build the OAuth2 redirect URI). |
| `DISCORD_REDIRECT_URI` | unset | Optional explicit OAuth2 callback URL. |
| `OAUTH_STATE_MAX_AGE` | `600` | OAuth2 CSRF state cookie lifetime in seconds. |

## Login / token format

Paste your bot token directly into the login form. The app accepts either of these formats:

```text
YOUR_BOT_TOKEN
Bot YOUR_BOT_TOKEN
```

The frontend normalizes the value before sending requests, so the Discord API receives the expected `Authorization: Bot ...` header.

## Responsive UI

The app now has separate layouts for desktop/tablet and phones:

- **Desktop/computer (`md` and wider):** Discord-style multi-column layout with server rail, channel/DM sidebar, main chat, and optional member list.
- **Mobile (`< md`):** single-panel navigation with a top bar and bottom nav for Servers, Channels/DMs, Chat, and Members. This avoids squeezing desktop sidebars onto small screens and keeps touch targets large.

The mobile layout follows Discord's familiar navigation model: servers/channels are panels, chat is the main view, and the member list is a separate panel accessible from chat.

## Message loading and sending

For bot-token mode, this app uses Discord's documented Channel endpoints:

- `GET /channels/{channel.id}/messages` to load recent and older messages.
- `POST /channels/{channel.id}/messages` to send a message.

Discord requires the bot to have the right server/channel permissions. At minimum, invite the bot with these permissions and make sure channel overwrites do not deny them:

- **View Channels**
- **Read Message History**
- **Send Messages**
- **Attach Files** if you want uploads to work

To receive live gateway message events and full message content, enable the **Message Content Intent** in the Discord Developer Portal under **Bot → Privileged Gateway Intents**. The app requests Gateway intents for guilds, guild members, guild messages, direct messages, and message content. Without the Message Content intent, Discord may return message objects but hide message text/content in some situations.

Discord message content has a 2000 character limit for normal messages. The frontend validates this before sending.

File uploads are supported in bot-token mode using Discord multipart message uploads. The UI supports selecting up to 10 files per message and validates a 25 MB per-file limit before sending.

## Functional UI controls and settings

The app's buttons have been audited so visible controls either perform a supported action or clearly open a supported Discord/browser page. Unsupported personal-account mutation buttons were removed instead of pretending to change Discord account security settings.

Implemented controls include:

- **Message composer:** sends text, validates Discord's 2000-character limit, selects/removes attachments, uploads up to 10 files, inserts a quick emoji, and restores the draft if sending fails.
- **Message actions:** add a thumbs-up reaction in bot mode, copy a reply mention, and copy message text.
- **Search:** channel and DM message areas filter loaded messages. `Ctrl + K` focuses the current search box.
- **Keybinds:** `Ctrl + Shift + M` toggles local mute, `Ctrl + Shift + D` toggles local deafen, `Ctrl + Shift + U` opens the upload picker, and `Escape` closes settings.
- **Unread badges:** when enabled, unread counts appear on channels/DMs/servers and in the browser tab title for off-channel/background messages.
- **Notifications:** desktop notifications request browser permission and fire for incoming off-channel/background messages when enabled. Message/notification sounds use a small local browser-generated tone; browsers may require a user interaction before playing sound.
- **Voice & Video settings:** saves local mute/deafen status and browser input/output device preferences after refreshing media devices.
- **Appearance/accessibility:** theme, compact mode, chat font size, message-group spacing, role colors, saturation, reduced motion, and high contrast are applied to the live UI and persisted in local storage.
- **Streamer mode:** masks visible user names/IDs in supported UI areas.
- **Profiles:** saves a local profile preview/display-name preference only. Discord global profile/avatar changes must be done in Discord because bot/OAuth2 API sessions cannot mutate those personal account settings.
- **Server rail:** add/explore buttons open Discord's supported developer portal/server discovery pages.
- **DM list:** existing bot DM channels are listed and a bot DM can be created by recipient user ID where Discord permits it.

Account password, email, phone, 2FA, disable-account, delete-account, and global avatar/profile mutations are intentionally not exposed because they are not supported by Discord bot-token/OAuth2 API mode.

### Discord `internal network error` / code `40333`

If Discord returns:

```json
{"message":"internal network error","code":40333}
```

that usually is not a normal missing-permission error. Discord/Cloudflare can return this response when Bot API requests look like browser traffic. The Flask proxy now intentionally **does not forward the browser User-Agent** and instead sends a bot-style `DISCORD_USER_AGENT`. If this still happens, the hosting provider's shared IP may be blocked by Discord/Cloudflare; try a different host or a VPS/static IP.

OAuth2 login can show the signed-in user and guild list, but OAuth2 user tokens from the official flow cannot be used to act like the Discord client, read arbitrary private messages, or send messages as the user. Use bot-token mode for loading and sending channel messages.

## Discord OAuth2 login

This project now supports official Discord OAuth2 Authorization Code login. Discord's OAuth2 docs describe the authorization code grant as the standard flow where the user is redirected to Discord, Discord returns a temporary `code`, and the backend exchanges that code for a Bearer access token without ever asking for the user's password or personal token [1](https://discord.com/developers/docs/topics/oauth2).

### 1. Create/configure your Discord application

1. Go to <https://discord.com/developers/applications>.
2. Open your application, or create a new one.
3. Go to **OAuth2**.
4. Copy the **Client ID** and **Client Secret**.
5. Add this redirect URL:

   ```text
   https://YOUR-RENDER-APP.onrender.com/auth/discord/callback
   ```

   For local testing, add:

   ```text
   http://localhost:8000/auth/discord/callback
   ```

6. Use these scopes:

   ```text
   identify email guilds
   ```

`identify` allows `/users/@me`, and `guilds` allows `/users/@me/guilds` for basic guild membership data [1](https://discord.com/developers/docs/topics/oauth2).

### 2. Set environment variables

On Render, set these environment variables:

```env
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_OAUTH_SCOPES=identify email guilds
PUBLIC_BASE_URL=https://YOUR-RENDER-APP.onrender.com
```

`DISCORD_REDIRECT_URI` is optional. If unset, the app uses:

```text
PUBLIC_BASE_URL/auth/discord/callback
```

### 3. How it works in this app

- The login screen calls `/api/oauth/config` to see whether OAuth2 is configured.
- The **Continue with Discord OAuth2** button redirects to `/auth/discord/login`.
- Flask creates a CSRF `state` cookie and redirects to Discord.
- Discord redirects back to `/auth/discord/callback` with a temporary `code`.
- Flask validates `state`, exchanges the code at Discord's `/oauth2/token`, then redirects back to the frontend.
- The frontend uses the OAuth2 Bearer token only for safe OAuth2 endpoints like `/users/@me` and `/users/@me/guilds`.

### OAuth2 limitations

OAuth2 is not the same as a personal account token. It can safely identify the user and list guilds granted by scopes, but it does not let this app read private messages or act as the user's Discord client. For server/channel/message bot features, use the bot-token login.

## Personal account tokens

Personal Discord account/user tokens are intentionally not supported. Using a user token for automated API access is unsafe, can compromise the account, and violates Discord's platform rules. This is why the project uses Discord OAuth2 instead of asking users to paste account tokens. Use one of these supported options instead:

- **Bot token:** best for this app's server/channel/message features.
- **Discord OAuth2:** best if you only need a user to sign in and share basic profile/guild information through Discord's official authorization flow.

OAuth2 sign-in is implemented in this project through the Flask backend routes `/auth/discord/login` and `/auth/discord/callback`.

## Notes and limitations

- The Flask proxy handles Discord REST API calls only. The Discord Gateway WebSocket connection is still made directly from the browser.
- The app expects a Discord bot token entered in the login form. Do not hard-code this token in source code or environment variables.
- Some Discord API features require privileged bot intents and proper server permissions.
- `vite-plugin-singlefile` is enabled, so the production build is a compact single `dist/index.html` bundle.
- On Render, the `render.yaml` build command runs `python build_frontend.py --build-only`, which builds the frontend with system npm or the `nodeenv` fallback. Runtime background rebuild in `run.py` remains as a safety net for missing build output and does not delay Gunicorn binding.

## Verification commands used

```bash
npm install
npx tsc --noEmit
python -m py_compile run.py build_frontend.py
npm audit --omit=dev --audit-level=high
python build_frontend.py --build-only
python run.py
```
