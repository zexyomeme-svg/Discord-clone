import { useState } from 'react';
import { MessageSquare, Plus, Compass } from 'lucide-react';
import useStore from '../store/useStore';
import { getGuildIconUrl } from '../services/discordApi';
import type { Guild } from '../store/types';

/**
 * The 72px guild rail. Structurally Discord's — home, a divider, the guilds,
 * then add/explore — but rendered in Material 3 terms:
 *
 *   * selection is a tonal container (primary-container / on-primary-container)
 *     rather than a flat blurple fill
 *   * the left indicator animates its height on the emphasized curve, and the
 *     hover height now actually works (the old markup referenced `group-hover`
 *     with no `group` ancestor, so the pill never grew on hover)
 *   * every item carries a state layer and a ripple
 *   * the unread count is an M3 badge with a ring that separates it from the
 *     surface beneath it
 */

/** Guild icon that falls back to initials if the CDN image is unreachable. */
function GuildIcon({ guild, iconUrl, selected }: { guild: Guild; iconUrl: string | null; selected: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = guild.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

  if (iconUrl && !failed) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`w-full h-full flex items-center justify-center text-label-medium transition-colors duration-200 ${
        selected
          ? 'bg-primary-container text-on-primary-container'
          : 'bg-surface-container-high text-on-surface-variant'
      }`}
    >
      {initials || '?'}
    </span>
  );
}

function RailButton({
  label,
  selected,
  onClick,
  children,
  tone = 'default',
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Colour the icon takes when idle. */
  tone?: 'default' | 'success';
}) {
  const idleTone = tone === 'success' ? 'text-success' : 'text-on-surface-variant';
  return (
    <div className="tooltip-container relative flex-shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={selected ? 'true' : undefined}
        data-ripple
        className={`m3-interactive group w-12 h-12 flex items-center justify-center
          transition-[border-radius,background-color,color] duration-300 ease-emphasized
          ${selected ? 'rounded-m3-lg bg-primary-container text-on-primary-container'
                     : `rounded-m3-xl hover:rounded-m3-lg ${tone === 'success' ? 'bg-surface-container-high hover:bg-success-container hover:text-on-success-container' : 'bg-surface-container-high hover:bg-secondary-container hover:text-on-secondary-container'} ${idleTone}`}`}
      >
        {children}
      </button>

      {/* Active / hovered indicator. M3 navigation-rail pill, rendered as the
          growing bar Discord's rail is known for. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-on-surface
          transition-[height,opacity] duration-300 ease-emphasized pointer-events-none
          ${selected ? 'h-10 opacity-100' : 'h-0 opacity-0 group-hover:h-5 group-hover:opacity-100'}`}
      />
      <span className="tooltip-text">{label}</span>
    </div>
  );
}

export default function ServerList() {
  const { guilds, selectedGuildId, selectGuild, viewMode, setViewMode, channels, unreadCounts, userSettings } = useStore();

  return (
    <div
      className="w-[72px] bg-surface-container-low flex flex-col items-center py-3 overflow-y-auto thin-scroll flex-shrink-0 h-full gap-2"
      role="navigation"
      aria-label="Servers"
    >
      <RailButton label="Direct Messages" selected={viewMode === 'dms'} onClick={() => setViewMode('dms')}>
        <MessageSquare size={24} className={viewMode === 'dms' ? 'text-on-primary-container' : undefined} />
      </RailButton>

      <div className="w-8 h-0.5 bg-outline-variant rounded-full flex-shrink-0" aria-hidden="true" />

      {guilds.map((guild) => {
        const isSelected = selectedGuildId === guild.id && viewMode === 'servers';
        const iconUrl = getGuildIconUrl(guild.id, guild.icon, 128);
        const guildUnread = userSettings.unreadBadge
          ? (channels[guild.id] || []).reduce((sum, ch) => sum + (unreadCounts[ch.id] || 0), 0)
          : 0;

        return (
          <div key={guild.id} className="relative flex-shrink-0">
            <div className="tooltip-container relative">
              <button
                type="button"
                onClick={() => selectGuild(guild.id)}
                aria-label={guild.name}
                aria-current={isSelected ? 'true' : undefined}
                data-ripple
                className={`m3-interactive group w-12 h-12 flex items-center justify-center overflow-hidden
                  transition-[border-radius,background-color] duration-300 ease-emphasized
                  ${isSelected
                    ? 'rounded-m3-lg ring-1 ring-primary/40'
                    : 'rounded-m3-xl hover:rounded-m3-lg'}`}
              >
                <GuildIcon guild={guild} iconUrl={iconUrl} selected={isSelected} />
              </button>

              <span
                aria-hidden="true"
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-on-surface
                  transition-[height,opacity] duration-300 ease-emphasized pointer-events-none
                  ${isSelected ? 'h-10 opacity-100' : 'h-0 opacity-0 group-hover:h-5 group-hover:opacity-100'}`}
              />
              <span className="tooltip-text">{guild.name}</span>
            </div>

            {guildUnread > 0 && (
              <span
                role="status"
                aria-label={`${guildUnread} unread`}
                className="absolute -right-1 -bottom-1 min-w-5 h-5 px-1 rounded-full bg-error text-on-error
                  text-label-small flex items-center justify-center
                  ring-2 ring-surface-container-low pointer-events-none"
              >
                {guildUnread > 99 ? '99+' : guildUnread}
              </span>
            )}
          </div>
        );
      })}

      <div className="w-8 h-0.5 bg-outline-variant rounded-full flex-shrink-0" aria-hidden="true" />

      <RailButton
        label="Add a Server"
        tone="success"
        onClick={() => window.open('https://discord.com/developers/applications', '_blank', 'noopener,noreferrer')}
      >
        <Plus size={24} className="transition-colors group-hover:text-on-success-container" />
      </RailButton>

      <RailButton
        label="Explore Servers"
        tone="success"
        onClick={() => window.open('https://discord.com/servers', '_blank', 'noopener,noreferrer')}
      >
        <Compass size={24} className="transition-colors group-hover:text-on-success-container" />
      </RailButton>
    </div>
  );
}
