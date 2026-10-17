/**
 * Discord REST + Gateway client.
 *
 * REST calls go through the same-origin Flask proxy (`/api/discord/*`) so the
 * browser never has to deal with Discord's CORS policy. The Gateway WebSocket is
 * opened directly from the browser because a WSGI proxy cannot multiplex it.
 */

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const LOCAL_PROXY_BASE = '/api/discord';

/** Hard cap on rate-limit retries. Previously unbounded, which could spin forever. */
const MAX_RATE_LIMIT_RETRIES = 3;

/** Longest total time we are willing to spend waiting out rate limits (ms). */
const RATE_LIMIT_RETRY_BUDGET_MS = 30_000;

function isLocalProxyAvailable() {
  return typeof window !== 'undefined' && window.location.protocol !== 'file:';
}

function buildApiUrl(endpoint: string) {
  if (isLocalProxyAvailable()) {
    return `${LOCAL_PROXY_BASE}${endpoint}`;
  }
  return `${DISCORD_API_BASE}${endpoint}`;
}

export type AuthMode = 'bot' | 'oauth';

/**
 * Gateway intents requested on Identify.
 *
 * GUILD_MEMBERS (2) and MESSAGE_CONTENT (32768) are *privileged*: they must be
 * enabled in the Developer Portal or Discord closes the socket with code 4014.
 * The close-code handling below turns that into a readable message instead of a
 * silent disconnect.
 */
export const GATEWAY_INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
} as const;

export const DEFAULT_INTENTS =
  GATEWAY_INTENTS.GUILDS |
  GATEWAY_INTENTS.GUILD_MEMBERS |
  GATEWAY_INTENTS.GUILD_MESSAGES |
  GATEWAY_INTENTS.DIRECT_MESSAGES |
  GATEWAY_INTENTS.MESSAGE_CONTENT;

/** Intents that require the "Privileged Gateway Intents" toggle. */
const PRIVILEGED_INTENTS: Array<{ bit: number; name: string; portal: string }> = [
  { bit: GATEWAY_INTENTS.GUILD_MEMBERS, name: 'Server Members Intent', portal: 'Bot → Privileged Gateway Intents → SERVER MEMBERS INTENT' },
  { bit: GATEWAY_INTENTS.MESSAGE_CONTENT, name: 'Message Content Intent', portal: 'Bot → Privileged Gateway Intents → MESSAGE CONTENT INTENT' },
];

/** Discord gateway close codes that must not be retried. */
const FATAL_CLOSE_CODES: Record<number, string> = {
  4004: 'The gateway rejected the token (close code 4004). Check that it is a valid bot token and has not been reset.',
  4010: 'Invalid shard (close code 4010).',
  4011: 'Sharding is required for this bot (close code 4011). It is in too many guilds for a single shard.',
  4012: 'Invalid API version (close code 4012).',
  4013: 'Invalid intent bitfield (close code 4013).',
};

