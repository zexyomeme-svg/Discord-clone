# Discord Clone — Render Ready

A Discord-style web client built with React 19, Vite 7, Tailwind CSS 4, and Zustand, served in production by a small Flask app.

The client authenticates with a Discord **bot token** entered in the login form, or with official **Discord OAuth2** sign-in. Personal account/user tokens are intentionally not supported.

Startup is optimised for speed: **`run.py` never blocks on `npm install` or a Vite build**. That work lives in **`build_frontend.py`**, which `run.py` can launch in the background so the site becomes reachable immediately.

> **Important:** This project is intended for official bot-token based testing and development. Keep tokens private, never commit secrets, and follow Discord's Developer Terms and API rules.

---

## Quick start

```bash
cd discord-clone-src

# Backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt                  # runtime deps + pytest

# Frontend
npm ci --include=dev

# Build once, then run
npm run build
python run.py                                        # http://localhost:8000
```

### Development

Run the backend and the Vite dev server together:

```bash
python run.py        # terminal 1 — Flask on :8000, provides the API proxy
npm run dev          # terminal 2 — Vite on :5173, proxies /api, /auth, /healthz to :8000
```

Open the Vite URL. **The dev server proxies the API routes to Flask**, so login, channel loading and message sending all work in dev mode. Point the proxy somewhere else with `FLASK_BACKEND_URL`.

> The proxy is required. Without it `/api/discord/*` falls through to Vite's SPA
> fallback and returns `index.html` with HTTP 200, which the client cannot parse.
> The API layer detects that case and raises an explanatory error instead of the
> misleading "Invalid token" it used to report.

### Verify everything

```bash
npm run verify        # typecheck + unit tests + production build
python -m pytest tests -v
npm run audit:review  # dependency audit against a documented allowlist
python -m py_compile run.py build_frontend.py
```

CI runs all of the above on every push (`.github/workflows/ci.yml`).

---

## Project structure

```text
.
├── run.py                     # Flask/Gunicorn entrypoint (fast startup, API proxy, OAuth2)
├── build_frontend.py          # Frontend install/build/check worker
├── requirements.txt           # Runtime Python dependencies
├── requirements-dev.txt       # Adds pytest
├── render.yaml                # Render Blueprint config
├── package.json               # Frontend dependencies and scripts
├── vite.config.ts             # Vite build config + dev-server API proxy
├── vitest.config.ts           # Unit test config (separate from the app build)
├── pytest.ini                 # Backend test config
├── index.html
├── scripts/
│   └── audit-check.mjs        # Dependency audit gate with a justified allowlist
├── tests/
│   ├── markdown.test.ts       # Renderer output + XSS resistance
│   ├── messageFormat.test.ts  # Grouping/timestamp rules
│   ├── discordApi.test.ts     # Validation limits + CDN URL helpers
│   ├── conftest.py            # Flask test fixtures
│   └── test_run.py            # Routing, proxy and OAuth2 security tests
├── dist/                      # Production build (gitignored, served by Flask)
└── src/
    ├── components/            # React UI components (Material 3)
    │   ├── Composer.tsx       # Message input, shared by the guild and DM views
    │   └── …                  # ServerList, ChannelList, DMList, MessageArea,
    │                          #   DMMessageArea, MemberList, UserPanel,
    │                          #   SettingsModal, OAuthDashboard, LoginScreen,
    │                          #   LoadingScreen, ErrorNotification
    ├── services/discordApi.ts # REST client + Gateway WebSocket
    ├── store/                 # Zustand state
    ├── utils/
    │   ├── markdown.ts        # Shared, XSS-safe Discord markdown renderer
    │   ├── messageFormat.ts   # Shared timestamp/grouping helpers
    │   ├── ripple.ts          # Delegated Material ripple feedback
    │   └── cn.ts
    └── index.css              # Material 3 design system + markup styles
```

---

## How startup works

