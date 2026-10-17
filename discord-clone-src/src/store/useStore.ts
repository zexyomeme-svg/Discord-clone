import { create } from 'zustand';
import type { DiscordUser, Guild, Channel, Message, GuildMember, Role, TypingUser, ViewMode, SettingsPage, UserSettings, AuthMode } from './types';
import * as api from '../services/discordApi';
import type { GatewayConnection, GatewayStatus } from '../services/discordApi';

const SETTINGS_KEY = 'disclone_settings';
const BOT_TOKEN_KEY = 'discord_token';
const OAUTH_TOKEN_KEY = 'discord_oauth_access_token';
const AUTH_MODE_KEY = 'discord_auth_mode';
const DM_STORAGE_PREFIX = 'disclone_dm_channels:';

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  fontSize: 16,
  messageGroupSpacing: 16,
  compactMode: false,
  showRoleColors: true,
  saturation: 100,
  isMuted: false,
  isDeafened: false,
  desktopNotifications: false,
  unreadBadge: true,
  messageSound: true,
  notificationSounds: true,
  streamerMode: false,
  developerMode: false,
  reducedMotion: false,
  highContrast: false,
  language: 'en-US',
  inputDevice: 'default',
  outputDevice: 'default',
  localDisplayName: '',
  localBannerColor: '#5865f2',
  localBio: '',
};

function mergeMessagesUnique(messages: Message[]): Message[] {
  const seen = new Set<string>();
  const result: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg?.id || seen.has(msg.id)) continue;
    seen.add(msg.id);
    result.unshift(msg);
  }
  return result;
}

function isMatchingPendingMessage(pending: Message, incoming: Message) {
  if (!pending.id.startsWith('temp-')) return false;
  if (pending.channel_id !== incoming.channel_id) return false;
  if ((pending.content || '') !== (incoming.content || '')) return false;
  const pendingTime = new Date(pending.timestamp).getTime();
  const incomingTime = new Date(incoming.timestamp).getTime();
  if (!Number.isFinite(pendingTime) || !Number.isFinite(incomingTime)) return false;
  return Math.abs(incomingTime - pendingTime) < 30000;
}

function loadSettings(): UserSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch { /* ignore corrupt settings */ }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Bot tokens cannot call `GET /users/@me/channels` — Discord restricts it to the
 * `dm_channels.read` OAuth2 scope, which is limited to approved partners. DMs
 * created in this client are therefore persisted locally, per bot, so the DM
 * list survives a reload instead of being permanently empty.
 */
function loadStoredDMChannels(botUserId: string): Channel[] {
  if (!botUserId) return [];
  try {
    const raw = localStorage.getItem(DM_STORAGE_PREFIX + botUserId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((ch): ch is Channel => Boolean(ch && typeof ch.id === 'string'));
  } catch {
    return [];
  }
}

function storeDMChannels(botUserId: string, channels: Channel[]) {
  if (!botUserId) return;
  try {
    // Keep only the fields needed to render a DM row.
    const slim = channels.map((ch) => ({
      id: ch.id,
      type: ch.type,
      name: ch.name,
      icon: ch.icon,
      last_message_id: ch.last_message_id,
      recipients: (ch.recipients || []).map((r) => ({
        id: r.id,
        username: r.username,
        global_name: r.global_name ?? null,
        discriminator: r.discriminator,
        avatar: r.avatar,
        bot: r.bot,
      })),
    }));
    localStorage.setItem(DM_STORAGE_PREFIX + botUserId, JSON.stringify(slim.slice(0, 100)));
  } catch { /* storage full or unavailable */ }
}

function mergeDMChannels(primary: Channel[], secondary: Channel[]): Channel[] {
  const seen = new Set<string>();
  const merged: Channel[] = [];
  for (const ch of [...primary, ...secondary]) {
    if (!ch?.id || seen.has(ch.id)) continue;
    seen.add(ch.id);
    merged.push(ch);
  }
  return merged;
}

function escapeNotificationText(value: string) {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

let sharedAudioContext: AudioContext | null = null;

function playNotificationTone(settings: UserSettings) {
  if (!settings.messageSound && !settings.notificationSounds) return;
  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    // Reuse one context: constructing a new AudioContext per message leaks
    // contexts and browsers cap the number that may exist.
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AudioContextCtor();
    }
    const ctx = sharedAudioContext;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* blocked until gesture */ });

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch { /* ignore */ } };
  } catch { /* browsers may block audio until user interaction */ }
}