/** Discord's upload limit is per *message*, not per file. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;
export const MAX_MESSAGE_LENGTH = 2000;

export function normalizeBotToken(token: string) {
  return token.trim().replace(/^Bot\s+/i, '');
}

function getHeaders(token: string, mode: AuthMode = 'bot', hasBody = false, isFormData = false) {
  const cleanToken = mode === 'bot' ? normalizeBotToken(token) : token.trim().replace(/^Bearer\s+/i, '');
  const headers: Record<string, string> = {
    'Authorization': mode === 'bot' ? `Bot ${cleanToken}` : `Bearer ${cleanToken}`,
  };
  if (hasBody && !isFormData) headers['Content-Type'] = 'application/json';
  return headers;
}

/** True when the response looks like an HTML page rather than a Discord API reply. */
function looksLikeHtml(text: string) {
  const head = text.slice(0, 512).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

interface RequestState {
  attempts: number;
  startedAt: number;
}

async function apiRequest(
  endpoint: string,
  token: string,
  options: RequestInit = {},
  mode: AuthMode = 'bot',
  state: RequestState = { attempts: 0, startedAt: Date.now() },
): Promise<any> {
  const url = buildApiUrl(endpoint);
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        ...getHeaders(token, mode, Boolean(options.body), isFormData),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error('Unable to connect to the API. Make sure the Python server is running.');
  }

  const text = await res.text();

  // A 200 HTML page means the request hit the SPA fallback instead of the API —
  // typically a dev server running without the Flask proxy configured. Surface
  // that explicitly instead of returning HTML that callers read as "Invalid token".
  if (text && looksLikeHtml(text)) {
    throw new Error(
      'The API request returned an HTML page instead of JSON. ' +
      'This means /api/discord/* is not reaching the Flask server. ' +
      'Run `python run.py` (which proxies the API) and start Vite with `npm run dev`, ' +
      'or serve the production build from Flask directly.',
    );
  }

  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (res.ok) return data;

  if (res.status === 401) {
    throw new Error(mode === 'oauth' ? 'Discord OAuth2 session expired. Please log in again.' : 'Invalid bot token. Personal account/user tokens are not supported.');
  }
  if (res.status === 403) {
    if (typeof data === 'object' && data?.code === 40333) {
      throw new Error('Discord blocked the API request with code 40333 (internal network error). The server proxy strips browser User-Agent headers; if this persists, the hosting provider IP may be blocked by Discord/Cloudflare.');
    }
    const detail = typeof data === 'object' && data?.message ? ` Discord says: ${data.message}.` : '';
    throw new Error(`Forbidden.${detail} Check that the bot has View Channel, Read Message History, and Send Messages permissions for this channel.`);
  }
  if (res.status === 429) {
    const retryAfterSeconds = Number(data?.retry_after ?? res.headers.get('retry-after') ?? 1);
    const waitedMs = Date.now() - state.startedAt;

    // Bounded retry: give up with a clear message rather than recursing forever.
    if (
      state.attempts >= MAX_RATE_LIMIT_RETRIES ||
      !Number.isFinite(retryAfterSeconds) ||
      retryAfterSeconds <= 0 ||
      waitedMs + retryAfterSeconds * 1000 > RATE_LIMIT_RETRY_BUDGET_MS
    ) {
      const global = data?.global ? ' globally' : '';
      throw new Error(
        `Discord rate limit reached${global}. Wait ${Math.ceil(retryAfterSeconds || 1)}s and try again.`,
      );
    }

    state.attempts += 1;
    await new Promise((r) => setTimeout(r, retryAfterSeconds * 1000));
    return apiRequest(endpoint, token, options, mode, state);
  }

  const message = typeof data === 'object' && data?.message ? data.message : `API Error: ${res.status}`;
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// OAuth2 handoff with the Flask backend.
// ---------------------------------------------------------------------------

export interface OAuthConfig {
  enabled: boolean;
  clientId: string;
  scopes: string;
  redirectUri: string | null;
  warning?: string;
}

/** Read the server's OAuth2 configuration. Never throws. */
export async function fetchOAuthConfig(): Promise<OAuthConfig | null> {
  try {
    const res = await fetch('/api/oauth/config');
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || looksLikeHtml(text)) return null;
    return JSON.parse(text) as OAuthConfig;
  } catch {
    return null;
  }
}

/**
 * Attribution for this deployment: the repository it was built from and the
 * Render service it is running on.
 *
 * Fetched at runtime rather than baked in at build time because the frontend
 * ships as a single prebuilt file — pointing a deployment at a different site
 * URL must not require a rebuild.
 */
export interface AppInfo {
  name: string;
  version: string;
  /** Clickable, for the in-app UI. Null when unset or not an http(s) URL. */
  githubUrl: string | null;
  siteUrl: string | null;
  /** Plain text, for the Discord presence and other link-less contexts. */
  githubDisplay: string | null;
  siteDisplay: string | null;
  /** Server-composed default custom-status text. */
  presenceText: string;
  /** False when APP_PRESENCE_TEXT is pinned server-side. */
  presenceEditable: boolean;
}