| Command | What it does |
| --- | --- |
| `python run.py` | Starts Flask **immediately**. If `dist/index.html` is missing, spawns `build_frontend.py` in the background. Until the build finishes, `/` returns a temporary "Building frontend…" page that auto-refreshes every 3s. |
| `gunicorn run:app` | Same non-blocking behaviour on worker import. |
| `python build_frontend.py --build-only` | Synchronous forced rebuild + project checks (Render's build phase). |
| `python run.py --build-only` | Thin wrapper delegating to `build_frontend.py --build-only`. |
| `python build_frontend.py --check` | Validates expected files/tools without forcing a rebuild. |

`/healthz` reports:

```json
{
  "status": "ok",
  "frontendBuilt": true,
  "buildStatus": "ready",
  "buildError": null,
  "buildMessage": null,
  "backgroundBuild": true,
  "oauthConfigured": false
}
```

Background activity is logged to `.frontend_build.log` and summarised in `.frontend_build_status.json` (both gitignored). A file lock prevents concurrent Gunicorn workers from stacking builds.

Light startup checks are **off by default** (`RUN_STARTUP_CHECKS=0`) so a multi-worker boot does not spawn a subprocess per worker. They still run automatically when `dist/` is missing.

---

## Security model

### Token handling

* **Bot token** — pasted into the login form, stored in `localStorage`, sent as `Authorization: Bot <token>`. Never committed, never read from the environment.
* **OAuth2 access token** — never appears in a URL. `/auth/discord/callback` puts it in a **signed, short-lived (120s), `HttpOnly` cookie scoped to `/api/oauth/exchange`**, and the SPA collects it exactly once via `POST /api/oauth/exchange`. This keeps it out of access logs, browser history and `Referer` headers.
* **Logout revokes.** In OAuth mode, logout calls Discord's `/oauth2/token/revoke` so the token stops working immediately rather than lingering until it expires.

Because the bot token is readable by JavaScript in `localStorage`, the message renderer is treated as a hard security boundary — see below.

### Message rendering

Message content reaches the DOM through `dangerouslySetInnerHTML`, so `src/utils/markdown.ts` escapes **all** untrusted input first and only then applies Discord's markup rules to the escaped text. Guarantees:

* Every replacer is a **function**, never a `$1` template string, so `$&`/`$1` sequences in user content cannot be re-expanded.
* Code fences and inline code are lifted out into sentinel placeholders before any transform runs, so nothing inside code is rewritten. Sentinel characters are stripped from input first, so a placeholder cannot be forged.
* Resolved names (usernames, nicknames, role names, channel names) come from Discord data and are **escaped again** at insertion time.
* URLs are percent-encoded; only `http(s)` and the Discord CDN are ever emitted.

This is covered by a structural test suite that asserts, for 20 hostile payloads, that **only** whitelisted tags and **only** whitelisted attributes per tag survive into the output, and that no URL-bearing attribute points anywhere unexpected.

> Note on assertions: escaped payload text such as
> `&lt;img src=x onerror=alert(1)&gt;` legitimately contains the characters
> "onerror=". Grepping rendered output for that string produces false positives.
> The tests therefore inspect live tag/attribute structure instead.

### Backend hardening

* **No wildcard CORS by default.** `CORS_ORIGINS` defaults to empty, meaning same-origin only — which is all this app needs. The previous `*` default made any deployment an open relay for Discord API traffic.
* **Trusted hosts only.** Absolute URLs (OAuth redirect URIs) are built from `PUBLIC_BASE_URL`, or from `X-Forwarded-Host`/`Host` **only** when that hostname appears in `TRUSTED_HOSTS` (localhost is always trusted for local development). Otherwise OAuth fails closed with a 503 explaining what to set. An attacker-supplied `X-Forwarded-Host` can no longer dictate the redirect URI.
* **No internal error leakage.** Proxy failures are logged server-side; the client receives a generic message. It previously received the full Python exception, including host, port and TLS internals.
* **Proxy endpoint guard.** `_is_safe_endpoint()` rejects dot-segments, leading slashes, embedded schemes and userinfo tricks before the request is built.
* **Upload cap.** `MAX_CONTENT_LENGTH` is set (default 32 MB) so the proxy cannot be made to buffer unbounded bodies.
* **Security headers** on every response: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`.
* **Path traversal** is blocked by Werkzeug's `safe_join` inside `send_from_directory`; an explicit containment check backs it up. Traversal attempts fall through to the SPA shell.
* **OAuth state** is CSRF-protected with `secrets.compare_digest` and a timestamp, and the `error` query parameter is sanitised against a strict pattern rather than reflected.

### Bot User-Agent

The proxy deliberately does **not** forward the browser's `User-Agent`. Discord/Cloudflare can reject Bot API calls that look like browser traffic with:

```json
{"message":"internal network error","code":40333}
```

A bot-style `DISCORD_USER_AGENT` is sent instead. If you still see 40333, your host's shared IP may be blocked — try a different host or a VPS with a static IP.

---

## Login and token format

Paste the bot token into the login form. Both formats are accepted:

```text
YOUR_BOT_TOKEN
Bot YOUR_BOT_TOKEN
```

The client normalises the value, so Discord receives the expected `Authorization: Bot ...` header.

A 401 response produces: *"Invalid bot token. Personal account/user tokens are not supported."*

---

## Discord OAuth2 login

Discord's authorization-code grant is the standard flow: the user is redirected to Discord, Discord returns a temporary `code`, and the backend exchanges it for a Bearer token — without ever seeing a password or personal token.

### 1. Configure the Discord application

1. Go to <https://discord.com/developers/applications>.
2. Open your application → **OAuth2**.
3. Copy the **Client ID** and **Client Secret**.
4. Add the redirect URL:

   ```text
   https://YOUR-RENDER-APP.onrender.com/auth/discord/callback
   ```

   For local testing also add:

   ```text
   http://localhost:8000/auth/discord/callback
   ```

5. Use these scopes:

   ```text
   identify email guilds
   ```

### 2. Set environment variables

```env
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_OAUTH_SCOPES=identify email guilds
PUBLIC_BASE_URL=https://YOUR-RENDER-APP.onrender.com
SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(48))">
```

**`PUBLIC_BASE_URL` is required.** Without it the server has no trusted source for an absolute URL and OAuth login fails closed with a 503 telling you exactly what to set. (Alternatively set `DISCORD_REDIRECT_URI` explicitly, or list your hostname in `TRUSTED_HOSTS`.)

### 3. Flow

1. The login screen calls `/api/oauth/config` to check whether OAuth2 is usable.
2. **Continue with Discord OAuth2** → `/auth/discord/login`.
3. Flask sets a CSRF `state` cookie and redirects to Discord.
4. Discord redirects back to `/auth/discord/callback` with a `code`.
5. Flask validates `state` and its age, exchanges the code at `/oauth2/token`.
6. The token is placed in a signed `HttpOnly` cookie; the browser is redirected to `/?oauth_pending=1`.
7. The SPA calls `POST /api/oauth/exchange` once, receives the token, and the cookie is cleared.

### OAuth2 limitations

OAuth2 is not a personal account token. It can identify the user and list guilds granted by the requested scopes, but it cannot read private messages or act as the user's Discord client. Use bot-token mode for server/channel/message features. In OAuth mode the app shows a read-only dashboard instead of pretending otherwise.

---

## Personal account tokens

Personal Discord account/user tokens are intentionally **not** supported. Using a user token for automated API access is unsafe, can compromise the account, and violates Discord's platform rules. Use one of the supported options:

* **Bot token** — for server/channel/message features.
* **Discord OAuth2** — to sign a user in and share basic profile/guild data through Discord's official flow.

---

## Messages, DMs and Discord API limits

### Channel messages (bot mode)

* `GET /channels/{channel.id}/messages` — load recent and older messages (paginated 50 at a time).
* `POST /channels/{channel.id}/messages` — send, including multipart uploads.

The bot needs **View Channels**, **Read Message History**, **Send Messages**, and **Attach Files** (for uploads). Channel permission overwrites must not deny them.

### Direct messages — important

`GET /users/@me/channels` requires the `dm_channels.read` OAuth2 scope, which Discord restricts to **approved partners**. Bot tokens receive `401`, so a bot **cannot enumerate its existing DMs**.

What this client does instead:

* `POST /users/@me/channels` with a `recipient_id` **does** work for bots, so you can start a DM from the **+** button in the DM sidebar by entering a Discord user ID.
* Conversations started this way are **persisted in `localStorage`, per bot**, so the DM list survives a reload instead of being permanently empty.
* Hiding a conversation removes it from that local list.
* If the API ever does return DMs, they are merged with the locally stored ones.

### Message limits

Discord's limits are enforced in one place (`validateOutgoingMessage`) shared by the composer and the API client, so the two cannot disagree:

* 2000 characters per message.
* Up to 10 files per message.
* **25 MB total per message** — Discord's cap applies to the whole request, not to each file. (The proxy allows 32 MB to leave room for the multipart envelope; configure with `MAX_UPLOAD_MB`.)

Failed sends remove the optimistic message and **restore the draft**, including attachments.

### Rate limits

`429` responses are retried up to **3 times** within a 30-second budget, honouring `retry_after`. Previously the retry recursed with no cap, so a persistently throttled route could spin indefinitely. When the budget is exhausted the user gets a readable message.

### Realtime gateway

The Gateway WebSocket is opened directly from the browser (a WSGI proxy cannot multiplex it). Requested intents: `GUILDS`, `GUILD_MEMBERS`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`, `MESSAGE_CONTENT`.

