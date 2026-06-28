import { create } from 'zustand';
import type { DiscordUser, Guild, Channel, Message, GuildMember, Role, TypingUser, ViewMode, SettingsPage, UserSettings } from './types';
import * as api from '../services/discordApi';

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  fontSize: 16,
  messageGroupSpacing: 16,
  compactMode: false,
  showRoleColors: true,
  saturation: 100,
  isMuted: false,
  isDeafened: false,
};

function loadSettings(): UserSettings {
  try {
    const saved = localStorage.getItem('disclone_settings');
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

interface AppState {
  token: string | null;
  user: DiscordUser | null;
  isLoading: boolean;
  error: string | null;
  isConnecting: boolean;

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
  isLoadingChannels: boolean;

  // Settings
  settingsOpen: boolean;
  settingsPage: SettingsPage;
  userSettings: UserSettings;

  // Gateway
  gateway: { close: () => void } | null;

  // Actions
  login: (token: string) => Promise<void>;
  logout: () => void;
  setViewMode: (mode: ViewMode) => void;
  selectGuild: (guildId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  selectDMChannel: (channelId: string) => Promise<void>;
  loadMessages: (channelId: string) => Promise<void>;
  loadMoreMessages: (channelId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string) => Promise<void>;
  loadMembers: (guildId: string) => Promise<void>;
  loadRoles: (guildId: string) => Promise<void>;
  toggleMemberList: () => void;
  setShowUserProfile: (user: DiscordUser | null) => void;
  setError: (error: string | null) => void;
  openSettings: (page?: SettingsPage) => void;
  closeSettings: () => void;
  setSettingsPage: (page: SettingsPage) => void;
  updateSettings: (partial: Partial<UserSettings>) => void;
}

const useStore = create<AppState>((set, get) => ({
  token: localStorage.getItem('discord_token'),
  user: null,
  isLoading: false,
  error: null,
  isConnecting: false,
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
  isLoadingChannels: false,
  settingsOpen: false,
  settingsPage: 'my-account',
  userSettings: loadSettings(),
  gateway: null,

  login: async (token: string) => {
    const normalizedToken = api.normalizeBotToken(token);
    set({ isLoading: true, error: null, isConnecting: true });
    try {
      const user = await api.getCurrentUser(normalizedToken);
      if (!user || !user.id) throw new Error('Invalid token');
      localStorage.setItem('discord_token', normalizedToken);

      const guilds = await api.getGuilds(normalizedToken);
      let dmChannels: Channel[] = [];
      try { dmChannels = await api.getDMChannels(normalizedToken); } catch { /* bot tokens may not have DM access */ }

      let gateway: { close: () => void } | null = null;
      try {
        gateway = api.connectGateway(normalizedToken, {
          onMessage: (data) => {
            const state = get();
            const chId = data.channel_id;
            if (state.messages[chId]) {
              if (!state.messages[chId].find((m: Message) => m.id === data.id)) {
                set({ messages: { ...state.messages, [chId]: [...state.messages[chId], data] } });
              }
            }
          },
          onMessageDelete: (data) => {
            const state = get();
            const chId = data.channel_id;
            if (state.messages[chId]) {
              set({ messages: { ...state.messages, [chId]: state.messages[chId].filter((m: Message) => m.id !== data.id) } });
            }
          },
          onTypingStart: (data) => {
            const state = get();
            const chId = data.channel_id;
            const existing = (state.typingUsers[chId] || []).filter((t: TypingUser) => t.userId !== data.user_id);
            set({ typingUsers: { ...state.typingUsers, [chId]: [...existing, { userId: data.user_id, username: data.member?.user?.username || 'Someone', timestamp: Date.now() }] } });
            setTimeout(() => {
              const s = get();
              set({ typingUsers: { ...s.typingUsers, [chId]: (s.typingUsers[chId] || []).filter((t: TypingUser) => Date.now() - t.timestamp < 10000) } });
            }, 10000);
          },
          onReady: () => set({ isConnecting: false }),
          onClose: () => set({ isConnecting: false }),
          onError: () => set({ isConnecting: false }),
        });
      } catch { /* gateway optional */ }

      set({ token: normalizedToken, user, guilds: guilds || [], dmChannels: dmChannels || [], isLoading: false, isConnecting: false, gateway });
      if (guilds && guilds.length > 0) get().selectGuild(guilds[0].id);
    } catch (err: any) {
      set({ isLoading: false, isConnecting: false, error: err.message || 'Failed to login' });
      throw err;
    }
  },

  logout: () => {
    get().gateway?.close();
    localStorage.removeItem('discord_token');
    set({ token: null, user: null, guilds: [], channels: {}, messages: {}, members: {}, roles: {}, dmChannels: [], selectedGuildId: null, selectedChannelId: null, gateway: null, settingsOpen: false });
  },

  setViewMode: (mode: ViewMode) => set({ viewMode: mode }),

  selectGuild: async (guildId: string) => {
    const { token, channels: existing } = get();
    if (!token) return;
    set({ selectedGuildId: guildId, selectedChannelId: null, viewMode: 'servers', isLoadingChannels: true });
    try {
      if (!existing[guildId]) {
        const list = await api.getGuildChannels(token, guildId);
        const sorted = (list || []).sort((a: Channel, b: Channel) => (a.position || 0) - (b.position || 0));
        set({ channels: { ...get().channels, [guildId]: sorted }, isLoadingChannels: false });
        const text = sorted.find((c: Channel) => c.type === 0);
        if (text) get().selectChannel(text.id);
      } else {
        set({ isLoadingChannels: false });
        const text = existing[guildId].find((c: Channel) => c.type === 0);
        if (text) get().selectChannel(text.id);
      }
      get().loadMembers(guildId);
      get().loadRoles(guildId);
    } catch (err: any) {
      set({ isLoadingChannels: false, error: err.message });
    }
  },

  selectChannel: async (channelId: string) => {
    set({ selectedChannelId: channelId });
    await get().loadMessages(channelId);
  },

  selectDMChannel: async (channelId: string) => {
    set({ selectedChannelId: channelId, selectedGuildId: null, viewMode: 'dms' });
    await get().loadMessages(channelId);
  },

  loadMessages: async (channelId: string) => {
    const { token } = get();
    if (!token) return;
    set({ isLoadingMessages: true });
    try {
      const msgs = await api.getChannelMessages(token, channelId, 50);
      set({ messages: { ...get().messages, [channelId]: (msgs || []).reverse() }, isLoadingMessages: false });
    } catch {
      set({ isLoadingMessages: false });
    }
  },

  loadMoreMessages: async (channelId: string) => {
    const { token, messages: all } = get();
    if (!token) return;
    const msgs = all[channelId] || [];
    if (!msgs.length) return;
    set({ isLoadingMessages: true });
    try {
      const older = await api.getChannelMessages(token, channelId, 50, msgs[0].id);
      if (older?.length) {
        set({ messages: { ...get().messages, [channelId]: [...older.reverse(), ...msgs] }, isLoadingMessages: false });
      } else {
        set({ isLoadingMessages: false });
      }
    } catch {
      set({ isLoadingMessages: false });
    }
  },

  sendMessage: async (channelId: string, content: string) => {
    const { token, user } = get();
    if (!token || !user || !content.trim()) return;
    const tempId = `temp-${Date.now()}`;
    const tempMsg: Message = { id: tempId, channel_id: channelId, author: user, content: content.trim(), timestamp: new Date().toISOString(), edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], attachments: [], embeds: [], pinned: false, type: 0 };
    set({ messages: { ...get().messages, [channelId]: [...(get().messages[channelId] || []), tempMsg] } });
    try {
      const sent = await api.sendMessage(token, channelId, content.trim());
      set({ messages: { ...get().messages, [channelId]: (get().messages[channelId] || []).map((m: Message) => m.id === tempId ? sent : m) } });
    } catch (err: any) {
      set({ messages: { ...get().messages, [channelId]: (get().messages[channelId] || []).filter((m: Message) => m.id !== tempId) }, error: 'Failed to send: ' + err.message });
    }
  },

  loadMembers: async (guildId: string) => {
    const { token } = get();
    if (!token) return;
    try {
      const list = await api.getGuildMembers(token, guildId, 100);
      set({ members: { ...get().members, [guildId]: list || [] } });
    } catch { /* members may not be accessible */ }
  },

  loadRoles: async (guildId: string) => {
    const { token } = get();
    if (!token) return;
    try {
      const list = await api.getGuildRoles(token, guildId);
      set({ roles: { ...get().roles, [guildId]: (list || []).sort((a: Role, b: Role) => b.position - a.position) } });
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
    localStorage.setItem('disclone_settings', JSON.stringify(updated));
  },
}));

export default useStore;