/** Read the deployment's attribution info. Never throws. */
export async function fetchAppInfo(): Promise<AppInfo | null> {
  try {
    const res = await fetch('/api/app-info');
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || looksLikeHtml(text)) return null;
    return JSON.parse(text) as AppInfo;
  } catch {
    return null;
  }
}

/**
 * Collect the access token left in the signed handoff cookie by
 * /auth/discord/callback. Returns null when there is nothing pending.
 */
export async function exchangeOAuthHandoff(): Promise<string | null> {
  try {
    const res = await fetch('/api/oauth/exchange', { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.accessToken === 'string' && data.accessToken ? data.accessToken : null;
  } catch {
    return null;
  }
}

/** Ask the backend to revoke an OAuth2 token so logout actually ends the session. */
export async function revokeOAuthToken(accessToken: string): Promise<void> {
  try {
    await fetch('/auth/discord/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
  } catch {
    /* best-effort; local state is cleared regardless */
  }
}

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

export async function getCurrentUser(token: string, mode: AuthMode = 'bot') {
  return apiRequest('/users/@me', token, {}, mode);
}

export async function getUserProfile(token: string, userId: string) {
  return apiRequest(`/users/${encodeURIComponent(userId)}`, token);
}

export async function getGuilds(token: string, mode: AuthMode = 'bot') {
  return apiRequest('/users/@me/guilds', token, {}, mode);
}

export async function getGuild(token: string, guildId: string) {
  return apiRequest(`/guilds/${encodeURIComponent(guildId)}`, token);
}

export async function getGuildChannels(token: string, guildId: string) {
  return apiRequest(`/guilds/${encodeURIComponent(guildId)}/channels`, token);
}

/**
 * Requires the privileged GUILD_MEMBERS intent; returns [] otherwise.
 * Failures are non-fatal and handled by the caller.
 */
export async function getGuildMembers(token: string, guildId: string, limit = 100) {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit) || 100));
  return apiRequest(
    `/guilds/${encodeURIComponent(guildId)}/members?limit=${safeLimit}`,
    token,
  );
}

export async function getGuildRoles(token: string, guildId: string) {
  return apiRequest(`/guilds/${encodeURIComponent(guildId)}/roles`, token);
}

export async function getChannel(token: string, channelId: string) {
  return apiRequest(`/channels/${encodeURIComponent(channelId)}`, token);
}

export async function getChannelMessages(token: string, channelId: string, limit = 50, before?: string) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 50));
  let url = `/channels/${encodeURIComponent(channelId)}/messages?limit=${safeLimit}`;
  if (before) url += `&before=${encodeURIComponent(before)}`;
  return apiRequest(url, token);
}

/**
 * Validate an outgoing message against Discord's documented limits.
 * Returns a human-readable error string, or null when the message is valid.
 */
export function validateOutgoingMessage(content: string, files: File[]): string | null {
  const trimmed = content.trim();
  if (!trimmed && files.length === 0) return 'Cannot send an empty message.';
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return `Discord messages must be ${MAX_MESSAGE_LENGTH} characters or fewer (currently ${trimmed.length}).`;
  }
  if (files.length > MAX_UPLOAD_FILES) {
    return `Discord supports up to ${MAX_UPLOAD_FILES} files per message.`;
  }
  // Discord's limit applies to the whole request, not to each file.
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) {
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    return `Attachments total ${mb} MB. Discord allows up to 25 MB per message.`;
  }
  return null;
}

export async function sendMessage(token: string, channelId: string, content: string, files: File[] = []) {
  const validationError = validateOutgoingMessage(content, files);
  if (validationError) throw new Error(validationError);

  const trimmed = content.trim();
  const payload = {
    content: trimmed,
    tts: false,
    nonce: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
  };

  const safeChannelId = encodeURIComponent(channelId);

  if (files.length > 0) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    files.forEach((file, index) => form.append(`files[${index}]`, file, file.name));
    return apiRequest(`/channels/${safeChannelId}/messages`, token, { method: 'POST', body: form });
  }

  return apiRequest(`/channels/${safeChannelId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addReaction(token: string, channelId: string, messageId: string, emoji = '👍') {
  return apiRequest(
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}/@me`,
    token,
    { method: 'PUT' },
  );
}

