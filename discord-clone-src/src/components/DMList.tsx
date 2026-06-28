import { useState, memo } from 'react';
import { Search, Plus, Users, X } from 'lucide-react';
import useStore from '../store/useStore';
import { getUserAvatarUrl } from '../services/discordApi';
import type { Channel } from '../store/types';

const DMItem = memo(({ channel, isSelected, onClick }: { channel: Channel; isSelected: boolean; onClick: () => void }) => {
  const r = channel.recipients?.[0];
  if (!r && channel.type !== 3) return null;
  const av = r ? getUserAvatarUrl(r.id, r.avatar, r.discriminator) : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const name = channel.type === 3 ? (channel.name || channel.recipients?.map(x => x.username).join(', ') || 'Group DM') : (r?.global_name || r?.username || 'Unknown');

  return (
    <button onClick={onClick}
      className={`flex items-center gap-3 w-full px-2 py-[6px] rounded transition-colors group ${
        isSelected ? 'bg-discord-active text-white' : 'text-discord-text-muted hover:text-discord-text hover:bg-discord-hover'
      }`}>
      <div className="relative flex-shrink-0">
        {channel.type === 3 ? (
          <div className="w-8 h-8 rounded-full bg-discord-input flex items-center justify-center"><Users size={16} /></div>
        ) : (
          <img src={av} alt="" className="w-8 h-8 rounded-full"
            onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
        )}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[15px] font-medium truncate leading-5">{name}</p>
        {channel.type === 3 && channel.recipients && <p className="text-xs text-discord-text-muted truncate">{channel.recipients.length} Members</p>}
      </div>
      {!isSelected && <X size={14} className="text-discord-text-muted opacity-0 group-hover:opacity-100 hover:text-discord-text transition-all flex-shrink-0" />}
    </button>
  );
});

export default function DMList() {
  const { dmChannels, selectedChannelId, selectDMChannel, setError } = useStore();
  const [q, setQ] = useState('');
  const filtered = dmChannels.filter(ch => {
    if (!q) return true;
    return (ch.recipients?.map(r => r.username).join(' ') || ch.name || '').toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div className="w-[240px] bg-discord-sidebar flex flex-col flex-shrink-0 h-full min-h-0">
      <div className="h-12 px-2 flex items-center border-b border-discord-darker/70 shadow-sm flex-shrink-0">
        <div className="w-full relative">
          <input type="text" placeholder="Find or start a conversation" value={q} onChange={e => setQ(e.target.value)}
            className="w-full bg-discord-dark text-discord-text text-sm rounded h-[28px] px-2 outline-none placeholder:text-discord-text-muted" />
          <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-discord-text-muted pointer-events-none" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto channel-scroll pt-2 px-2 min-h-0">
        <button onClick={() => setError('Friends are only available through Discord OAuth2/user-client features, not bot tokens.')} className="flex items-center gap-3 w-full px-2 py-[6px] rounded text-discord-text-muted hover:text-discord-text hover:bg-discord-hover transition-colors">
          <Users size={20} /><span className="text-[15px] font-medium">Friends</span>
        </button>
        <div className="flex items-center justify-between px-2 pt-5 pb-1">
          <span className="text-[11px] font-bold text-discord-text-muted uppercase tracking-[0.02em]">Direct Messages</span>
          <button onClick={() => setError('Starting new DMs requires a recipient user ID and bot permission context. Existing bot DM channels are listed automatically.')} className="text-discord-text-muted hover:text-discord-text transition-colors"><Plus size={16} /></button>
        </div>

        {!filtered.length ? (
          <div className="px-2 py-8 text-center">
            <p className="text-sm text-discord-text-muted">{q ? 'No results' : 'No DMs yet'}</p>
          </div>
        ) : (
          <div className="space-y-px">
            {filtered.map(ch => <DMItem key={ch.id} channel={ch} isSelected={selectedChannelId === ch.id} onClick={() => selectDMChannel(ch.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
}
