import { useState, memo } from 'react';
import { Hash, Volume2, ChevronDown, Megaphone, Lock, Video } from 'lucide-react';
import useStore from '../store/useStore';
import type { Channel } from '../store/types';

/**
 * The 240px channel drawer. Discord's structure — server header, optional
 * categories, channel rows — expressed with Material 3 list semantics:
 *
 *   * the selected row is a secondary-container pill at the full row width
 *     (M3 navigation drawer) instead of a flat grey rectangle
 *   * every row carries a state layer and a ripple
 *   * category headers use the label-small style with M3 tracking
 *   * the server header sits at elevation 2 with a tinted surface so the
 *     drawer reads as lifted above the guild rail
 */

function getChannelIcon(type: number, size = 18) {
  switch (type) {
    case 0: return <Hash size={size} />;
    case 2: return <Volume2 size={size} />;
    case 5: return <Megaphone size={size} />;
    case 13: return <Video size={size} />;
    default: return <Hash size={size} />;
  }
}

const ChannelItem = memo(({ channel, isSelected, unreadCount, showUnread, onClick }: {
  channel: Channel;
  isSelected: boolean;
  unreadCount?: number;
  showUnread?: boolean;
  onClick: () => void;
}) => {
  // Text, announcement and forum channels are openable; voice and stage are not,
  // because a browser client cannot join a voice channel through the REST API.
  const isClickable = [0, 5, 15].includes(channel.type);

  if (!isClickable) {
    return (
      <div
        aria-disabled="true"
        className="flex items-center gap-1.5 w-full h-9 px-2 rounded-m3-xl text-body-large
          text-on-surface-variant/50 cursor-default select-none"
      >
        <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {channel.nsfw ? <Lock size={18} /> : getChannelIcon(channel.type)}
        </span>
        <span className="truncate flex-1 text-left text-label-large">{channel.name}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isSelected ? 'page' : undefined}
      data-ripple
      className={`m3-interactive group flex items-center gap-1.5 w-full h-9 px-2 rounded-m3-xl
        text-left transition-colors duration-200 ease-standard
        ${isSelected
          ? 'bg-secondary-container text-on-secondary-container'
          : 'text-on-surface-variant hover:text-on-surface'}`}
    >
      <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center transition-colors duration-200
        ${isSelected ? 'text-on-secondary-container' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
        {channel.nsfw ? <Lock size={18} /> : getChannelIcon(channel.type)}
      </span>
      <span className="truncate flex-1 text-label-large leading-5">
        {channel.name}
        {channel.nsfw && (
          <span className="ml-1.5 text-label-small text-error align-middle uppercase">NSFW</span>
        )}
      </span>
      {showUnread && Boolean(unreadCount) && (
        <span
          aria-label={`${unreadCount} unread`}
          className="min-w-5 h-5 px-1 rounded-full bg-error text-on-error text-label-small
            font-medium flex items-center justify-center flex-shrink-0"
        >
          {unreadCount! > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
});

function CategorySection({ name, channels, selectedChannelId, unreadCounts, showUnread, onSelectChannel }: {
  name: string;
  channels: Channel[];
  selectedChannelId: string | null;
  unreadCounts: Record<string, number>;
  showUnread: boolean;
  onSelectChannel: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="mt-4 first:mt-0">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        data-ripple
        className="m3-interactive flex items-center gap-0.5 w-full pl-1 pr-2 h-7 rounded-m3-xs
          text-label-small text-on-surface-variant uppercase tracking-[0.05em]
          hover:text-on-surface transition-colors duration-200 ease-standard group"
      >
        <ChevronDown
          size={14}
          className="flex-shrink-0 transition-transform duration-200 ease-emphasized"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        />
        <span className="truncate">{name}</span>
        <span className="ml-auto text-[10px] tabular-nums opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {channels.length}
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-0.5 mt-0.5">
          {channels.map((ch) => (
            <ChannelItem
              key={ch.id}
              channel={ch}
              isSelected={selectedChannelId === ch.id}
              unreadCount={unreadCounts[ch.id]}
              showUnread={showUnread}
              onClick={() => onSelectChannel(ch.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChannelList() {
  const { guilds, selectedGuildId, channels, selectedChannelId, selectChannel, isLoadingChannels, setError, unreadCounts, userSettings } = useStore();
  const guild = guilds.find((g) => g.id === selectedGuildId);
  const guildChannels = selectedGuildId ? channels[selectedGuildId] || [] : [];

  const categories = new Map<string | null, Channel[]>();
  const categoryChannels: Channel[] = [];
  guildChannels.forEach((ch) => {
    if (ch.type === 4) {
      categoryChannels.push(ch);
      if (!categories.has(ch.id)) categories.set(ch.id, []);
    }
  });
  guildChannels.forEach((ch) => {
    if (ch.type !== 4) {
      const pid = ch.parent_id || null;
      if (!categories.has(pid)) categories.set(pid, []);
      categories.get(pid)!.push(ch);
    }
  });

  return (
    <div
      className="w-[240px] bg-surface-container flex flex-col flex-shrink-0 h-full min-h-0"
      role="navigation"
      aria-label="Channels"
    >
      {/* Server header, lifted one tonal step above the drawer body. */}
      <button
        type="button"
        onClick={() => setError(`Server: ${guild?.name || 'Server'} • ${guildChannels.length} channels loaded.`)}
        data-ripple
        className="m3-interactive elev-2 h-12 px-4 flex items-center justify-between flex-shrink-0
          bg-surface-container-high text-on-surface transition-colors duration-200 ease-standard"
        aria-label={`Server: ${guild?.name || 'Server'}. ${guildChannels.length} channels loaded.`}
      >
        <h2 className="font-medium truncate text-title-small">{guild?.name || 'Server'}</h2>
        <ChevronDown size={18} className="text-on-surface-variant flex-shrink-0 ml-2" />
      </button>

      <div className="flex-1 overflow-y-auto channel-scroll px-2 pt-3 pb-2 min-h-0">
        {isLoadingChannels ? (
          <div className="space-y-3 p-1" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 h-9">
                <div className="w-5 h-5 rounded-m3-xs animate-shimmer flex-shrink-0" />
                <div className="h-3 rounded-m3-xs animate-shimmer" style={{ width: `${45 + ((i * 13) % 45)}%` }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            {categories.get(null)?.length ? (
              <div className="space-y-0.5 mb-2">
                {categories.get(null)!.map((ch) => (
                  <ChannelItem
                    key={ch.id}
                    channel={ch}
                    isSelected={selectedChannelId === ch.id}
                    unreadCount={unreadCounts[ch.id]}
                    showUnread={userSettings.unreadBadge}
                    onClick={() => selectChannel(ch.id)}
                  />
                ))}
              </div>
            ) : null}
            {categoryChannels
              .sort((a, b) => (a.position || 0) - (b.position || 0))
              .map((cat) => {
                const items = categories.get(cat.id) || [];
                if (!items.length) return null;
                return (
                  <CategorySection
                    key={cat.id}
                    name={cat.name || 'Unknown'}
                    selectedChannelId={selectedChannelId}
                    channels={[...items].sort((a, b) => (a.position || 0) - (b.position || 0))}
                    unreadCounts={unreadCounts}
                    showUnread={userSettings.unreadBadge}
                    onSelectChannel={selectChannel}
                  />
                );
              })}
            {!guildChannels.length && (
              <p className="px-2 py-6 text-center text-body-small text-on-surface-variant">
                No channels in this server.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