/**
 * List DM channels for the signed-in account.
 *
 * IMPORTANT: `GET /users/@me/channels` requires the `dm_channels.read` OAuth2
 * scope, which Discord restricts to approved partners. Bot tokens receive 401.
 * The store therefore persists DM channels created in-session so the DM list is
 * still useful in bot mode; callers should treat a failure here as expected.
 */
export async function getDMChannels(token: string) {
  return apiRequest('/users/@me/channels', token);
}

/** Create (or fetch) a DM channel. This endpoint DOES work for bot tokens. */
export async function createDM(token: string, recipientId: string) {
  if (!/^\d{15,25}$/.test(recipientId.trim())) {
    throw new Error('Enter a valid Discord user ID to start a DM.');
  }
  return apiRequest('/users/@me/channels', token, {
    method: 'POST',
    body: JSON.stringify({ recipient_id: recipientId.trim() }),
  });
}

// ---------------------------------------------------------------------------
// Gateway (WebSocket) for real-time updates
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Presence / activity
//
// This is how the project advertises itself to people who see the bot inside
// Discord, which is the audience that never opens this web client.
//
// What a bot is allowed to send is narrow, and it shapes the design:
//   * only `name`, `state`, `type` and (for Streaming) `url` are accepted;
//     every other rich-presence field is client-only and silently dropped
//   * `url` is validated against twitch.tv and youtube.com only, so it cannot
//     carry a GitHub or Render link
//   * rich-presence `buttons` — the one genuinely clickable activity element —
//     are ignored when a bot sends them
//
// So the repository can be *shown* in a bot's status but never made clickable.
// The clickable links live in the app UI instead; see `fetchAppInfo`.
// ---------------------------------------------------------------------------

export const ACTIVITY_TYPES = {
  PLAYING: 0,
  STREAMING: 1,
  LISTENING: 2,
  WATCHING: 3,
  CUSTOM: 4,
  COMPETING: 5,
} as const;

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export interface GatewayActivity {
  name: string;
  type: number;
  /** Displayed text for a CUSTOM activity; secondary line for other types. */
  state?: string;
  /** Streaming only, and only twitch.tv/youtube.com are accepted. */
  url?: string;
}

export interface GatewayPresence {
  since: number | null;
  activities: GatewayActivity[];
  status: PresenceStatus;
  afk: boolean;
}

/**
 * Discord caps activity text well below the 128-character `name` limit, and the
 * member list truncates aggressively. Keep custom-status text inside this.
 */
export const MAX_ACTIVITY_STATE_LENGTH = 96;

/**
 * Build a custom status (activity type 4) carrying `text`.
 *
 * For type 4 the client renders `state`, not `name`, and `name` is expected to
 * be the literal string "Custom Status". Returns null for blank text so callers
 * can treat "no attribution configured" as "send no activity" rather than
 * emitting an empty custom status.
 */
export function buildCustomStatusActivity(text: string | null | undefined): GatewayActivity | null {
  const trimmed = (text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ACTIVITY_STATE_LENGTH);
  if (!trimmed) return null;
  return { name: 'Custom Status', type: ACTIVITY_TYPES.CUSTOM, state: trimmed };
}

/** A full presence payload for IDENTIFY or STATUS_UPDATE (op 3). */
export function buildPresence(
  activity: GatewayActivity | null,
  status: PresenceStatus = 'online',
): GatewayPresence {
  return {
    since: null,
    activities: activity ? [activity] : [],
    status,
    afk: false,
  };
}

/**
 * Input for {@link buildAttributionPresence}. Deliberately structural rather
 * than the store's `AppState`, so this module never depends on the store and
 * the attribution rules stay unit-testable without a DOM.
 */
export interface AttributionPresenceInput {
  /** The user's opt-out switch. */
  broadcastPresence: boolean;
  /** User-edited override; blank means "use the deployment default". */
  presenceText?: string | null;
  /** Server-composed default from GET /api/app-info. */
  defaultText?: string | null;
}