`GUILD_MEMBERS` and `MESSAGE_CONTENT` are **privileged**. Enable them in the Developer Portal under **Bot → Privileged Gateway Intents**, or Discord closes the socket with code `4014`.

The gateway implementation:

* Sends the first heartbeat at `interval × jitter`, then on the full interval, using `setTimeout` so a blocked event loop cannot stack beats.
* Treats a missed ACK as a zombie connection and reconnects with `RESUME`.
* Handles op 1 (heartbeat request), op 7 (reconnect) and op 9 (invalid session, resuming only when Discord says it is possible).
* Reconnects with exponential backoff and jitter, up to 6 attempts, using `resume_gateway_url` when available.
* **Surfaces fatal close codes.** `4004`, `4010`, `4011`, `4012`, `4013` and `4014` are mapped to specific, actionable messages — for `4014` the message names the exact privileged intents to enable. The connection state is shown in the bottom-left user panel. Previously every close code was discarded and the client silently stopped receiving events.

---

## UI and settings

### Design system — Material 3

The layout is Discord's; the visual language is Material 3. Every token lives in
`src/index.css` under `@theme`, so Tailwind generates the utilities
(`bg-surface-container-high`, `text-on-surface-variant`, `rounded-m3-xl`,
`text-label-large`, `ease-emphasized`, …) and there is no second source of truth.

