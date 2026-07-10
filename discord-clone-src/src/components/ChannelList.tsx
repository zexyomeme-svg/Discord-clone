import { useState, memo } from 'react';
import { Hash, Volume2, ChevronDown, ChevronRight, Megaphone, Lock, Video } from 'lucide-react';
import useStore from '../store/useStore';
import type { Channel } from '../store/types';

function getChannelIcon(type: number, size = 18) {
  switch (type) {
    case 0: return <Hash size={size} />;
    case 2: return <Volume2 size={size} />;
    case 5: return <Megaphone size={size} />;
    case 13: return <Video size={size} />;
    default: return <Hash size={size} />;
  }
}

const ChannelItem = memo(({ channel, isSelected, unreadCount, showUnread, onClick }: { channel: Channel; isSelected: boolean; unreadCount?: number; showUnread?: boolean; onClick: () => void }) => {
  const isClickable = [0, 5, 15].includes(channel.type);
  return (
    <button onClick={isClickable ? onClick : undefined}
      className={`flex items-center gap-1.5 w-full py-[6px] px-2 rounded text-[15px] group transition-colors ${
        isSelected ? 'bg-discord-active text-white' : isClickable ? 'text-discord-text-muted hover:text-discord-text hover:bg-discord-hover' : 'text-discord-text-muted/50 cursor-default'
      }`}>
      <span className={`flex-shrink-0 ${isSelected ? 'text-white' : 'text-discord-text-muted'}`}>
        {channel.nsfw ? <Lock size={18} /> : getChannelIcon(channel.type)}
      </span>
      <span className="truncate flex-1 text-left text-[15px] leading-5">{channel.name}</span>
      {showUnread && Boolean(unreadCount) && (
        <span className="min-w-5 h-5 px-1 rounded-full bg-discord-red text-white text-[11px] font-bold flex items-center justify-center">{unreadCount! > 99 ? '99+' : unreadCount}</span>
      )}
    </button>
  );
});

function CategorySection({ name, channels, selectedChannelId, unreadCounts, showUnread, onSelectChannel }: { name: string; channels: Channel[]; selectedChannelId: string | null; unreadCounts: Record<string, number>; showUnread: boolean; onSelectChannel: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="mt-4 first:mt-0">
      <button onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-0.5 w-full pl-0.5 pr-1 py-[6px] text-xs font-bold text-discord-text-muted uppercase tracking-[0.02em] hover:text-discord-text transition-colors group">
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="truncate">{name}</span>
      </button>
      {!collapsed && (
        <div className="space-y-px ml-0.5">
          {channels.map(ch => (
            <ChannelItem key={ch.id} channel={ch} isSelected={selectedChannelId === ch.id} unreadCount={unreadCounts[ch.id]} showUnread={showUnread} onClick={() => onSelectChannel(ch.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChannelList() {
  const { guilds, selectedGuildId, channels, selectedChannelId, selectChannel, isLoadingChannels, setError, unreadCounts, userSettings } = useStore();
  const guild = guilds.find(g => g.id === selectedGuildId);
  const guildChannels = selectedGuildId ? channels[selectedGuildId] || [] : [];

  const categories = new Map<string | null, Channel[]>();
  const categoryChannels: Channel[] = [];
  guildChannels.forEach(ch => { if (ch.type === 4) { categoryChannels.push(ch); if (!categories.has(ch.id)) categories.set(ch.id, []); } });
  guildChannels.forEach(ch => { if (ch.type !== 4) { const pid = ch.parent_id || null; if (!categories.has(pid)) categories.set(pid, []); categories.get(pid)!.push(ch); } });

  return (
    <div className="w-[240px] bg-discord-sidebar flex flex-col flex-shrink-0 h-full min-h-0">
      {/* Server header */}
      <button onClick={() => setError(`Server: ${guild?.name || 'Server'} • ${guildChannels.length} channels loaded.`)} className="h-12 px-4 flex items-center justify-between border-b border-discord-darker/70 shadow-sm hover:bg-discord-hover transition-colors flex-shrink-0">
        <h2 className="font-semibold text-white truncate text-[15px]">{guild?.name || 'Server'}</h2>
        <ChevronDown size={18} className="text-discord-text-muted flex-shrink-0" />
      </button>

      {/* Channels */}
      <div className="flex-1 overflow-y-auto channel-scroll px-2 pt-3 pb-2 min-h-0">
        {isLoadingChannels ? (
          <div className="space-y-4 p-2">
            {Array.from({length: 8}).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-4 h-4 rounded animate-shimmer" />
                <div className="h-3 rounded animate-shimmer" style={{ width: `${50 + Math.random() * 40}%` }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            {categories.get(null)?.map(ch => (
              <ChannelItem key={ch.id} channel={ch} isSelected={selectedChannelId === ch.id} unreadCount={unreadCounts[ch.id]} showUnread={userSettings.unreadBadge} onClick={() => selectChannel(ch.id)} />
            ))}
            {categoryChannels.sort((a, b) => (a.position || 0) - (b.position || 0)).map(cat => {
              const items = categories.get(cat.id) || [];
              if (!items.length) return null;
              return (
                <CategorySection key={cat.id} name={cat.name || 'Unknown'} selectedChannelId={selectedChannelId}
                  channels={items.sort((a, b) => (a.position || 0) - (b.position || 0))} unreadCounts={unreadCounts} showUnread={userSettings.unreadBadge} onSelectChannel={selectChannel} />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
