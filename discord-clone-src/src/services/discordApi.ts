const DISCORD_API_BASE = 'https://discord.com/api/v10';
const LOCAL_PROXY_BASE = '/api/discord';

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

const GATEWAY_INTENTS =
  1 |      // GUILDS
  2 |      // GUILD_MEMBERS
  512 |    // GUILD_MESSAGES
  4096 |   // DIRECT_MESSAGES
  32768;  // MESSAGE_CONTENT privileged intent

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



async function apiRequest(endpoint: string, token: string, options: RequestInit = {}, mode: AuthMode = 'bot'): Promise<any> {
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
      throw new Error('Discord blocked the API request with code 40333 (internal network error). The server proxy now strips browser User-Agent headers; if this persists, the hosting provider IP may be blocked by Discord/Cloudflare.');
    }
    const detail = typeof data === 'object' && data?.message ? ` Discord says: ${data.message}.` : '';
    throw new Error(`Forbidden.${detail} Check that the bot has View Channel, Read Message History, and Send Messages permissions for this channel.`);
  }
  if (res.status === 429) {
    const retryAfter = Number(data?.retry_after ?? res.headers.get('retry-after') ?? 1);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return apiRequest(endpoint, token, options, mode);
  }

  const message = typeof data === 'object' && data?.message ? data.message : `API Error: ${res.status}`;
  throw new Error(message);
}

// User
export async function getCurrentUser(token: string, mode: AuthMode = 'bot') {
  return apiRequest('/users/@me', token, {}, mode);
}

export async function getUserProfile(token: string, userId: string) {
  return apiRequest(`/users/${userId}`, token);
}

// Guilds (Servers)
export async function getGuilds(token: string, mode: AuthMode = 'bot') {
  return apiRequest('/users/@me/guilds', token, {}, mode);
}

export async function getGuild(token: string, guildId: string) {
  return apiRequest(`/guilds/${guildId}`, token);
}

export async function getGuildChannels(token: string, guildId: string) {
  return apiRequest(`/guilds/${guildId}/channels`, token);
}

export async function getGuildMembers(token: string, guildId: string, limit = 100) {
  return apiRequest(`/guilds/${guildId}/members?limit=${limit}`, token);
}

export async function getGuildRoles(token: string, guildId: string) {
  return apiRequest(`/guilds/${guildId}/roles`, token);
}

// Channels
export async function getChannel(token: string, channelId: string) {
  return apiRequest(`/channels/${channelId}`, token);
}

export async function getChannelMessages(token: string, channelId: string, limit = 50, before?: string) {
  const safeLimit = Math.max(1, Math.min(100, limit));
  let url = `/channels/${channelId}/messages?limit=${safeLimit}`;
  if (before) url += `&before=${before}`;
  return apiRequest(url, token);
}

export async function sendMessage(token: string, channelId: string, content: string, files: File[] = []) {
  const trimmed = content.trim();
  if (!trimmed && files.length === 0) throw new Error('Cannot send an empty message.');
  if (trimmed.length > 2000) throw new Error('Discord messages must be 2000 characters or fewer.');
  if (files.length > 10) throw new Error('Discord supports up to 10 files per message.');

  const maxBytes = 25 * 1024 * 1024;
  const tooLarge = files.find((file) => file.size > maxBytes);
  if (tooLarge) throw new Error(`File "${tooLarge.name}" is too large. Keep uploads at or below 25 MB.`);

  const payload = {
    content: trimmed,
    tts: false,
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };

  if (files.length > 0) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    files.forEach((file, index) => form.append(`files[${index}]`, file, file.name));
    return apiRequest(`/channels/${channelId}/messages`, token, { method: 'POST', body: form });
  }

  return apiRequest(`/channels/${channelId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addReaction(token: string, channelId: string, messageId: string, emoji = '👍') {
  return apiRequest(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, token, {
    method: 'PUT',
  });
}

// DMs
export async function getDMChannels(token: string) {
  return apiRequest('/users/@me/channels', token);
}

export async function createDM(token: string, recipientId: string) {
  return apiRequest('/users/@me/channels', token, {
    method: 'POST',
    body: JSON.stringify({ recipient_id: recipientId }),
  });
}

// Gateway (WebSocket) for real-time updates
export function connectGateway(token: string, handlers: {
  onMessage?: (data: any) => void;
  onReady?: (data: any) => void;
  onGuildCreate?: (data: any) => void;
  onPresenceUpdate?: (data: any) => void;
  onTypingStart?: (data: any) => void;
  onMessageDelete?: (data: any) => void;
  onMessageUpdate?: (data: any) => void;
  onClose?: () => void;
  onError?: (err: any) => void;
}) {
  const gatewayToken = normalizeBotToken(token);
  let ws: WebSocket | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let sequence: number | null = null;
  // @ts-ignore
  let _sessionId: string | null = null;
  let resumeGatewayUrl: string | null = null;

  function connect(url = 'wss://gateway.discord.gg/?v=10&encoding=json') {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('Gateway connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const { op, d, s, t } = data;

      if (s) sequence = s;

      switch (op) {
        case 10: // Hello
          const interval = d.heartbeat_interval;
          heartbeatInterval = setInterval(() => {
            ws?.send(JSON.stringify({ op: 1, d: sequence }));
          }, interval);

          // Identify
          ws?.send(JSON.stringify({
            op: 2,
            d: {
              token: gatewayToken,
              intents: GATEWAY_INTENTS,
              properties: {
                os: 'browser',
                browser: 'disclone',
                device: 'disclone',
              },
            },
          }));
          break;

        case 11: // Heartbeat ACK
          break;

        case 0: // Dispatch
          switch (t) {
            case 'READY':
              _sessionId = d.session_id;
              resumeGatewayUrl = d.resume_gateway_url;
              handlers.onReady?.(d);
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

        case 7: // Reconnect
          ws?.close();
          if (resumeGatewayUrl) {
            connect(resumeGatewayUrl);
          }
          break;

        case 9: // Invalid Session
          setTimeout(() => connect(), 5000);
          break;
      }
    };

    ws.onclose = () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      handlers.onClose?.();
    };

    ws.onerror = (err) => {
      handlers.onError?.(err);
    };
  }

  connect();

  return {
    close: () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      ws?.close();
    },
    send: (data: any) => ws?.send(JSON.stringify(data)),
  };
}

// Helpers
export function getGuildIconUrl(guildId: string, iconHash: string | null, size = 64) {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}

export function getUserAvatarUrl(userId: string, avatarHash: string | null, discriminator?: string, size = 128) {
  if (!avatarHash) {
    let index = 0;
    if (discriminator && discriminator !== '0') {
      index = Number.parseInt(discriminator, 10) % 5;
    } else {
      try { index = Number((BigInt(userId) >> 22n) % 6n); } catch { index = 0; }
    }
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
}

export function getChannelIconUrl(channelId: string, iconHash: string | null) {
  if (!iconHash) return null;
  return `https://cdn.discordapp.com/channel-icons/${channelId}/${iconHash}.png`;
}
