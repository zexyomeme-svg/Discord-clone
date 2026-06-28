export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name?: string | null;
  bot?: boolean;
  banner?: string | null;
  accent_color?: number | null;
  bio?: string;
  email?: string;
  verified?: boolean;
  mfa_enabled?: boolean;
  premium_type?: number;
}

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  owner_id?: string;
  member_count?: number;
  description?: string | null;
  banner?: string | null;
  features?: string[];
  permissions?: string;
}

export interface Channel {
  id: string;
  type: number;
  guild_id?: string;
  name?: string;
  topic?: string | null;
  position?: number;
  parent_id?: string | null;
  nsfw?: boolean;
  last_message_id?: string | null;
  recipients?: DiscordUser[];
  icon?: string | null;
  bitrate?: number;
  user_limit?: number;
}

export interface Message {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: DiscordUser[];
  attachments: Attachment[];
  embeds: Embed[];
  reactions?: Reaction[];
  pinned: boolean;
  type: number;
  referenced_message?: Message | null;
  message_reference?: {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
  };
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string; icon_url?: string };
  image?: { url: string; width?: number; height?: number };
  thumbnail?: { url: string; width?: number; height?: number };
  author?: { name: string; url?: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  type?: string;
}

export interface Reaction {
  count: number;
  me: boolean;
  emoji: { id: string | null; name: string };
}

export interface GuildMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
  joined_at: string;
  deaf?: boolean;
  mute?: boolean;
  pending?: boolean;
}

export interface Role {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
}

export interface TypingUser {
  userId: string;
  username: string;
  timestamp: number;
}

export type ViewMode = 'servers' | 'dms';

export type AuthMode = 'bot' | 'oauth';

export type SettingsPage =
  | 'my-account'
  | 'profiles'
  | 'privacy'
  | 'authorized-apps'
  | 'connections'
  | 'appearance'
  | 'accessibility'
  | 'voice'
  | 'notifications'
  | 'keybinds'
  | 'language'
  | 'streamer'
  | 'advanced';

export type ThemeMode = 'dark' | 'light';
export type LanguageCode = 'en-US' | 'en-GB' | 'es-ES' | 'fr-FR' | 'de-DE' | 'pt-BR';

export interface UserSettings {
  theme: ThemeMode;
  fontSize: number;
  messageGroupSpacing: number;
  compactMode: boolean;
  showRoleColors: boolean;
  saturation: number;
  isMuted: boolean;
  isDeafened: boolean;
  desktopNotifications: boolean;
  unreadBadge: boolean;
  messageSound: boolean;
  notificationSounds: boolean;
  streamerMode: boolean;
  developerMode: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  language: LanguageCode;
  inputDevice: string;
  outputDevice: string;
}