/**
 * Compose the presence that advertises this deployment to Discord users — the
 * audience that meets the bot inside a server and never opens this client.
 *
 * Returns null when attribution is switched off or there is no text to show.
 * Callers turn that into an empty activity list, because sending an empty list
 * is what *clears* a custom status: toggling the setting off has to remove the
 * text rather than leave the previous value on the bot.
 */
export function buildAttributionPresence(input: AttributionPresenceInput): GatewayPresence | null {
  if (!input.broadcastPresence) return null;
  const text = (input.presenceText || '').trim() || (input.defaultText || '');
  const activity = buildCustomStatusActivity(text);
  if (!activity) return null;
  return buildPresence(activity, 'online');
}

export type GatewayStatus =
  | 'connecting'
  | 'identifying'
  | 'ready'
  | 'reconnecting'
  | 'resuming'
  | 'closed'
  | 'fatal';

export interface GatewayHandlers {
  onMessage?: (data: any) => void;
  onReady?: (data: any) => void;
  onGuildCreate?: (data: any) => void;
  onPresenceUpdate?: (data: any) => void;
  onTypingStart?: (data: any) => void;
  onMessageDelete?: (data: any) => void;
  onMessageUpdate?: (data: any) => void;
  onReactionAdd?: (data: any) => void;
  onStatusChange?: (status: GatewayStatus, detail?: string) => void;
  onClose?: (code: number | null, detail?: string) => void;
  onError?: (err: any) => void;
}

export interface GatewayConnection {
  close: () => void;
  send: (data: any) => void;
  getStatus: () => GatewayStatus;
  /**
   * Push a STATUS_UPDATE (op 3) so the presence can change without reconnecting.
   * Safe to call before the socket is open: the payload is dropped, because
   * IDENTIFY carries the same presence and a later call can re-apply it.
   */
  setPresence: (presence: GatewayPresence) => void;
}

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const MAX_RECONNECT_ATTEMPTS = 6;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Explain a fatal close code, naming the privileged intents when relevant. */
function describeCloseCode(code: number, intents: number): string {
  if (FATAL_CLOSE_CODES[code]) return FATAL_CLOSE_CODES[code];

  if (code === 4014) {
    const missing = PRIVILEGED_INTENTS.filter((i) => (intents & i.bit) === i.bit);
    if (missing.length) {
      const list = missing.map((i) => `${i.name} (${i.portal})`).join(' and ');
      return (
        `Discord closed the gateway with code 4014: the requested intents are not allowed. ` +
        `Enable ${list} in the Discord Developer Portal, then log in again.`
      );
    }
    return 'Discord closed the gateway with code 4014 (disallowed intents).';
  }
  if (code === 4009) return 'Session timed out (close code 4009). Reconnecting.';
  return `Gateway closed with code ${code}.`;
}