function showDesktopNotification(message: Message, state: Pick<AppState, 'userSettings' | 'channels' | 'selectedGuildId'>) {
  if (!state.userSettings.desktopNotifications) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const author = message.author?.global_name || message.author?.username || 'Discord';
    const channel = Object.values(state.channels).flat().find((ch) => ch.id === message.channel_id);
    const title = channel?.name ? `${author} in #${channel.name}` : author;
    const body = escapeNotificationText(message.content) || (message.attachments?.length ? `${message.attachments.length} attachment(s)` : 'New message');
    const notification = new Notification(title, {
      body,
      icon: api.getUserAvatarUrl(message.author?.id ?? '0', message.author?.avatar, message.author?.discriminator),
      tag: `disclone-${message.channel_id}`,
      silent: true,
    });
    notification.onclick = () => window.focus();
  } catch { /* ignore notification failures */ }
}

function notifyForIncomingMessage(message: Message, state: AppState) {
  const isOwnMessage = state.user?.id === message.author?.id;
  if (isOwnMessage) return;
  const awayFromChannel = state.selectedChannelId !== message.channel_id || (typeof document !== 'undefined' && document.hidden);
  if (!awayFromChannel) return;
  playNotificationTone(state.userSettings);
  showDesktopNotification(message, state);
}

interface AppState {
  token: string | null;
  authMode: AuthMode;
  user: DiscordUser | null;
  isLoading: boolean;
  error: string | null;
  isConnecting: boolean;
  gatewayStatus: GatewayStatus | null;
  gatewayDetail: string | null;

  viewMode: ViewMode;
  selectedGuildId: string | null;
  selectedChannelId: string | null;

  guilds: Guild[];
  channels: Record<string, Channel[]>;
  messages: Record<string, Message[]>;
  members: Record<string, GuildMember[]>;
  roles: Record<string, Role[]>;
  dmChannels: Channel[];
  typingUsers: Record<string, TypingUser[]>;

  showMemberList: boolean;
  showUserProfile: DiscordUser | null;
  isLoadingMessages: boolean;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: Record<string, boolean>;
  isSendingMessages: Record<string, boolean>;
  isLoadingChannels: boolean;
  unreadCounts: Record<string, number>;

  // Settings
  settingsOpen: boolean;
  settingsPage: SettingsPage;
  userSettings: UserSettings;

  // Gateway
  gateway: GatewayConnection | null;

  // Actions
  login: (token: string) => Promise<void>;
  loginWithOAuth: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  selectGuild: (guildId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  selectDMChannel: (channelId: string) => Promise<void>;
  createDMChannel: (recipientId: string) => Promise<void>;
  hideDMChannel: (channelId: string) => void;
  loadMessages: (channelId: string) => Promise<void>;
  loadMoreMessages: (channelId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string, files?: File[]) => Promise<void>;
  loadMembers: (guildId: string) => Promise<void>;
  loadRoles: (guildId: string) => Promise<void>;
  toggleMemberList: () => void;
  setShowUserProfile: (user: DiscordUser | null) => void;
  setError: (error: string | null) => void;
  openSettings: (page?: SettingsPage) => void;
  closeSettings: () => void;
  setSettingsPage: (page: SettingsPage) => void;
  updateSettings: (partial: Partial<UserSettings>) => void;
  clearUnread: (channelId: string) => void;
  requestNotificationPermission: () => Promise<void>;
}

/** Release object URLs created for optimistic attachments. */
function revokePendingAttachments(message: Message | undefined) {
  if (!message?.attachments?.length) return;
  for (const att of message.attachments) {
    if (typeof att.url === 'string' && att.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(att.url); } catch { /* ignore */ }
    }
  }
}

