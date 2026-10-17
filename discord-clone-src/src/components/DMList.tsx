import { useState, memo } from 'react';
import { Search, Plus, Users, X, Send } from 'lucide-react';
import useStore from '../store/useStore';
import { getChannelIconUrl, getUserAvatarUrl } from '../services/discordApi';
import type { Channel } from '../store/types';

/**
 * The DM drawer. Same 240px column and same contents as Discord's, styled as an
 * M3 list: search field, subheader, pill-selected rows, assist chip for the
 * unread badge.
 */

const DMItem = memo(({ channel, isSelected, unreadCount, showUnread, onClick, onHide }: {
  channel: Channel;
  isSelected: boolean;
  unreadCount: number;
  showUnread: boolean;
  onClick: () => void;
  onHide: () => void;
}) => {
  const r = channel.recipients?.[0];
  const isGroup = channel.type === 3;
  if (!r && !isGroup) return null;

  const groupIcon = isGroup ? getChannelIconUrl(channel.id, channel.icon) : null;
  const av = r ? getUserAvatarUrl(r.id, r.avatar, r.discriminator) : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const name = isGroup
    ? (channel.name || channel.recipients?.map((x) => x.username).join(', ') || 'Group DM')
    : (r?.global_name || r?.username || 'Unknown');

  return (
    // A real <div> rather than a nested <button>: the hide control below was
    // previously an <X> icon inside the row button, so it could not have its own
    // click handler and was purely decorative.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-current={isSelected ? 'true' : undefined}
      data-ripple
      className={`m3-interactive group flex items-center gap-3 w-full min-h-[44px] px-2 rounded-m3-xl
        transition-colors duration-200 ease-standard cursor-pointer
        ${isSelected
          ? 'bg-secondary-container text-on-secondary-container'
          : 'text-on-surface-variant hover:text-on-surface'}`}
    >
      <div className="relative flex-shrink-0">
        {isGroup ? (
          groupIcon
            ? (
              <img
                src={groupIcon}
                alt=""
                className="w-8 h-8 rounded-full bg-surface-container-highest"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )
            : (
              <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center">
                <Users size={16} className="text-on-surface-variant" />
              </div>
            )
        ) : (
          <img
            src={av}
            alt=""
            className="w-8 h-8 rounded-full bg-surface-container-highest"
            onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 text-left">
        <p className="text-label-large truncate leading-5">{name}</p>
        {isGroup && channel.recipients && (
          <p className="text-label-small text-on-surface-variant truncate tabular-nums">
            {channel.recipients.length} members
          </p>
        )}
      </div>

      {showUnread && unreadCount > 0 && (
        <span
          aria-label={`${unreadCount} unread`}
          className="min-w-5 h-5 px-1 rounded-full bg-error text-on-error text-label-small
            flex items-center justify-center flex-shrink-0 tabular-nums"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onHide(); }}
        title="Hide this conversation from the list"
        aria-label={`Hide conversation with ${name}`}
        data-ripple
        className="m3-interactive w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0
          text-on-surface-variant opacity-0 group-hover:opacity-100 focus:opacity-100
          focus-visible:opacity-100 hover:text-on-surface transition-[opacity,color] duration-200 ease-standard"
      >
        <X size={15} />
      </button>
    </div>
  );
});

export default function DMList() {
  const { dmChannels, selectedChannelId, selectDMChannel, createDMChannel, hideDMChannel, setError, unreadCounts, userSettings } = useStore();
  const [q, setQ] = useState('');
  const [newDmUserId, setNewDmUserId] = useState('');
  const [showNewDm, setShowNewDm] = useState(false);
  const [creating, setCreating] = useState(false);

  const startDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDmUserId.trim() || creating) return;
    setCreating(true);
    try {
      await createDMChannel(newDmUserId.trim());
      setNewDmUserId('');
      setShowNewDm(false);
    } catch {
      /* the store surfaces the error */
    } finally {
      setCreating(false);
    }
  };

  const filtered = dmChannels.filter((ch) => {
    if (!q) return true;
    return (ch.recipients?.map((r) => r.username).join(' ') || ch.name || '')
      .toLowerCase()
      .includes(q.toLowerCase());
  });

  return (
    <div
      className="w-[240px] bg-surface-container flex flex-col flex-shrink-0 h-full min-h-0"
      role="navigation"
      aria-label="Direct messages"
    >
      <div className="h-12 px-2 flex items-center flex-shrink-0 elev-2 bg-surface-container-high">
        <div className="w-full relative">
          <input
            type="text"
            data-app-search="true"
            placeholder="Find or start a conversation"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Find or start a conversation"
            className="w-full bg-surface-container-lowest text-on-surface text-body-small rounded-m3-sm
              h-8 pl-2.5 pr-8 outline-none placeholder:text-on-surface-variant/70
              focus:outline focus:outline-2 focus:outline-primary transition-[outline-color] duration-200"
          />
          <Search size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto channel-scroll pt-2 px-2 pb-2 min-h-0">
        <button
          type="button"
          data-ripple
          onClick={() => setError('Friend management is a Discord user-client feature and is not available to bots. Use the + button to start a DM with a user ID.')}
          className="m3-interactive flex items-center gap-3 w-full min-h-[44px] px-2 rounded-m3-xl
            text-on-surface-variant hover:text-on-surface transition-colors duration-200 ease-standard"
        >
          <Users size={20} className="flex-shrink-0" />
          <span className="text-label-large">Friends info</span>
        </button>

        <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
          <span className="text-label-small text-on-surface-variant uppercase tracking-[0.05em]">
            Direct Messages
          </span>
          <button
            type="button"
            data-ripple
            onClick={() => setShowNewDm((v) => !v)}
            title="Start bot DM by user ID"
            aria-label="Start a direct message by user ID"
            aria-expanded={showNewDm}
            className={`m3-interactive w-7 h-7 flex items-center justify-center rounded-full transition-colors duration-200
              ${showNewDm ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            <Plus size={16} />
          </button>
        </div>

        {showNewDm && (
          <form
            onSubmit={startDm}
            className="mx-1 mb-2 p-3 bg-surface-container-high rounded-m3-md space-y-2.5 ring-1 ring-outline-variant animate-scale-in"
          >
            <div>
              <label htmlFor="dm-recipient" className="block text-label-small text-on-surface-variant mb-1.5">
                Recipient user ID
              </label>
              <input
                id="dm-recipient"
                value={newDmUserId}
                onChange={(e) => setNewDmUserId(e.target.value)}
                placeholder="e.g. 80351110224678912"
                className="w-full bg-surface-container-lowest text-on-surface text-body-small rounded-m3-sm
                  px-2.5 py-2 outline-none placeholder:text-on-surface-variant/60
                  focus:outline focus:outline-2 focus:outline-primary transition-[outline-color] duration-200"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-ripple
                onClick={() => setShowNewDm(false)}
                className="m3-interactive flex-1 h-9 rounded-m3-xl text-label-large text-primary
                  transition-colors duration-200 ease-standard"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-ripple
                disabled={!newDmUserId.trim() || creating}
                className="m3-interactive flex-1 h-9 rounded-m3-xl text-label-large bg-primary text-on-primary
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors duration-200 ease-standard flex items-center justify-center gap-1.5"
              >
                <Send size={15} />
                {creating ? 'Opening…' : 'Open'}
              </button>
            </div>
          </form>
        )}

        {!filtered.length ? (
          <div className="px-3 py-8 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-m3-xl bg-surface-container-high flex items-center justify-center">
              <Users size={24} className="text-on-surface-variant/60" />
            </div>
            <p className="text-body-medium text-on-surface-variant">{q ? 'No results' : 'No DMs yet'}</p>
            {!q && (
              <p className="text-label-small text-on-surface-variant/80 mt-2 leading-relaxed">
                Bot tokens cannot list existing DMs, so conversations you start here with the{' '}
                <span className="text-on-surface font-medium">+</span> button are remembered in this browser.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((ch) => (
              <DMItem
                key={ch.id}
                channel={ch}
                isSelected={selectedChannelId === ch.id}
                unreadCount={unreadCounts[ch.id] || 0}
                showUnread={userSettings.unreadBadge}
                onClick={() => selectDMChannel(ch.id)}
                onHide={() => hideDMChannel(ch.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
