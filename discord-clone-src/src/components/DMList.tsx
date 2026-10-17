import { useState, memo } from 'react';
import { Search, Plus, Users, X } from 'lucide-react';
import useStore from '../store/useStore';
import { getChannelIconUrl, getUserAvatarUrl } from '../services/discordApi';
import type { Channel } from '../store/types';

const DMItem = memo(({ channel, isSelected, onClick, onHide }: { channel: Channel; isSelected: boolean; onClick: () => void; onHide: () => void }) => {
  const r = channel.recipients?.[0];
  const isGroup = channel.type === 3;
  if (!r && !isGroup) return null;

  const groupIcon = isGroup ? getChannelIconUrl(channel.id, channel.icon) : null;
  const av = r ? getUserAvatarUrl(r.id, r.avatar, r.discriminator) : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const name = isGroup ? (channel.name || channel.recipients?.map(x => x.username).join(', ') || 'Group DM') : (r?.global_name || r?.username || 'Unknown');

  return (
    // A real <div> rather than a nested <button>: the hide control below was
    // previously an <X> icon inside the row button, so it could not have its own
    // click handler and was purely decorative.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`flex items-center gap-3 w-full px-2 py-[6px] rounded transition-colors group cursor-pointer ${
        isSelected ? 'bg-discord-active text-white' : 'text-discord-text-muted hover:text-discord-text hover:bg-discord-hover'
      }`}>
      <div className="relative flex-shrink-0">
        {isGroup ? (
          groupIcon
            ? <img src={groupIcon} alt="" className="w-8 h-8 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : <div className="w-8 h-8 rounded-full bg-discord-input flex items-center justify-center"><Users size={16} /></div>
        ) : (
          <img src={av} alt="" className="w-8 h-8 rounded-full"
            onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
        )}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[15px] font-medium truncate leading-5">{name}</p>
        {isGroup && channel.recipients && <p className="text-xs text-discord-text-muted truncate">{channel.recipients.length} Members</p>}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onHide(); }}
        title="Hide this conversation from the list"
        aria-label={`Hide conversation with ${name}`}
        className="p-0.5 rounded text-discord-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-discord-text hover:bg-discord-dark transition-all flex-shrink-0">
        <X size={14} />
      </button>
    </div>
  );
});

export default function DMList() {
  const { dmChannels, selectedChannelId, selectDMChannel, createDMChannel, hideDMChannel, setError, unreadCounts, userSettings } = useStore();
  const [q, setQ] = useState('');
  const [newDmUserId, setNewDmUserId] = useState('');
  const [showNewDm, setShowNewDm] = useState(false);

  const startDm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createDMChannel(newDmUserId);
      setNewDmUserId('');
      setShowNewDm(false);
    } catch { /* store shows error */ }
  };
  const filtered = dmChannels.filter(ch => {
    if (!q) return true;
    return (ch.recipients?.map(r => r.username).join(' ') || ch.name || '').toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div className="w-[240px] bg-discord-sidebar flex flex-col flex-shrink-0 h-full min-h-0">
      <div className="h-12 px-2 flex items-center border-b border-discord-darker/70 shadow-sm flex-shrink-0">
        <div className="w-full relative">
          <input type="text" data-app-search="true" placeholder="Find or start a conversation" value={q} onChange={e => setQ(e.target.value)}
            className="w-full bg-discord-dark text-discord-text text-sm rounded h-[28px] px-2 outline-none placeholder:text-discord-text-muted" />
          <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-discord-text-muted pointer-events-none" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto channel-scroll pt-2 px-2 min-h-0">
        <button onClick={() => setError('Friend management is a Discord user-client feature and is not available to bots. Use the + button to start a DM with a user ID.')} className="flex items-center gap-3 w-full px-2 py-[6px] rounded text-discord-text-muted hover:text-discord-text hover:bg-discord-hover transition-colors">
          <Users size={20} /><span className="text-[15px] font-medium">Friends info</span>
        </button>
        <div className="flex items-center justify-between px-2 pt-5 pb-1">
          <span className="text-[11px] font-bold text-discord-text-muted uppercase tracking-[0.02em]">Direct Messages</span>
          <button onClick={() => setShowNewDm((v) => !v)} title="Start bot DM by user ID" className="text-discord-text-muted hover:text-discord-text transition-colors"><Plus size={16} /></button>
        </div>

        {showNewDm && (
          <form onSubmit={startDm} className="mx-2 mb-2 p-2 bg-discord-dark rounded space-y-2">
            <input value={newDmUserId} onChange={(e) => setNewDmUserId(e.target.value)} placeholder="Recipient user ID" className="w-full bg-discord-input text-discord-text text-sm rounded px-2 py-1.5 outline-none" />
            <button type="submit" className="w-full bg-discord-blurple hover:bg-discord-blurple-hover text-white text-xs font-medium py-1.5 rounded">Create DM</button>
          </form>
        )}

        {!filtered.length ? (
          <div className="px-2 py-8 text-center">
            <p className="text-sm text-discord-text-muted">{q ? 'No results' : 'No DMs yet'}</p>
            {!q && (
              <p className="text-[11px] text-discord-text-muted mt-2 leading-relaxed px-1">
                Bot tokens cannot list existing DMs, so conversations you start
                here with the <span className="text-discord-text">+</span> button
                are remembered in this browser.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-px">
            {filtered.map(ch => (
              <div key={ch.id} className="relative">
                <DMItem
                  channel={ch}
                  isSelected={selectedChannelId === ch.id}
                  onClick={() => selectDMChannel(ch.id)}
                  onHide={() => hideDMChannel(ch.id)}
                />
                {userSettings.unreadBadge && (unreadCounts[ch.id] || 0) > 0 && (
                  <span className="absolute right-7 top-1/2 -translate-y-1/2 min-w-5 h-5 px-1 rounded-full bg-discord-red text-white text-[11px] font-bold flex items-center justify-center">{unreadCounts[ch.id] > 99 ? '99+' : unreadCounts[ch.id]}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
