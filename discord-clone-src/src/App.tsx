import { useEffect, useState } from 'react';
import { Hash, MessageSquare, Server, Users, ChevronLeft, Search, AtSign } from 'lucide-react';
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
import { getGuildIconUrl, getUserAvatarUrl } from './services/discordApi';
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
    <div className="h-12 px-3 flex items-center gap-2 bg-discord-header border-b border-discord-darker/70 flex-shrink-0">
      {panel !== 'servers' && (
        <button onClick={() => setPanel(viewMode === 'dms' ? 'dms' : 'channels')} className="p-2 -ml-2 text-discord-text-muted hover:text-white">
          <ChevronLeft size={22} />
        </button>
      )}
      <h2 className="font-semibold text-white truncate flex-1">{title}</h2>
      {panel === 'chat' && viewMode === 'servers' && (
        <button onClick={() => setPanel('members')} className="p-2 text-discord-text-muted hover:text-white" title="Members">
          <Users size={20} />
        </button>
      )}
    </div>
  );
}

function MobileServerPicker({ setPanel }: { setPanel: (panel: MobilePanel) => void }) {
  const { guilds, selectedGuildId, selectGuild, setViewMode } = useStore();

  return (
    <div className="flex-1 overflow-y-auto bg-discord-darker p-4">
      <button onClick={() => { setViewMode('dms'); setPanel('dms'); }} className="w-full mb-4 flex items-center gap-3 p-3 rounded-xl bg-discord-channel hover:bg-discord-hover text-white transition-colors">
        <div className="w-12 h-12 rounded-2xl bg-discord-blurple flex items-center justify-center"><MessageSquare size={24} /></div>
        <div className="text-left"><p className="font-semibold">Direct Messages</p><p className="text-xs text-discord-text-muted">Open your bot DMs</p></div>
      </button>

      <p className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-3">Servers</p>
      <div className="grid grid-cols-4 xs:grid-cols-5 gap-3">
        {guilds.map((guild) => {
          const icon = getGuildIconUrl(guild.id, guild.icon, 128);
          const selected = selectedGuildId === guild.id;
          return (
            <button key={guild.id} onClick={() => { selectGuild(guild.id); setPanel('channels'); }} className="flex flex-col items-center gap-2 min-w-0">
              <div className={`w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center text-white font-bold transition-all ${selected ? 'bg-discord-blurple ring-2 ring-white' : 'bg-discord-channel hover:bg-discord-blurple'}`}>
                {icon ? <img src={icon} alt="" className="w-full h-full object-cover" /> : guild.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-[11px] text-discord-text-muted truncate w-full">{guild.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function channelIcon(channel: Channel) {
  return channel.type === 2 ? '🔊' : channel.type === 5 ? '📣' : '#';
}

function MobileChannelPicker({ setPanel }: { setPanel: (panel: MobilePanel) => void }) {
  const { selectedGuildId, guilds, channels, selectedChannelId, selectChannel } = useStore();
  const [q, setQ] = useState('');
  const guild = guilds.find((g) => g.id === selectedGuildId);
  const list = (selectedGuildId ? channels[selectedGuildId] || [] : []).filter((c) => c.type !== 4 && [0, 5, 15].includes(c.type));
  const filtered = list.filter((c) => (c.name || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex-1 overflow-y-auto bg-discord-sidebar p-3">
      <div className="mb-3">
        <p className="text-white font-bold truncate">{guild?.name || 'Server'}</p>
        <p className="text-xs text-discord-text-muted">Select a channel</p>
      </div>
      <div className="relative mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels" className="w-full bg-discord-dark rounded px-3 py-2 pr-8 text-sm outline-none text-discord-text placeholder:text-discord-text-muted" />
        <Search size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-discord-text-muted" />
      </div>
      <div className="space-y-1">
        {filtered.map((channel) => (
          <button key={channel.id} onClick={() => { selectChannel(channel.id); setPanel('chat'); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left ${selectedChannelId === channel.id ? 'bg-discord-active text-white' : 'text-discord-text-muted hover:text-white hover:bg-discord-hover'}`}>
            <span className="w-5 text-center">{channelIcon(channel)}</span>
            <span className="truncate">{channel.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MobileDMPicker({ setPanel }: { setPanel: (panel: MobilePanel) => void }) {
  const { dmChannels, selectedChannelId, selectDMChannel } = useStore();
  const [q, setQ] = useState('');
  const filtered = dmChannels.filter((ch) => (ch.recipients?.map((r) => r.username).join(' ') || ch.name || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex-1 overflow-y-auto bg-discord-sidebar p-3">
      <div className="relative mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a conversation" className="w-full bg-discord-dark rounded px-3 py-2 pr-8 text-sm outline-none text-discord-text placeholder:text-discord-text-muted" />
        <Search size={16} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-discord-text-muted" />
      </div>
      <div className="space-y-1">
        {filtered.map((channel) => {
          const user = channel.recipients?.[0];
          const avatar = user ? getUserAvatarUrl(user.id, user.avatar, user.discriminator) : null;
          const name = channel.type === 3 ? (channel.name || 'Group DM') : (user?.global_name || user?.username || 'Unknown');
          return (
            <button key={channel.id} onClick={() => { selectDMChannel(channel.id); setPanel('chat'); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${selectedChannelId === channel.id ? 'bg-discord-active text-white' : 'text-discord-text-muted hover:text-white hover:bg-discord-hover'}`}>
              {avatar ? <img src={avatar} alt="" className="w-9 h-9 rounded-full" /> : <div className="w-9 h-9 rounded-full bg-discord-input flex items-center justify-center"><AtSign size={16} /></div>}
              <span className="truncate">{name}</span>
            </button>
          );
        })}
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
    <div className="flex-1 overflow-y-auto bg-discord-sidebar p-3">
      {list.map((member) => {
        if (!member.user) return null;
        const avatar = getUserAvatarUrl(member.user.id, member.user.avatar, member.user.discriminator);
        return (
          <div key={member.user.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-discord-hover">
            <img src={avatar} alt="" className="w-9 h-9 rounded-full" />
            <span className="truncate font-medium" style={{ color: roleColor(member, guildRoles) }}>{member.nick || member.user.global_name || member.user.username}</span>
          </div>
        );
      })}
    </div>
  );
}

function MobileBottomNav({ panel, setPanel }: { panel: MobilePanel; setPanel: (panel: MobilePanel) => void }) {
  const { viewMode, selectedChannelId } = useStore();
  const item = (id: MobilePanel, label: string, icon: React.ReactNode, disabled = false) => (
    <button disabled={disabled} onClick={() => setPanel(id)} className={`flex-1 py-2 flex flex-col items-center gap-0.5 text-[11px] ${panel === id ? 'text-white' : 'text-discord-text-muted'} disabled:opacity-40`}>
      {icon}<span>{label}</span>
    </button>
  );
  return (
    <div className="h-14 bg-discord-darker border-t border-discord-border flex flex-shrink-0 pb-[env(safe-area-inset-bottom)]">
      {item('servers', 'Servers', <Server size={20} />)}
      {item(viewMode === 'dms' ? 'dms' : 'channels', viewMode === 'dms' ? 'DMs' : 'Channels', <Hash size={20} />)}
      {item('chat', 'Chat', <MessageSquare size={20} />, !selectedChannelId)}
      {viewMode === 'servers' && item('members', 'Members', <Users size={20} />, !selectedChannelId)}
    </div>
  );
}

function MobileLayout() {
  const { viewMode } = useStore();
  const [panel, setPanel] = useState<MobilePanel>('servers');

  useEffect(() => {
    if (viewMode === 'dms' && panel === 'channels') setPanel('dms');
  }, [viewMode, panel]);

  return (
    <div className="md:hidden h-full w-full flex flex-col overflow-hidden bg-discord-channel">
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

function decodeOAuthRedirectToken(value: string) {
  try {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return value;
  }
}

export default function App() {
  const { token, authMode, user, isLoading, login, loginWithOAuth } = useStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get('oauth_token');
    const oauthError = params.get('oauth_error');

    if (oauthToken) {
      window.history.replaceState({}, document.title, window.location.pathname);
      loginWithOAuth(decodeOAuthRedirectToken(oauthToken)).catch(() => {
        localStorage.removeItem('discord_oauth_access_token');
        localStorage.removeItem('discord_auth_mode');
        useStore.setState({ token: null, authMode: 'bot' });
      });
      return;
    }

    if (oauthError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      useStore.setState({ error: `Discord OAuth2 failed: ${oauthError}` });
      return;
    }

    if (token && !user && !isLoading) {
      const restore = authMode === 'oauth' ? loginWithOAuth : login;
      restore(token).catch(() => {
        localStorage.removeItem('discord_token');
        localStorage.removeItem('discord_oauth_access_token');
        localStorage.removeItem('discord_auth_mode');
        useStore.setState({ token: null, authMode: 'bot' });
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