export function connectGateway(
  token: string,
  handlers: GatewayHandlers = {},
  intents: number = DEFAULT_INTENTS,
  initialPresence: GatewayPresence | null = null,
): GatewayConnection {
  const gatewayToken = normalizeBotToken(token);
  // Held so a RESUME (which does not re-send presence) can re-assert it, and so
  // `setPresence` before the socket opens is not silently lost.
  let currentPresence: GatewayPresence | null = initialPresence;

  let ws: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sequence: number | null = null;
  let sessionId: string | null = null;
  let resumeGatewayUrl: string | null = null;
  let lastHeartbeatAcked = true;
  let reconnectAttempts = 0;
  let status: GatewayStatus = 'connecting';
  let intentionallyClosed = false;

  const setStatus = (next: GatewayStatus, detail?: string) => {
    status = next;
    try { handlers.onStatusChange?.(next, detail); } catch { /* ignore */ }
  };

  const clearTimers = () => {
    if (heartbeatTimer !== null) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  const send = (payload: unknown) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(payload)); } catch { /* socket died mid-send */ }
    }
  };

  /**
   * Discord asks for the first heartbeat at `interval * jitter` where jitter is
   * a random float in [0, 1). Subsequent beats use the full interval and are
   * scheduled with setTimeout so a blocked event loop cannot silently stack them.
   */
  const scheduleHeartbeat = (interval: number, first = false) => {
    if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
    const delay = first ? Math.max(1, Math.floor(interval * Math.random())) : interval;
    heartbeatTimer = setTimeout(() => {
      if (!lastHeartbeatAcked) {
        // No ACK since the last beat: the connection is a zombie. Discord
        // recommends reconnecting with a RESUME rather than waiting it out.
        heartbeatTimer = null;
        try { ws?.close(4000); } catch { /* ignore */ }
        return;
      }
      lastHeartbeatAcked = false;
      send({ op: 1, d: sequence });
      scheduleHeartbeat(interval);
    }, delay);
  };

  const identify = () => {
    setStatus('identifying');
    send({
      op: 2,
      d: {
        token: gatewayToken,
        intents,
        properties: { os: 'browser', browser: 'disclone', device: 'disclone' },
        // Only send the key when there is something to say: an empty presence
        // object is valid but pointless, and omitting it keeps IDENTIFY minimal.
        ...(currentPresence ? { presence: currentPresence } : {}),
      },
    });
  };

  const resume = () => {
    setStatus('resuming');
    send({ op: 6, d: { token: gatewayToken, session_id: sessionId, seq: sequence } });
  };

  /**
   * RESUME replays missed events but does not carry a presence, and Discord
   * clears activities for a resumed session. Re-assert once the resume lands.
   */
  const reassertPresence = () => {
    if (!currentPresence || !currentPresence.activities.length) return;
    send({ op: 3, d: currentPresence });
  };

  const scheduleReconnect = (reason: string) => {
    if (intentionallyClosed) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('fatal', `Gateway could not reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts (${reason}).`);
      handlers.onClose?.(null, reason);
      return;
    }
    // Exponential backoff with jitter, capped.
    const backoff = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
    );
    const delay = Math.floor(backoff / 2 + Math.random() * (backoff / 2));
    reconnectAttempts += 1;
    setStatus('reconnecting', reason);
    clearTimers();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // A resume is only valid on the URL Discord gave us in READY.
      connect(resumeGatewayUrl && sessionId ? resumeGatewayUrl : GATEWAY_URL, Boolean(sessionId));
    }, delay);
  };

  function connect(url: string, shouldResume: boolean) {
    if (intentionallyClosed) return;

    try {
      ws = new WebSocket(url);
    } catch (err) {
      handlers.onError?.(err);
      scheduleReconnect('failed to open socket');
      return;
    }

    ws.onmessage = (event) => {
      let data: any;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const { op, d, s, t } = data;
      if (typeof s === 'number' && s !== null) sequence = s;

      switch (op) {
        case 10: { // Hello
          const interval = Number(d?.heartbeat_interval) || 41250;
          lastHeartbeatAcked = true;
          reconnectAttempts = 0;
          scheduleHeartbeat(interval, true);
          if (shouldResume && sessionId && sequence !== null) resume();
          else identify();
          break;
        }

        case 11: // Heartbeat ACK
          lastHeartbeatAcked = true;
          break;

        case 1: // Discord asked us to heartbeat immediately
          lastHeartbeatAcked = true;
          send({ op: 1, d: sequence });
          break;

        case 0: // Dispatch
          switch (t) {
            case 'READY':
              sessionId = d?.session_id ?? null;
              resumeGatewayUrl = d?.resume_gateway_url ?? null;
              reconnectAttempts = 0;
              setStatus('ready');
              handlers.onReady?.(d);
              break;
            case 'RESUMED':
              reconnectAttempts = 0;
              setStatus('ready');
              reassertPresence();
              break;
            case 'MESSAGE_CREATE':
              handlers.onMessage?.(d);
              break;
            case 'MESSAGE_UPDATE':
              handlers.onMessageUpdate?.(d);
              break;
            case 'MESSAGE_DELETE':
              handlers.onMessageDelete?.(d);
              break;
            case 'MESSAGE_REACTION_ADD':
              handlers.onReactionAdd?.(d);
              break;
            case 'GUILD_CREATE':
              handlers.onGuildCreate?.(d);
              break;
            case 'PRESENCE_UPDATE':
              handlers.onPresenceUpdate?.(d);
              break;
            case 'TYPING_START':
              handlers.onTypingStart?.(d);
              break;
          }
          break;

        case 7: // Reconnect requested
          try { ws?.close(4000); } catch { /* ignore */ }
          break;

        case 9: { // Invalid Session
          const canResume = d === true;
          clearTimers();
          if (!canResume) {
            sessionId = null;
            sequence = null;
            resumeGatewayUrl = null;
          }
          // Discord asks clients to wait a few seconds before re-identifying.
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect(resumeGatewayUrl && canResume ? resumeGatewayUrl : GATEWAY_URL, canResume);
          }, 1000 + Math.random() * 4000);
          break;
        }

        default:
          break;
      }
    };

    ws.onclose = (event) => {
      clearTimers();
      ws = null;
      if (intentionallyClosed) {
        setStatus('closed');
        handlers.onClose?.(event?.code ?? null);
        return;
      }

      const code = event?.code ?? 0;
      const detail = describeCloseCode(code, intents);

      // 4004/4010/4011/4012/4013/4014 are not recoverable by reconnecting.
      if (FATAL_CLOSE_CODES[code] || code === 4014) {
        setStatus('fatal', detail);
        handlers.onClose?.(code, detail);
        return;
      }

      // 1000 (normal) and 1001 (going away) after READY do not need a resume.
      if (code === 1000 || code === 1001) {
        sessionId = null;
        sequence = null;
      }
      handlers.onClose?.(code, detail);
      scheduleReconnect(detail);
    };

    ws.onerror = (err) => {
      handlers.onError?.(err);
    };
  }

  setStatus('connecting');
  connect(GATEWAY_URL, false);

  return {
    close: () => {
      intentionallyClosed = true;
      clearTimers();
      try { ws?.close(1000); } catch { /* ignore */ }
      ws = null;
      setStatus('closed');
    },
    send,
    getStatus: () => status,
    setPresence: (presence: GatewayPresence) => {
      currentPresence = presence;
      // Only STATUS_UPDATE if the socket is live; otherwise IDENTIFY (or the
      // post-RESUME re-assert) will carry the new value when it reconnects.
      if (ws && ws.readyState === WebSocket.OPEN) send({ op: 3, d: presence });
    },
  };
}