**Tonal surfaces.** In the dark scheme, elevation steps *lighter*:

| Token | Where it is used |
| --- | --- |
| `surface` | app background behind the rail, login screen |
| `surface-container-low` | guild rail, user panel |
| `surface-container` | channel drawer, DM drawer, member list, cards |
| `surface-container-high` | chat column, top app bars |
| `surface-container-highest` | text fields, popouts, snackbars |

The light scheme redefines the same tokens so elevation inverts correctly, and
adds hairline borders to elevated surfaces because tonal contrast alone is not
enough on white.

**State layers.** Hover, focus and press do not swap to a different solid
colour. `.m3-interactive::before` paints a translucent overlay of `--sl-colour`
at 8% / 10% / 10%, which composes over whatever the element already is — so a
selected `secondary-container` pill and a hovered one look right without either
cancelling the other out. This is the single biggest difference from Discord's
`hover:bg-*` approach, where selected and hovered styles have to be hand-merged.

**Elevation.** Five levels, each pairing an M3 shadow with a primary surface
tint (5% → 14%), exactly as the dark scheme specifies. `.elev-1` … `.elev-5`
set `background-image`, so they compose with any `bg-*` utility on the same
element. Tailwind's built-in `shadow-*` values were overridden with the M3
shadows, so files that were not rewritten pick them up automatically.