const useStore = create<AppState>((set, get) => ({
  token: localStorage.getItem(OAUTH_TOKEN_KEY) || localStorage.getItem(BOT_TOKEN_KEY),
  authMode: (localStorage.getItem(AUTH_MODE_KEY) as AuthMode) || (localStorage.getItem(OAUTH_TOKEN_KEY) ? 'oauth' : 'bot'),
  user: null,
  isLoading: false,
  error: null,
  isConnecting: false,
  gatewayStatus: null,
  gatewayDetail: null,
  viewMode: 'servers',
  selectedGuildId: null,
  selectedChannelId: null,
  guilds: [],
  channels: {},
  messages: {},
  members: {},
  roles: {},
  dmChannels: [],
  typingUsers: {},
  showMemberList: true,
  showUserProfile: null,
  isLoadingMessages: false,
  isLoadingMoreMessages: false,
  hasMoreMessages: {},
  isSendingMessages: {},
  isLoadingChannels: false,
  unreadCounts: {},
  settingsOpen: false,
  settingsPage: 'my-account',
  userSettings: loadSettings(),
  gateway: null,

  login: async (token: string) => {
    const normalizedToken = api.normalizeBotToken(token);
    if (!normalizedToken) throw new Error('Please enter a token');

    set({ isLoading: true, error: null, isConnecting: true, gatewayStatus: 'connecting', gatewayDetail: null });
    try {
      const user = await api.getCurrentUser(normalizedToken);
      if (!user || typeof user !== 'object' || !user.id) throw new Error('Invalid token');
      localStorage.setItem(BOT_TOKEN_KEY, normalizedToken);
      localStorage.setItem(AUTH_MODE_KEY, 'bot');
      localStorage.removeItem(OAUTH_TOKEN_KEY);

      const guilds = await api.getGuilds(normalizedToken);

      // Bot tokens cannot list DMs (dm_channels.read is partner-only), so start
      // from what this browser remembers and merge in anything the API did give.
      const stored = loadStoredDMChannels(user.id);
      let fetched: Channel[] = [];
      try {
        const result = await api.getDMChannels(normalizedToken);
        if (Array.isArray(result)) fetched = result as Channel[];
      } catch { /* expected for bot tokens */ }
      const dmChannels = mergeDMChannels(fetched, stored);
      storeDMChannels(user.id, dmChannels);

      let gateway: GatewayConnection | null = null;
      try {
        gateway = api.connectGateway(normalizedToken, {
          onStatusChange: (status: GatewayStatus, detail?: string) => {
            set({
              gatewayStatus: status,
              gatewayDetail: detail ?? null,
              isConnecting: status === 'connecting' || status === 'identifying' || status === 'resuming',
            });
            // Fatal gateway states must reach the user; previously they were
            // swallowed and the client silently stopped receiving events.
            if (status === 'fatal' && detail) set({ error: detail });
          },
          onMessage: (data: Message) => {
            if (!data?.id || !data?.channel_id) return;
            const state = get();
            const chId = data.channel_id;
            const current = state.messages[chId];
            const isOwnMessage = state.user?.id === data.author?.id;
            const isAway = state.selectedChannelId !== chId || (typeof document !== 'undefined' && document.hidden);
            const shouldMarkUnread = !isOwnMessage && state.userSettings.unreadBadge && isAway;
            const patch: Partial<AppState> = {};

            if (current) {
              if (current.some((m: Message) => m.id === data.id)) {
                patch.messages = { ...state.messages, [chId]: mergeMessagesUnique(current.map((m: Message) => m.id === data.id ? data : m)) };
              } else {
                const pendingIndex = current.findIndex((m: Message) => isMatchingPendingMessage(m, data));
                if (pendingIndex >= 0) {
                  const next = [...current];
                  revokePendingAttachments(next[pendingIndex]);
                  next[pendingIndex] = data;
                  patch.messages = { ...state.messages, [chId]: mergeMessagesUnique(next) };
                } else {
                  patch.messages = { ...state.messages, [chId]: mergeMessagesUnique([...current, data]) };
                }
              }
            }

            if (shouldMarkUnread) {
              patch.unreadCounts = { ...state.unreadCounts, [chId]: (state.unreadCounts[chId] || 0) + 1 };
            }

            if (Object.keys(patch).length > 0) set(patch);
            // Read state after the patch so notification decisions reflect it.
            notifyForIncomingMessage(data, get());
          },
          onMessageUpdate: (data: Message) => {
            if (!data?.id || !data?.channel_id) return;
            const state = get();
            const chId = data.channel_id;
            const current = state.messages[chId];
            if (!current) return;
            set({ messages: { ...state.messages, [chId]: mergeMessagesUnique(current.map((m: Message) => m.id === data.id ? { ...m, ...data } : m)) } });
          },
          onMessageDelete: (data) => {
            if (!data?.id || !data?.channel_id) return;
            const state = get();
            const chId = data.channel_id;
            if (state.messages[chId]) {
              set({ messages: { ...state.messages, [chId]: state.messages[chId].filter((m: Message) => m.id !== data.id) } });
            }
          },
          onReactionAdd: (data) => {
            if (!data?.message_id || !data?.channel_id) return;
            const state = get();
            const chId = data.channel_id;
            const current = state.messages[chId];
            if (!current) return;
            const emojiName = data.emoji?.name || '👍';
            const isSelf = data.user_id === state.user?.id;
            set({
              messages: {
                ...state.messages,
                [chId]: current.map((m: Message) => {
                  if (m.id !== data.message_id) return m;
                  const reactions = Array.isArray(m.reactions) ? [...m.reactions] : [];
                  const existingIndex = reactions.findIndex((r) => (r.emoji?.name || r.emoji?.id) === (data.emoji?.id || emojiName));
                  if (existingIndex >= 0) {
                    const existing = reactions[existingIndex];
                    reactions[existingIndex] = {
                      ...existing,
                      count: (existing.count || 0) + 1,
                      me: existing.me || Boolean(isSelf),
                    };
                  } else {
                    reactions.push({ count: 1, me: Boolean(isSelf), emoji: { id: data.emoji?.id ?? null, name: emojiName } });
                  }
                  return { ...m, reactions };
                }),
              },
            });
          },
          onTypingStart: (data) => {
            if (!data?.channel_id) return;
            const state = get();
            const chId = data.channel_id;
            if (data.user_id === state.user?.id) return;
            const existing = (state.typingUsers[chId] || []).filter((t: TypingUser) => t.userId !== data.user_id);
            const username = data.member?.user?.username || data.member?.nick || 'Someone';
            set({ typingUsers: { ...state.typingUsers, [chId]: [...existing, { userId: data.user_id, username, timestamp: Date.now() }] } });
            setTimeout(() => {
              const s = get();
              set({ typingUsers: { ...s.typingUsers, [chId]: (s.typingUsers[chId] || []).filter((t: TypingUser) => Date.now() - t.timestamp < 10000) } });
            }, 10000);
          },
          onReady: () => set({ isConnecting: false }),
          onClose: () => set({ isConnecting: false }),
          onError: () => set({ isConnecting: false }),
        });
      } catch {
        // The REST features still work without a live gateway; the user simply
        // will not receive realtime events.
        set({ gatewayStatus: null, gatewayDetail: 'Realtime updates unavailable: the gateway connection could not be started.' });
      }

      set({ token: normalizedToken, authMode: 'bot', user, guilds: Array.isArray(guilds) ? guilds : [], dmChannels, isLoading: false, isConnecting: false, gateway });
      if (Array.isArray(guilds) && guilds.length > 0) void get().selectGuild(guilds[0].id);
    } catch (err: any) {
      set({ isLoading: false, isConnecting: false, error: err?.message || 'Failed to login' });
      throw err;
    }
  },

  loginWithOAuth: async (accessToken: string) => {
    const cleanToken = String(accessToken || '').trim().replace(/^Bearer\s+/i, '');
    if (!cleanToken) throw new Error('Missing OAuth2 access token');
    set({ isLoading: true, error: null, isConnecting: false });
    try {
      const user = await api.getCurrentUser(cleanToken, 'oauth');
      if (!user || typeof user !== 'object' || !user.id) throw new Error('Invalid OAuth2 access token');
      const guilds = await api.getGuilds(cleanToken, 'oauth');
      localStorage.setItem(OAUTH_TOKEN_KEY, cleanToken);
      localStorage.setItem(AUTH_MODE_KEY, 'oauth');
      localStorage.removeItem(BOT_TOKEN_KEY);
      set({
        token: cleanToken,
        authMode: 'oauth',
        user,
        guilds: Array.isArray(guilds) ? guilds : [],
        dmChannels: [],
        channels: {},
        messages: {},
        members: {},
        roles: {},
        selectedGuildId: null,
        selectedChannelId: null,
        viewMode: 'servers',
        isLoading: false,
        isConnecting: false,
        gateway: null,
        gatewayStatus: null,
        gatewayDetail: null,
      });
    } catch (err: any) {
      localStorage.removeItem(OAUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_MODE_KEY);
      set({ isLoading: false, isConnecting: false, error: err?.message || 'Failed to complete Discord OAuth2 login' });
      throw err;
    }
  },

  logout: async () => {
    const { gateway, token, authMode, user } = get();
    try { gateway?.close(); } catch { /* ignore */ }

    // Revoke server-side so the Discord access token stops working immediately
    // instead of staying valid until it expires.
    if (authMode === 'oauth' && token) {
      await api.revokeOAuthToken(token);
    }

    localStorage.removeItem(BOT_TOKEN_KEY);
    localStorage.removeItem(OAUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_MODE_KEY);
    if (user?.id) storeDMChannels(user.id, []);

    set({
      token: null, authMode: 'bot', user: null, guilds: [], channels: {}, messages: {},
      members: {}, roles: {}, dmChannels: [], selectedGuildId: null, selectedChannelId: null,
      gateway: null, gatewayStatus: null, gatewayDetail: null, settingsOpen: false,
      unreadCounts: {}, typingUsers: {}, error: null, isLoading: false, isConnecting: false,
    });
  },

  setViewMode: (mode: ViewMode) => set({ viewMode: mode }),

  selectGuild: async (guildId: string) => {
    const { token, channels: existing } = get();
    if (!token) return;
    set({ selectedGuildId: guildId, selectedChannelId: null, viewMode: 'servers', isLoadingChannels: true, error: null });
    try {
      if (!existing[guildId]) {
        const list = await api.getGuildChannels(token, guildId);
        const sorted = (Array.isArray(list) ? [...list] as Channel[] : []).sort((a, b) => (a.position || 0) - (b.position || 0));
        set({ channels: { ...get().channels, [guildId]: sorted }, isLoadingChannels: false });
        const text = sorted.find((c) => c.type === 0);
        if (text) void get().selectChannel(text.id);
      } else {
        set({ isLoadingChannels: false });
        const text = existing[guildId].find((c) => c.type === 0);
        if (text) void get().selectChannel(text.id);
      }
      void get().loadMembers(guildId);
      void get().loadRoles(guildId);
    } catch (err: any) {
      set({ isLoadingChannels: false, error: err?.message || 'Failed to load channels' });
    }
  },

  selectChannel: async (channelId: string) => {
    set({ selectedChannelId: channelId, unreadCounts: { ...get().unreadCounts, [channelId]: 0 } });
    await get().loadMessages(channelId);
  },

  selectDMChannel: async (channelId: string) => {
    set({ selectedChannelId: channelId, selectedGuildId: null, viewMode: 'dms', unreadCounts: { ...get().unreadCounts, [channelId]: 0 } });
    await get().loadMessages(channelId);
  },

  createDMChannel: async (recipientId: string) => {
    const { token, authMode, user } = get();
    const cleanId = recipientId.trim();
    if (!token || authMode !== 'bot' || !cleanId) return;
    if (!/^\d{15,25}$/.test(cleanId)) {
      const msg = 'Enter a valid Discord user ID to start a DM.';
      set({ error: msg });
      throw new Error(msg);
    }

    // Reuse an existing DM with this recipient rather than hitting the API again.
    const existingMatch = get().dmChannels.find((ch) => ch.recipients?.some((r) => r.id === cleanId));
    if (existingMatch) {
      set({ viewMode: 'dms', error: null });
      await get().selectDMChannel(existingMatch.id);
      return;
    }

    try {
      const channel = await api.createDM(token, cleanId) as Channel;
      if (!channel?.id) throw new Error('Discord did not return a DM channel.');

      // Enrich the recipient from a direct user lookup so the row has a name and
      // avatar even though the create response may omit them.
      if (!channel.recipients?.length) {
        try {
          const profile = await api.getUserProfile(token, cleanId);
          if (profile?.id) channel.recipients = [profile as DiscordUser];
        } catch { /* the DM still works without a resolved profile */ }
      }

      const next = mergeDMChannels([channel], get().dmChannels);
      set({ dmChannels: next, viewMode: 'dms', error: null });
      if (user?.id) storeDMChannels(user.id, next);
      await get().selectDMChannel(channel.id);
    } catch (err: any) {
      set({ error: err?.message || 'Failed to create DM channel' });
      throw err;
    }
  },

  hideDMChannel: (channelId: string) => {
    const { dmChannels, user, selectedChannelId } = get();
    const next = dmChannels.filter((ch) => ch.id !== channelId);
    const patch: Partial<AppState> = { dmChannels: next };
    if (selectedChannelId === channelId) {
      patch.selectedChannelId = null;
      patch.viewMode = 'dms';
    }
    set(patch);
    if (user?.id) storeDMChannels(user.id, next);
  },

  loadMessages: async (channelId: string) => {
    const { token, authMode } = get();
    if (!token || authMode !== 'bot') return;
    set({ isLoadingMessages: true, error: null });
    try {
      const msgs = await api.getChannelMessages(token, channelId, 50);
      const list = Array.isArray(msgs) ? [...msgs].reverse() as Message[] : [];
      set({
        messages: { ...get().messages, [channelId]: mergeMessagesUnique(list) },
        hasMoreMessages: { ...get().hasMoreMessages, [channelId]: list.length === 50 },
        unreadCounts: { ...get().unreadCounts, [channelId]: 0 },
        isLoadingMessages: false,
      });
    } catch (err: any) {
      set({ isLoadingMessages: false, error: err?.message || 'Failed to load messages' });
    }
  },

  loadMoreMessages: async (channelId: string) => {
    const { token, authMode, messages: all, hasMoreMessages, isLoadingMoreMessages } = get();
    if (!token || authMode !== 'bot' || isLoadingMoreMessages || hasMoreMessages[channelId] === false) return;
    const msgs = all[channelId] || [];
    if (!msgs.length) return;
    set({ isLoadingMoreMessages: true, error: null });
    try {
      const olderRaw = await api.getChannelMessages(token, channelId, 50, msgs[0].id);
      const older = Array.isArray(olderRaw) ? [...olderRaw].reverse() as Message[] : [];
      if (older.length) {
        set({
          messages: { ...get().messages, [channelId]: mergeMessagesUnique([...older, ...(get().messages[channelId] || msgs)]) },
          hasMoreMessages: { ...get().hasMoreMessages, [channelId]: older.length === 50 },
          isLoadingMoreMessages: false,
        });
      } else {
        set({ hasMoreMessages: { ...get().hasMoreMessages, [channelId]: false }, isLoadingMoreMessages: false });
      }
    } catch (err: any) {
      set({ isLoadingMoreMessages: false, error: err?.message || 'Failed to load older messages' });
    }
  },

  sendMessage: async (channelId: string, content: string, files: File[] = []) => {
    const { token, authMode, user } = get();
    if (!token || !user || authMode !== 'bot') return;

    // Single source of truth for Discord's limits, shared with the API client so
    // the composer validation and the request validation cannot disagree.
    const validationError = api.validateOutgoingMessage(content, files);
    if (validationError) {
      set({ error: validationError });
      throw new Error(validationError);
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const blobUrls: string[] = [];
    const tempMsg: Message = {
      id: tempId,
      channel_id: channelId,
      author: user,
      content: content.trim(),
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: files.map((file, index) => {
        const url = URL.createObjectURL(file);
        blobUrls.push(url);
        return {
          id: `temp-${index}`,
          filename: file.name,
          size: file.size,
          url,
          proxy_url: url,
          content_type: file.type || undefined,
        };
      }),
      embeds: [],
      pinned: false,
      type: 0,
    };

    set({
      error: null,
      isSendingMessages: { ...get().isSendingMessages, [channelId]: true },
      messages: { ...get().messages, [channelId]: [...(get().messages[channelId] || []), tempMsg] },
    });

    const releaseBlobs = () => { for (const url of blobUrls) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } } };

    try {
      const sent = await api.sendMessage(token, channelId, content.trim(), files) as Message;
      releaseBlobs();
      set({
        isSendingMessages: { ...get().isSendingMessages, [channelId]: false },
        messages: {
          ...get().messages,
          [channelId]: mergeMessagesUnique(
            (get().messages[channelId] || []).map((m: Message) => m.id === tempId ? sent : m)
          ),
        },
      });
      if (get().userSettings.messageSound) playNotificationTone(get().userSettings);
    } catch (err: any) {
      releaseBlobs();
      // Drop the optimistic message but restore the draft text so the user does
      // not lose what they typed.
      set({
        isSendingMessages: { ...get().isSendingMessages, [channelId]: false },
        messages: { ...get().messages, [channelId]: (get().messages[channelId] || []).filter((m: Message) => m.id !== tempId) },
        error: 'Failed to send: ' + (err?.message || 'Unknown error'),
      });
      throw err;
    }
  },

  loadMembers: async (guildId: string) => {
    const { token } = get();
    if (!token) return;
    try {
      const list = await api.getGuildMembers(token, guildId, 100);
      set({ members: { ...get().members, [guildId]: Array.isArray(list) ? list : [] } });
    } catch { /* requires the privileged GUILD_MEMBERS intent */ }
  },

  loadRoles: async (guildId: string) => {
    const { token } = get();
    if (!token) return;
    try {
      const list = await api.getGuildRoles(token, guildId);
      set({ roles: { ...get().roles, [guildId]: (Array.isArray(list) ? [...list] as Role[] : []).sort((a, b) => b.position - a.position) } });
    } catch { /* roles may not be accessible */ }
  },

  toggleMemberList: () => set({ showMemberList: !get().showMemberList }),
  setShowUserProfile: (user) => set({ showUserProfile: user }),
  setError: (error) => set({ error }),
  openSettings: (page?: SettingsPage) => set({ settingsOpen: true, settingsPage: page || 'my-account' }),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsPage: (page) => set({ settingsPage: page }),
  updateSettings: (partial) => {
    const updated = { ...get().userSettings, ...partial };
    set({ userSettings: updated });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    } catch { /* storage unavailable */ }
  },
  clearUnread: (channelId) => set({ unreadCounts: { ...get().unreadCounts, [channelId]: 0 } }),

  requestNotificationPermission: async () => {
    if (typeof Notification === 'undefined') {
      set({ error: 'This browser does not support desktop notifications.' });
      return;
    }
    if (Notification.permission === 'granted') {
      get().updateSettings({ desktopNotifications: true });
      return;
    }
    if (Notification.permission === 'denied') {
      set({ error: 'Notifications are blocked by this browser. Allow them in site settings first.' });
      get().updateSettings({ desktopNotifications: false });
      return;
    }
    try {
      const result = await Notification.requestPermission();
      get().updateSettings({ desktopNotifications: result === 'granted' });
      if (result !== 'granted') set({ error: 'Notification permission was not granted.' });
    } catch {
      get().updateSettings({ desktopNotifications: false });
      set({ error: 'Could not request notification permission.' });
    }
  },
}));

export default useStore;