// ---------------------------------------------------------------------------
// CDN helpers
// ---------------------------------------------------------------------------

export function getGuildIconUrl(guildId: string, iconHash: string | null | undefined, size = 64) {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${encodeURIComponent(guildId)}/${encodeURIComponent(iconHash)}.${ext}?size=${size}`;
}

export function getUserAvatarUrl(
  userId: string,
  avatarHash: string | null | undefined,
  discriminator?: string | null,
  size = 128,
) {
  if (!avatarHash) {
    let index = 0;
    if (discriminator && discriminator !== '0') {
      index = Number.parseInt(discriminator, 10) % 5;
      if (!Number.isFinite(index)) index = 0;
    } else {
      try { index = Number((BigInt(userId) >> 22n) % 6n); } catch { index = 0; }
    }
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.${ext}?size=${size}`;
}

/** Icon for a group DM channel (type 3). Returns null when there is none. */
export function getChannelIconUrl(channelId: string, iconHash: string | null | undefined, size = 64) {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/channel-icons/${encodeURIComponent(channelId)}/${encodeURIComponent(iconHash)}.${ext}?size=${size}`;
}

/** Resolved CDN URL for a custom emoji id. */
export function getEmojiUrl(emojiId: string, animated = false, size = 32) {
  const ext = animated ? 'gif' : 'png';
  return `https://cdn.discordapp.com/emojis/${encodeURIComponent(emojiId)}.${ext}?size=${size}`;
}
