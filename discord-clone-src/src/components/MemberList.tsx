import { memo } from 'react';
import useStore from '../store/useStore';
import { getUserAvatarUrl } from '../services/discordApi';
import type { GuildMember, Role } from '../store/types';

function intToHex(c: number) { return (!c || c === 0) ? '#99aab5' : `#${c.toString(16).padStart(6, '0')}`; }

const MemberItem = memo(({ member, roleColor }: { member: GuildMember; roleColor: string }) => {
  const user = member.user;
  if (!user) return null;
  const av = getUserAvatarUrl(user.id, user.avatar, user.discriminator);
  const name = member.nick || user.global_name || user.username;

  return (
    <button className="flex items-center gap-3 w-full px-2 py-[5px] rounded hover:bg-discord-hover transition-colors group">
      <div className="relative flex-shrink-0">
        <img src={av} alt="" className="w-8 h-8 rounded-full group-hover:opacity-90 transition-opacity"
          onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
        <div className="absolute -bottom-px -right-px w-[12px] h-[12px] bg-discord-text-muted rounded-full border-[2.5px] border-discord-sidebar" />
      </div>
      <span className="text-sm font-medium truncate transition-colors" style={{ color: roleColor }}>
        {name}
        {user.bot && <span className="ml-1.5 bg-discord-blurple text-white text-[9px] font-semibold px-[4px] py-[1px] rounded align-middle uppercase">Bot</span>}
      </span>
    </button>
  );
});

export default function MemberList() {
  const { selectedGuildId, members, roles, showMemberList } = useStore();
  if (!showMemberList) return null;

  const gMembers = selectedGuildId ? members[selectedGuildId] || [] : [];
  const gRoles = selectedGuildId ? roles[selectedGuildId] || [] : [];
  const hoisted = gRoles.filter(r => r.hoist).sort((a, b) => b.position - a.position);

  const groups: { role: Role | null; members: GuildMember[] }[] = [];
  const used = new Set<string>();

  for (const role of hoisted) {
    const rm = gMembers.filter(m => m.roles.includes(role.id) && m.user && !used.has(m.user.id));
    if (rm.length) { groups.push({ role, members: rm }); rm.forEach(m => { if (m.user) used.add(m.user.id); }); }
  }
  const rest = gMembers.filter(m => m.user && !used.has(m.user.id));
  if (rest.length) groups.push({ role: null, members: rest });

  function getColor(m: GuildMember) {
    if (!m.roles?.length) return '#99aab5';
    const colorRoles = gRoles.filter(r => m.roles.includes(r.id) && r.color !== 0).sort((a, b) => b.position - a.position);
    return colorRoles.length ? intToHex(colorRoles[0].color) : '#99aab5';
  }

  return (
    <div className="w-[240px] bg-discord-sidebar flex-shrink-0 overflow-y-auto channel-scroll min-h-0">
      <div className="px-2 py-4">
        {!gMembers.length ? (
          <div className="px-2 space-y-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full animate-shimmer flex-shrink-0" />
                <div className="h-3.5 rounded animate-shimmer" style={{ width: `${40 + Math.random() * 50}%` }} />
              </div>
            ))}
          </div>
        ) : groups.map((g, i) => (
          <div key={i} className="mb-5">
            <h3 className="px-2 text-[11px] font-bold text-discord-text-muted uppercase tracking-[0.02em] mb-1">
              {g.role ? g.role.name : 'Online'} — {g.members.length}
            </h3>
            {g.members.map(m => <MemberItem key={m.user?.id} member={m} roleColor={getColor(m)} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