**Active indicators.** Selected navigation items use a `secondary-container`
pill (`rounded-m3-xl`) rather than a flat grey rectangle — the guild rail,
channel drawer, DM drawer, member list, settings nav and the mobile navigation
bar all follow it. The rail keeps Discord's growing left bar and now animates it
on the emphasized curve; the hover height was previously dead markup
(`group-hover` with no `group` ancestor).

**Shape scale.** `rounded-m3-xs` 4 / `-sm` 8 / `-md` 12 / `-lg` 16 / `-xl` 28.
Named distinctly so Tailwind's built-in `rounded-*` step is not silently
re-sized under components that were not rewritten.

**Type scale.** The full M3 set from `display-large` down to `label-small`,
each with its own line-height, letter-spacing and weight. `label-large` is used
for list-item labels, `title-small` for headers, `body-small` for supporting text.

**Motion.** Emphasized curves (`cubic-bezier(0.2, 0, 0, 1)` and its
decelerate/accelerate variants) rather than `ease-in-out`. Everything honours
both the in-app Reduced Motion setting and `prefers-reduced-motion`.

**Ripple.** `src/utils/ripple.ts` installs one delegated `pointerdown` listener
at the app root. Any element opts in with `data-ripple` and gets a circle sized
to cover the farthest corner from the actual press point, tinted with
`currentColor` at 16% and clipped by `.m3-interactive`'s `overflow: hidden`.
It is skipped for reduced motion, for disabled hosts, and for non-primary
buttons, and a guard prevents ripples stacking on a host still animating.

**Focus.** Every interactive element gets a 2px primary outline on
`:focus-visible`. Discord's UI has no focus indicator at all, so this is the
largest accessibility gain in the redesign.

**Components rebuilt to M3 patterns:** navigation rail (guild rail), navigation
drawer (channel/DM lists), list items (members, settings nav), navigation bar
with pill indicators (mobile), filled text field with floating label (login),
switch with growing thumb and check (settings toggles), assist chips (reactions),
snackbar (errors and confirmations), linear progress indicator (loading).

The former `--color-discord-*` tokens are kept as aliases onto the tonal ramp so
components that were not rewritten inherit the new palette instead of stranding
on the old flat colours.

### Responsive layouts

* **Desktop/tablet (`md` and wider)** — Discord-style columns: 72px guild rail, 240px channel/DM drawer, chat, optional 240px member list, 52px user panel.
* **Mobile (`< md`)** — single-panel navigation with a 56px top app bar and an 80px M3 navigation bar (pill indicator behind each destination) for Servers, Channels/DMs, Chat and Members.

### Message markup

`src/utils/markdown.ts` renders: code fences (with a language tag), inline code, **bold**, *italic*, ***both***, __underline__, ~~strikethrough~~, ||spoilers||, `#`/`##`/`###` headings, blockquotes (consecutive lines merge), autolinks, user/role/channel mentions, static and animated custom emoji, and `<t:unix:style>` timestamps in all six styles.

Mentions resolve to **real names** — nicknames first, then global name, then username — using the message's `mentions`, the guild member list, and the role/channel lists. Unresolvable IDs render in a muted style rather than pretending to be a real name. Streamer Mode masks all of them. Markup inside code spans and fences is never transformed.

The guild and DM views share this one renderer. They previously had separate copies that had drifted apart, and the mention/emoji/blockquote rules in both matched a literal `<` against already-escaped text — so they never fired at all.

### Functional controls

Visible controls either perform a supported action or open a supported Discord/browser page:

