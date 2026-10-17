import { useEffect, useState } from 'react';
import { Hash, MessageSquare, Server, Users, ChevronLeft, Search, AtSign, Volume2, Megaphone } from 'lucide-react';
import useStore from './store/useStore';
import LoginScreen from './components/LoginScreen';
import LoadingScreen from './components/LoadingScreen';
import ServerList from './components/ServerList';
import ChannelList from './components/ChannelList';
import DMList from './components/DMList';
import MessageArea from './components/MessageArea';
import DMMessageArea from './components/DMMessageArea';
import MemberList from './components/MemberList';
import UserPanel from './components/UserPanel';
import SettingsModal from './components/SettingsModal';
import ErrorNotification from './components/ErrorNotification';
import OAuthDashboard from './components/OAuthDashboard';
import { exchangeOAuthHandoff, getGuildIconUrl, getUserAvatarUrl } from './services/discordApi';
import { installRipple } from './utils/ripple';
import type { Channel, GuildMember, Role } from './store/types';

function MainLayout() {
  const { viewMode } = useStore();

  return (
    <div className="hidden md:flex h-full w-full overflow-hidden">
      <ServerList />
      <div className="flex flex-col h-full flex-shrink-0 min-h-0">
        <div className="flex-1 min-h-0 flex flex-col">
          {viewMode === 'servers' ? <ChannelList /> : <DMList />}
        </div>
        <UserPanel />
      </div>
      <div className="flex flex-1 min-w-0 min-h-0 h-full">
        {viewMode === 'servers' ? <MessageArea /> : <DMMessageArea />}
        {viewMode === 'servers' && <MemberList />}
      </div>
      <SettingsModal />
      <ErrorNotification />
    </div>
  );
}

type MobilePanel = 'servers' | 'channels' | 'dms' | 'chat' | 'members';

function MobileTopBar({ panel, setPanel }: { panel: MobilePanel; setPanel: (panel: MobilePanel) => void }) {
  const { viewMode, selectedGuildId, selectedChannelId, guilds, channels, dmChannels } = useStore();
  const guild = guilds.find((g) => g.id === selectedGuildId);
  const channel = viewMode === 'servers'
    ? (selectedGuildId ? (channels[selectedGuildId] || []).find((c) => c.id === selectedChannelId) : null)
    : dmChannels.find((c) => c.id === selectedChannelId);

  const title = panel === 'servers' ? 'Servers'
    : panel === 'channels' ? (guild?.name || 'Channels')
    : panel === 'dms' ? 'Direct Messages'
    : panel === 'members' ? 'Members'
    : viewMode === 'servers' ? `#${channel?.name || 'channel'}` : (channel?.recipients?.[0]?.global_name || channel?.recipients?.[0]?.username || 'Direct Message');

  return (
    <div className="h-14 px-2 flex items-center gap-1 bg-surface-container-high elev-2 flex-shrink-0 z-10">
      {panel !== 'servers' && (
        <button
          type="button"
          onClick={() => setPanel(viewMode === 'dms' ? 'dms' : 'channels')}
          data-ripple
          aria-label="Back"
          className="m3-interactive w-10 h-10 rounded-full flex items-center justify-center
            text-on-surface-variant hover:text-on-surface transition-colors duration-200 ease-standard"
        >
          <ChevronLeft size={22} />
        </button>
      )}
      <h2 className="text-title-medium text-on-surface truncate flex-1 px-1">{title}</h2>
      {panel === 'chat' && viewMode === 'servers' && (
        <button
          type="button"
          onClick={() => setPanel('members')}
          data-ripple
          aria-label="Members"
          className="m3-interactive w-10 h-10 rounded-full flex items-center justify-center
            text-on-surface-variant hover:text-on-surface transition-colors duration-200 ease-standard"
        >
          <Users size={20} />
        </button>
      )}
    </div>
  );
}

