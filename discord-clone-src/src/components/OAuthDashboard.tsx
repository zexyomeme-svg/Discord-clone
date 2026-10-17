import { LogOut, ShieldCheck, Users, ExternalLink, Info } from 'lucide-react';
import useStore from '../store/useStore';
import { getGuildIconUrl, getUserAvatarUrl } from '../services/discordApi';

/**
 * Read-only dashboard shown in OAuth2 mode, styled as a stack of Material 3
 * cards on the app surface.
 */
export default function OAuthDashboard() {
  const { user, guilds, logout } = useStore();

  if (!user) return null;

  const avatar = getUserAvatarUrl(user.id, user.avatar, user.discriminator);

  return (
    <div className="h-full w-full bg-surface text-on-surface overflow-auto">
      <div className="max-w-5xl mx-auto p-4 md:p-10">
        {/* Profile card */}
        <div className="bg-surface-container rounded-m3-xl elev-2 overflow-hidden">
          <div
            aria-hidden="true"
            className="h-28 bg-[linear-gradient(100deg,var(--color-primary-container),var(--color-tertiary-container))]"
          />
          <div className="px-5 pb-5 md:px-6 md:pb-6">
            <div className="flex flex-col md:flex-row md:items-end gap-4 -mt-10">
              <img
                src={avatar}
                alt=""
                className="w-24 h-24 rounded-full ring-4 ring-surface-container bg-surface-container-high self-center md:self-auto"
                onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
              />
              <div className="flex-1 md:pb-2 text-center md:text-left min-w-0">
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                  <h1 className="text-headline-small font-medium text-on-surface truncate">
                    {user.global_name || user.username}
                  </h1>
                  <span className="inline-flex items-center gap-1.5 text-label-small px-2.5 py-1 rounded-m3-xs
                    bg-success-container text-on-success-container">
                    <ShieldCheck size={14} aria-hidden="true" /> OAuth2 connected
                  </span>
                </div>
                <p className="text-body-small text-on-surface-variant mt-1 break-all">
                  @{user.username} · ID {user.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                data-ripple
                className="m3-interactive self-center md:self-auto flex items-center justify-center gap-2
                  h-11 px-5 rounded-m3-xl bg-error-container text-on-error-container text-label-large
                  transition-shadow duration-200 ease-standard hover:shadow-md"
              >
                <LogOut size={18} aria-hidden="true" /> Log out
              </button>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-[1fr_320px]">
              {/* Guild list card */}
              <div className="bg-surface-container-high rounded-m3-lg ring-1 ring-outline-variant overflow-hidden">
                <div className="p-4 flex items-center gap-2.5 border-b border-outline-variant">
                  <Users size={20} className="text-on-surface-variant flex-shrink-0" aria-hidden="true" />
                  <h2 className="text-title-small text-on-surface flex-1 min-w-0">Your servers from OAuth2</h2>
                  <span className="text-label-small text-on-surface-variant tabular-nums flex-shrink-0">
                    {guilds.length}
                  </span>
                </div>
                <div className="p-3 max-h-[520px] overflow-y-auto channel-scroll">
                  {guilds.length ? (
                    <div className="grid sm:grid-cols-2 gap-2">
                      {guilds.map((guild) => {
                        const icon = getGuildIconUrl(guild.id, guild.icon, 64);
                        return (
                          <div
                            key={guild.id}
                            data-ripple
                            className="m3-interactive flex items-center gap-3 p-3 rounded-m3-md
                              bg-surface-container text-on-surface"
                          >
                            {icon ? (
                              <img
                                src={icon}
                                alt=""
                                className="w-10 h-10 rounded-full flex-shrink-0 bg-surface-container-highest"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center
                                text-on-primary-container text-label-large flex-shrink-0">
                                {guild.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-label-large text-on-surface">{guild.name}</p>
                              <p className="text-label-small text-on-surface-variant truncate">ID {guild.id}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="p-4 text-body-medium text-on-surface-variant">
                      No guilds were returned. Make sure the Discord app requested the{' '}
                      <code className="px-1.5 py-0.5 rounded-m3-xs bg-surface-container-lowest text-on-surface text-body-small">guilds</code>{' '}
                      scope.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-tertiary-container/35 rounded-m3-lg p-4">
                  <div className="flex items-start gap-3">
                    <Info size={20} className="text-tertiary flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="text-body-small leading-relaxed text-on-surface-variant space-y-2 min-w-0">
                      <h3 className="text-label-large text-on-surface">OAuth2 mode is limited</h3>
                      <p>Discord OAuth2 safely signs in a user and can return profile and guild membership with the configured scopes.</p>
                      <p>
                        It does not expose a personal account token, so this app cannot read private channel messages or
                        act as the user. Use bot-token mode for bot API features.
                      </p>
                    </div>
                  </div>
                </div>

                <a
                  href="https://discord.com/developers/docs/topics/oauth2"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-ripple
                  className="m3-interactive flex items-center justify-between gap-3 bg-primary text-on-primary
                    rounded-m3-lg p-4 text-label-large transition-shadow duration-200 ease-standard hover:shadow-md"
                >
                  <span>Discord OAuth2 docs</span>
                  <ExternalLink size={18} aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