* **Composer** — sends text, validates Discord's limits, selects/removes attachments, inserts a quick emoji, restores the draft on failure. Shared by the guild and DM views (`components/Composer.tsx`) so the two cannot drift. Shows a live character count once within 200 of Discord's 2000-character limit, blocks sending past it with an inline error, and has an explicit send button that stays inert until there is something to send.
* **Message actions** — add a 👍 reaction (bot mode), copy a reply mention, copy message text. The bar is hover- *and* keyboard-reachable (`:focus-within`), so it can be opened without a pointer.
* **Reactions** — incoming `MESSAGE_REACTION_ADD` events update counts live, and clicking an existing reaction chip now adds that same emoji rather than doing nothing.
* **Search** — channel and DM areas filter loaded messages; `Ctrl+K` focuses the active search box.
* **Keybinds** — `Ctrl+Shift+M` mute, `Ctrl+Shift+D` deafen, `Ctrl+Shift+U` upload picker, `Escape` closes settings.
* **Unread badges** — per channel/DM/server, plus the browser tab title.
* **Notifications** — desktop notifications request permission through the store, so the permission result and the saved preference cannot disagree. A denied or blocked state is reported to the user. Sounds use a single reused `AudioContext` (constructing one per message leaks contexts).
* **Voice & Video** — saves local mute/deafen state and browser input/output device preferences.
* **Appearance/accessibility** — theme, compact mode, chat font size, message-group spacing, role colours, saturation, reduced motion and high contrast are applied live and persisted.
* **Streamer Mode** — masks user names, role names and channel names.
* **Profiles** — saves a local preview/display-name preference only.
* **DM list** — start a DM by user ID, hide conversations, group DM icons.

Account password, email, phone, 2FA, disable-account, delete-account and global avatar/profile mutations are **not** exposed: bot-token and OAuth2 API sessions cannot perform them.

Presentation filters (saturation, high contrast) are applied to `<html>`, never to `<body>`. A `filter` on a non-root element becomes the containing block for `position: fixed` descendants, which would trap the full-screen settings modal, and they are only engaged when a setting actually needs them.

---

## Environment variables

See `.env.example` for the annotated list. Summary:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` / set by Render | Flask/Gunicorn port. |
| `SECRET_KEY` | generated | Signs the OAuth2 handoff cookie. Persisted to `.flask_secret_key` if unset — set it explicitly on ephemeral filesystems. |
| `DISCORD_API_BASE` | `https://discord.com/api/v10` | Upstream REST base URL. |
| `CORS_ORIGINS` | *(empty)* | Empty = same-origin only. `*` is accepted but makes the deployment an open relay. |
| `PROXY_TIMEOUT` | `30` | Upstream timeout, seconds. |
| `MAX_UPLOAD_MB` | `32` | Maximum request body the proxy buffers. |
| `FLASK_DEBUG` | `0` | Local debugging only. |
| `AUTO_BUILD_FRONTEND` | `1` | Build when `dist/index.html` is missing. |
| `BACKGROUND_BUILD` | `1` | Spawn the build in the background rather than blocking startup. |
| `RUN_STARTUP_CHECKS` | `0` | Also run light checks when `dist/` already exists. |
| `NODE_VERSION` | `22.22.3` | Node for the `nodeenv` fallback. Node 20 reached EOL in April 2026. |
| `NODEENV_DIR` | `.nodeenv` | Where `nodeenv` installs Node. |
| `NPM_BINARY` | unset | Explicit npm path. |
| `FLASK_BACKEND_URL` | `http://127.0.0.1:8000` | Where the Vite dev server proxies `/api` and `/auth`. |
| `DISCORD_USER_AGENT` | `DiscordBot (…)` | Bot-style UA for the proxy. Do not use a browser UA. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | unset | OAuth2 application credentials. |
| `DISCORD_OAUTH_SCOPES` | `identify email guilds` | Requested scopes. |
| `PUBLIC_BASE_URL` | unset | **Required for OAuth2.** Public site URL used to build the redirect URI. |
| `DISCORD_REDIRECT_URI` | unset | Explicit callback URL, overrides `PUBLIC_BASE_URL`. |
| `TRUSTED_HOSTS` | *(empty)* | Comma-separated hostnames whose `X-Forwarded-Host` may be used when `PUBLIC_BASE_URL` is unset. |
| `OAUTH_STATE_MAX_AGE` | `600` | CSRF state cookie lifetime, seconds. |
| `OAUTH_HANDOFF_MAX_AGE` | `120` | One-time token handoff cookie lifetime, seconds. |