function MobileServerPicker({ setPanel }: { setPanel: (panel: MobilePanel) => void }) {
  const { guilds, selectedGuildId, selectGuild, setViewMode } = useStore();

  return (
    <div className="flex-1 overflow-y-auto bg-surface p-4">
      <button
        type="button"
        onClick={() => { setViewMode('dms'); setPanel('dms'); }}
        data-ripple
        className="m3-interactive w-full mb-5 flex items-center gap-3.5 p-3 rounded-m3-lg
          bg-primary-container text-on-primary-container elev-1
          transition-shadow duration-200 ease-standard"
      >
        <div className="w-12 h-12 rounded-m3-md bg-primary/20 flex items-center justify-center flex-shrink-0">
          <MessageSquare size={24} className="text-on-primary-container" />
        </div>
        <div className="text-left min-w-0">
          <p className="text-title-small">Direct Messages</p>
          <p className="text-label-small opacity-80">Open your bot DMs</p>
        </div>
      </button>

      <p className="text-label-small text-on-surface-variant uppercase tracking-[0.05em] mb-3 px-1">Servers</p>
      <div className="grid grid-cols-4 xs:grid-cols-5 gap-3">
        {guilds.map((guild) => {
          const icon = getGuildIconUrl(guild.id, guild.icon, 128);
          const selected = selectedGuildId === guild.id;
          return (
            <button
              key={guild.id}
              type="button"
              onClick={() => { selectGuild(guild.id); setPanel('channels'); }}
              aria-current={selected ? 'true' : undefined}
              className="flex flex-col items-center gap-2 min-w-0 group"
            >
              <div
                data-ripple
                className={`m3-interactive w-14 h-14 overflow-hidden flex items-center justify-center
                  text-label-medium font-medium transition-[border-radius,background-color] duration-300 ease-emphasized
                  ${selected
                    ? 'rounded-m3-lg bg-primary-container text-on-primary-container ring-1 ring-primary/50'
                    : 'rounded-m3-xl bg-surface-container-high text-on-surface-variant'}`}
              >
                {icon
                  ? (
                    <img
                      src={icon}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )
                  : guild.name.slice(0, 2).toUpperCase()}
              </div>
              <span className={`text-label-small truncate w-full text-center transition-colors duration-200
                ${selected ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                {guild.name}
              </span>
            </button>
          );
        })}
        {!guilds.length && (
          <p className="col-span-full text-body-small text-on-surface-variant text-center py-6">
            No servers visible to this bot yet.
          </p>
        )}
      </div>
    </div>
  );
}

/** Matches ChannelList's icon set so mobile and desktop read identically. */
function channelIcon(channel: Channel) {
  if (channel.type === 2) return <Volume2 size={18} />;
  if (channel.type === 5) return <Megaphone size={18} />;
  return <Hash size={18} />;
}

function MobileChannelPicker({ setPanel }: { setPanel: (panel: MobilePanel) => void }) {
  const { selectedGuildId, guilds, channels, selectedChannelId, selectChannel } = useStore();
  const [q, setQ] = useState('');
  const guild = guilds.find((g) => g.id === selectedGuildId);
  const list = (selectedGuildId ? channels[selectedGuildId] || [] : []).filter((c) => c.type !== 4 && [0, 5, 15].includes(c.type));
  const filtered = list.filter((c) => (c.name || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex-1 overflow-y-auto bg-surface-container p-3">
      <div className="mb-3 px-1">
        <p className="text-title-medium text-on-surface truncate">{guild?.name || 'Server'}</p>
        <p className="text-label-small text-on-surface-variant">Select a channel</p>
      </div>
      <div className="relative mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search channels"
          aria-label="Search channels"
          className="w-full bg-surface-container-lowest rounded-m3-sm h-11 pl-3.5 pr-10 text-body-medium
            outline-none text-on-surface placeholder:text-on-surface-variant/70
            focus:outline focus:outline-2 focus:outline-primary transition-[outline-color] duration-200"
        />
        <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
      </div>
      <div className="space-y-0.5">
        {filtered.map((channel) => (
          <button
            key={channel.id}
            type="button"
            onClick={() => { selectChannel(channel.id); setPanel('chat'); }}
            data-ripple
            aria-current={selectedChannelId === channel.id ? 'page' : undefined}
            className={`m3-interactive w-full flex items-center gap-3 min-h-[48px] px-3 rounded-m3-xl text-left
              transition-colors duration-200 ease-standard
              ${selectedChannelId === channel.id
                ? 'bg-secondary-container text-on-secondary-container'
                : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">{channelIcon(channel)}</span>
            <span className="truncate text-label-large">{channel.name}</span>
          </button>
        ))}
        {!filtered.length && (
          <p className="text-body-small text-on-surface-variant text-center py-6">
            {q ? 'No matching channels.' : 'No text channels here.'}
          </p>
        )}
      </div>
    </div>
  );
}

function MobileDMPicker({ setPanel }: { setPanel: (panel: MobilePanel) => void }) {
  const { dmChannels, selectedChannelId, selectDMChannel } = useStore();
  const [q, setQ] = useState('');
  const filtered = dmChannels.filter((ch) => (ch.recipients?.map((r) => r.username).join(' ') || ch.name || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex-1 overflow-y-auto bg-surface-container p-3">
      <div className="relative mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a conversation"
          aria-label="Find a conversation"
          className="w-full bg-surface-container-lowest rounded-m3-sm h-11 pl-3.5 pr-10 text-body-medium
            outline-none text-on-surface placeholder:text-on-surface-variant/70
            focus:outline focus:outline-2 focus:outline-primary transition-[outline-color] duration-200"
        />
        <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
      </div>
      <div className="space-y-0.5">
        {filtered.map((channel) => {
          const user = channel.recipients?.[0];
          const avatar = user ? getUserAvatarUrl(user.id, user.avatar, user.discriminator) : null;
          const name = channel.type === 3 ? (channel.name || 'Group DM') : (user?.global_name || user?.username || 'Unknown');
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => { selectDMChannel(channel.id); setPanel('chat'); }}
              data-ripple
              aria-current={selectedChannelId === channel.id ? 'true' : undefined}
              className={`m3-interactive w-full flex items-center gap-3 min-h-[56px] px-3 rounded-m3-xl text-left
                transition-colors duration-200 ease-standard
                ${selectedChannelId === channel.id
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              {avatar
                ? (
                  <img
                    src={avatar}
                    alt=""
                    className="w-10 h-10 rounded-full flex-shrink-0 bg-surface-container-highest"
                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
                  />
                )
                : (
                  <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center flex-shrink-0">
                    <AtSign size={17} className="text-on-surface-variant" />
                  </div>
                )}
              <span className="truncate text-label-large">{name}</span>
            </button>
          );
        })}
        {!filtered.length && (
          <p className="text-body-small text-on-surface-variant text-center py-8 leading-relaxed">
            {q ? 'No matching conversations.' : 'No DMs yet. Start one from the desktop layout with the + button.'}
          </p>
        )}
      </div>
    </div>
  );
}

function roleColor(member: GuildMember, roles: Role[]) {
  const role = roles.filter((r) => member.roles.includes(r.id) && r.color !== 0).sort((a, b) => b.position - a.position)[0];
  return role ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5';
}

function MobileMembers() {
  const { selectedGuildId, members, roles } = useStore();
  const list = selectedGuildId ? members[selectedGuildId] || [] : [];
  const guildRoles = selectedGuildId ? roles[selectedGuildId] || [] : [];
  return (
    <div className="flex-1 overflow-y-auto bg-surface-container p-3">
      <p className="text-label-small text-on-surface-variant uppercase tracking-[0.05em] px-3 pb-2">
        Members<span className="ml-1.5 tabular-nums opacity-70">{list.length}</span>
      </p>
      <div className="space-y-0.5">
        {list.map((member) => {
          if (!member.user) return null;
          const avatar = getUserAvatarUrl(member.user.id, member.user.avatar, member.user.discriminator);
          return (
            <div key={member.user.id} className="flex items-center gap-3 min-h-[56px] px-3 rounded-m3-xl">
              <img
                src={avatar}
                alt=""
                className="w-10 h-10 rounded-full flex-shrink-0 bg-surface-container-highest"
                onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
              />
              <span className="truncate text-label-large" style={{ color: roleColor(member, guildRoles) }}>
                {member.nick || member.user.global_name || member.user.username}
              </span>
              {member.user.bot && (
                <span className="ml-auto flex-shrink-0 bg-secondary-container text-on-secondary-container
                  text-[9px] font-medium px-1.5 py-0.5 rounded-m3-xs uppercase tracking-[0.04em]">
                  Bot
                </span>
              )}
            </div>
          );
        })}
        {!list.length && (
          <p className="text-body-small text-on-surface-variant text-center py-8">No members loaded.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Material 3 navigation bar: an 80px surface-container row where each
 * destination is a 64x32 pill that fills behind the icon when selected, with
 * the label below. This is the standard M3 mobile pattern, and it replaces the
 * previous 56px row that only recoloured its text.
 */
function MobileBottomNav({ panel, setPanel }: { panel: MobilePanel; setPanel: (panel: MobilePanel) => void }) {
  const { viewMode, selectedChannelId } = useStore();

  const item = (id: MobilePanel, label: string, icon: React.ReactNode, disabled = false) => {
    const active = panel === id;
    return (
      <button
        key={id}
        type="button"
        disabled={disabled}
        onClick={() => setPanel(id)}
        aria-current={active ? 'page' : undefined}
        className="flex-1 h-full flex flex-col items-center justify-center gap-1 pt-3 pb-2
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span
          data-ripple={disabled ? undefined : ''}
          className={`m3-interactive w-16 h-8 rounded-full flex items-center justify-center
            transition-[background-color,color] duration-300 ease-emphasized
            ${active
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-transparent text-on-surface-variant'}`}
        >
          {icon}
        </span>
        <span className={`text-label-medium transition-colors duration-200 ${active ? 'text-on-surface' : 'text-on-surface-variant'}`}>
          {label}
        </span>
      </button>
    );
  };

  return (
    <nav
      className="h-20 bg-surface-container elev-3 flex flex-shrink-0 pb-[env(safe-area-inset-bottom)] z-20"
      aria-label="Primary"
    >
      {item('servers', 'Servers', <Server size={22} />)}
      {item(viewMode === 'dms' ? 'dms' : 'channels', viewMode === 'dms' ? 'DMs' : 'Channels', <Hash size={22} />)}
      {item('chat', 'Chat', <MessageSquare size={22} />, !selectedChannelId)}
      {viewMode === 'servers' && item('members', 'Members', <Users size={22} />, !selectedChannelId)}
    </nav>
  );
}

function MobileLayout() {
  const { viewMode } = useStore();
  const [panel, setPanel] = useState<MobilePanel>('servers');

  useEffect(() => {
    if (viewMode === 'dms' && panel === 'channels') setPanel('dms');
  }, [viewMode, panel]);

  return (
    <div className="md:hidden h-full w-full flex flex-col overflow-hidden bg-surface-container-high">
      <MobileTopBar panel={panel} setPanel={setPanel} />
      {panel === 'servers' && <MobileServerPicker setPanel={setPanel} />}
      {panel === 'channels' && <MobileChannelPicker setPanel={setPanel} />}
      {panel === 'dms' && <MobileDMPicker setPanel={setPanel} />}
      {panel === 'members' && <MobileMembers />}
      {panel === 'chat' && <div className="flex-1 min-h-0 flex">{viewMode === 'servers' ? <MessageArea /> : <DMMessageArea />}</div>}
      <MobileBottomNav panel={panel} setPanel={setPanel} />
      <SettingsModal />
      <ErrorNotification />
    </div>
  );
}

export default function App() {
  const { token, authMode, user, isLoading, login, loginWithOAuth, userSettings, updateSettings, unreadCounts, settingsOpen, closeSettings, loadAppInfo } = useStore();

  // Attribution (repository + Render site) is fetched on mount rather than at
  // login, so the login screen and the About page can link to the project even
  // before a session exists. login() also awaits it, so the gateway IDENTIFY
  // still carries the presence from the first moment the bot appears online.
  useEffect(() => { void loadAppInfo(); }, [loadAppInfo]);

  // Material ripple feedback. One delegated listener for the whole app; elements
  // opt in with `data-ripple`. Respects the Reduced Motion setting and the OS
  // preference, and is installed after the theme classes below so both see the
  // same <html>.
  useEffect(() => installRipple(), []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-light', userSettings.theme === 'light');
    root.classList.toggle('theme-dark', userSettings.theme === 'dark');
    root.classList.toggle('reduced-motion', userSettings.reducedMotion);
    root.classList.toggle('high-contrast', userSettings.highContrast);
    root.classList.toggle('streamer-mode', userSettings.streamerMode);
    root.classList.toggle('compact-mode', userSettings.compactMode);
    root.style.setProperty('--app-saturation', `${userSettings.saturation}%`);
    // Only engage the saturate filter when it is not a no-op. See index.css for
    // why this lives on <html> and not <body>.
    root.classList.toggle('app-saturated', userSettings.saturation !== 100);
    root.lang = userSettings.language;
  }, [userSettings]);

  useEffect(() => {
    const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
    document.title = totalUnread > 0 && userSettings.unreadBadge ? `(${totalUnread}) Disclone` : 'Disclone';
  }, [unreadCounts, userSettings.unreadBadge]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey && key === 'm') {
        event.preventDefault();
        updateSettings({ isMuted: !useStore.getState().userSettings.isMuted });
      } else if (event.shiftKey && key === 'd') {
        event.preventDefault();
        updateSettings({ isDeafened: !useStore.getState().userSettings.isDeafened });
      } else if (key === 'k') {
        event.preventDefault();
        (document.querySelector('[data-app-search="true"]') as HTMLInputElement | null)?.focus();
      } else if (event.shiftKey && key === 'u') {
        event.preventDefault();
        (document.querySelector('[data-upload-trigger="true"]') as HTMLButtonElement | null)?.click();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [updateSettings]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settingsOpen, closeSettings]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthPending = params.get('oauth_pending');
    const oauthError = params.get('oauth_error');

    const clearQuery = () => window.history.replaceState({}, document.title, window.location.pathname);

    const clearStoredSession = () => {
      localStorage.removeItem('discord_token');
      localStorage.removeItem('discord_oauth_access_token');
      localStorage.removeItem('discord_auth_mode');
      useStore.setState({ token: null, authMode: 'bot', isLoading: false });
    };

    // The OAuth2 access token arrives in a signed, short-lived HttpOnly cookie
    // rather than the query string, so it never lands in server logs, browser
    // history or Referer headers. Collect it exactly once.
    if (oauthPending) {
      clearQuery();
      void exchangeOAuthHandoff()
        .then((accessToken) => {
          if (!accessToken) throw new Error('The Discord sign-in expired. Please try again.');
          return loginWithOAuth(accessToken);
        })
        .catch((err: Error) => {
          clearStoredSession();
          useStore.setState({ error: err?.message || 'Discord OAuth2 sign-in failed.' });
        });
      return;
    }

    if (oauthError) {
      clearQuery();
      const reason = oauthError.replace(/[_-]/g, ' ');
      useStore.setState({ error: `Discord OAuth2 failed: ${reason}` });
      return;
    }

    if (token && !user && !isLoading) {
      const restore = authMode === 'oauth' ? loginWithOAuth : login;
      void restore(token).catch(() => {
        clearStoredSession();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token || (!user && !isLoading)) {
    return (
      <div className="h-full w-full">
        <LoginScreen />
        <ErrorNotification />
      </div>
    );
  }

  if (isLoading || !user) {
    return <div className="h-full w-full"><LoadingScreen /></div>;
  }

  if (authMode === 'oauth') {
    return <OAuthDashboard />;
  }

  return (
    <>
      <MainLayout />
      <MobileLayout />
    </>
  );
}
