import { memo } from 'react';
import useStore from '../store/useStore';
import { getUserAvatarUrl } from '../services/discordApi';
import type { GuildMember, Role } from '../store/types';

/**
 * The 240px member list, as an M3 list: hoisted-role subheaders, pill-shaped
 * rows with state layers, and a bot badge rendered as a suggestion chip.
 */

const FALLBACK_NAME_COLOUR = '#9aa0a8';

function intToHex(c: number) {
  return (!c || c === 0) ? FALLBACK_NAME_COLOUR : `#${c.toString(16).padStart(6, '0')}`;
}

const MemberItem = memo(({ member, roleColor, streamerMode, developerMode }: {
  member: GuildMember;
  roleColor: string;
  streamerMode: boolean;
  developerMode: boolean;
}) => {
  const user = member.user;
  if (!user) return null;
  const av = getUserAvatarUrl(user.id, user.avatar, user.discriminator);
  const name = streamerMode ? 'Hidden User' : (member.nick || user.global_name || user.username);

  return (
    <div
      data-ripple
      title={developerMode ? user.id : undefined}
      className="m3-interactive flex items-center gap-3 w-full h-11 px-2 rounded-m3-xl
        text-on-surface-variant hover:text-on-surface transition-colors duration-200 ease-standard group"
    >
      <div className="relative flex-shrink-0">
        <img
          src={av}
          alt=""
          className="w-8 h-8 rounded-full bg-surface-container-highest"
          onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
        />
        <span
          aria-hidden="true"
          className="absolute -bottom-px -right-px w-[12px] h-[12px] bg-on-surface-variant/70
            rounded-full ring-[2.5px] ring-surface-container"
        />
      </div>
      <span className="text-label-large truncate flex-1 transition-colors" style={{ color: roleColor }}>
        {name}
      </span>
      {user.bot && (
        <span
          className="flex-shrink-0 bg-secondary-container text-on-secondary-container
            text-[9px] font-medium px-1.5 py-0.5 rounded-m3-xs uppercase tracking-[0.04em]"
        >
          Bot
        </span>
      )}
    </div>
  );
});

export default function MemberList() {
  const { selectedGuildId, members, roles, showMemberList, userSettings } = useStore();
  if (!showMemberList) return null;

  const gMembers = selectedGuildId ? members[selectedGuildId] || [] : [];
  const gRoles = selectedGuildId ? roles[selectedGuildId] || [] : [];
  const hoisted = gRoles.filter((r) => r.hoist).sort((a, b) => b.position - a.position);

  const groups: { role: Role | null; members: GuildMember[] }[] = [];
  const used = new Set<string>();

  for (const role of hoisted) {
    const rm = gMembers.filter((m) => m.roles.includes(role.id) && m.user && !used.has(m.user.id));
    if (rm.length) {
      groups.push({ role, members: rm });
      rm.forEach((m) => { if (m.user) used.add(m.user.id); });
    }
  }
  const rest = gMembers.filter((m) => m.user && !used.has(m.user.id));
  if (rest.length) groups.push({ role: null, members: rest });

  function getColor(m: GuildMember) {
    if (!userSettings.showRoleColors || !m.roles?.length) return FALLBACK_NAME_COLOUR;
    const colorRoles = gRoles
      .filter((r) => m.roles.includes(r.id) && r.color !== 0)
      .sort((a, b) => b.position - a.position);
    return colorRoles.length ? intToHex(colorRoles[0].color) : FALLBACK_NAME_COLOUR;
  }

  return (
    <div
      className="w-[240px] bg-surface-container flex-shrink-0 overflow-y-auto channel-scroll min-h-0"
      role="complementary"
      aria-label="Members"
    >
      <div className="px-2 py-4">
        {!gMembers.length ? (
          <div className="px-2 space-y-3" aria-hidden="true">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 h-11">
                <div className="w-8 h-8 rounded-full animate-shimmer flex-shrink-0" />
                <div className="h-3.5 rounded-m3-xs animate-shimmer" style={{ width: `${35 + ((i * 17) % 55)}%` }} />
              </div>
            ))}
          </div>
        ) : groups.map((g, i) => (
          <div key={i} className="mb-5">
            <h3 className="px-3 text-label-small text-on-surface-variant uppercase tracking-[0.05em] mb-1">
              {g.role ? g.role.name : 'Online'}
              <span className="ml-1.5 tabular-nums opacity-70">{g.members.length}</span>
            </h3>
            <div className="space-y-0.5">
              {g.members.map((m) => (
                <MemberItem
                  key={m.user?.id}
                  member={m}
                  roleColor={getColor(m)}
                  streamerMode={userSettings.streamerMode}
                  developerMode={userSettings.developerMode}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