---

## Deploy on Render

### Option A — Blueprint

Push the repository and choose **New +** → **Blueprint**. Render reads `render.yaml`. Then set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `PUBLIC_BASE_URL` in the dashboard (they are marked `sync: false`).

### Option B — Manual Web Service

* **Environment:** Python
* **Build Command:**

  ```bash
  pip install -r requirements.txt && python build_frontend.py --build-only
  ```

* **Start Command:**

  ```bash
  gunicorn run:app --bind 0.0.0.0:$PORT
  ```

* **Health Check Path:** `/healthz`

`build_frontend.py --build-only` uses system npm when available, otherwise installs a local Node runtime via `nodeenv`. Because the heavy build runs in Render's **build** phase, the start command only imports `run:app` and binds Gunicorn quickly. The background rebuild remains as a safety net if `dist/` is ever missing at runtime.

---

## Dependency audit

`npm audit --omit=dev` reports **0** vulnerabilities — but only because every outstanding advisory is in the build toolchain, which is never shipped to the browser. That makes it a poor gate on its own.

`npm run audit:review` audits the **full** tree and fails on any high/critical advisory in a production dependency, or any dev advisory that is not on an explicit allowlist with a written justification in `scripts/audit-check.mjs`.

Current accepted findings:

| Package | Advisory | Why it is accepted |
| --- | --- | --- |
| `braces` | GHSA-vfj7-8cjw-p6xm (high, CVSS 7.5) | **No patched release exists** (`first_patched_version: null`). Reached only via `micromatch` ← `vite-plugin-singlefile`, a build-time plugin that is never bundled into `dist/`. It only ever sees glob patterns from our own Vite config, so the stack-exhaustion DoS is not reachable from untrusted input. `npm audit fix --force` "resolves" this by downgrading to `vite-plugin-singlefile@0.9.0`, which is strictly worse. |

All other advisories found during the last review (postcss, browserslist, esbuild, nanoid, source-map-js, baseline-browser-mapping) were fixed by `npm audit fix`.

---

## Tests

```bash
npm test                     # 102 unit tests (Vitest)
python -m pytest tests -v    # 65 backend tests (pytest + Flask test client)
```

Frontend coverage: markdown rendering for every supported construct, the full XSS payload battery with structural assertions, code-block protection, mention/role/channel/emoji/timestamp resolution, streamer-mode masking, sentinel forgery, message grouping rules, timestamp formatting, upload and length validation, gateway intent bits, and CDN URL construction.

Backend coverage: health and SPA serving, path traversal, trusted-host handling and host-header injection, OAuth state/CSRF validation, error-parameter sanitisation, the signed handoff cookie (issue, exchange, tamper, forge, expire, path scoping), token revocation, proxy endpoint guarding, header forwarding, error-detail leakage, CORS policy, upload limits and security headers.

---

## Notes and limitations

* The Flask proxy handles Discord **REST** calls only. The Gateway WebSocket is opened directly from the browser.
* `vite-plugin-singlefile` is enabled, so the production build is a single self-contained `dist/index.html` (~431 kB, ~122 kB gzipped).
* Some Discord features require privileged bot intents and correct server permissions.
* Never hard-code a bot token in source or environment variables.
* The repository previously contained a committed Python virtualenv under `.local/` (211 files, 2.2 MB) that could not even import Flask. It has been removed from tracking and root `.gitignore` now prevents a recurrence.
