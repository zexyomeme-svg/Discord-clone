import { LogOut, ShieldCheck, Users, ExternalLink, AlertCircle } from 'lucide-react';
import useStore from '../store/useStore';
import { getGuildIconUrl, getUserAvatarUrl } from '../services/discordApi';

export default function OAuthDashboard() {
  const { user, guilds, logout } = useStore();

  if (!user) return null;

  const avatar = getUserAvatarUrl(user.id, user.avatar, user.discriminator);

  return (
    <div className="h-full w-full bg-discord-channel text-discord-text overflow-auto">
      <div className="max-w-5xl mx-auto p-6 md:p-10">
        <div className="bg-discord-sidebar rounded-xl shadow-2xl overflow-hidden border border-discord-border/60">
          <div className="h-28 bg-gradient-to-r from-discord-blurple via-[#7c5cff] to-discord-fuchsia" />
          <div className="px-6 pb-6">
            <div className="flex flex-col md:flex-row md:items-end gap-4 -mt-10">
              <img src={avatar} alt="" className="w-24 h-24 rounded-full border-8 border-discord-sidebar bg-discord-dark" />
              <div className="flex-1 md:pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-white">{user.global_name || user.username}</h1>
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-discord-green/15 text-discord-green">
                    <ShieldCheck size={14} /> OAuth2 connected
                  </span>
                </div>
                <p className="text-discord-text-muted text-sm">@{user.username} • ID {user.id}</p>
              </div>
              <button onClick={logout} className="flex items-center justify-center gap-2 px-4 py-2 rounded bg-discord-red hover:bg-red-600 text-white font-medium transition-colors">
                <LogOut size={18} /> Log out
              </button>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-[1fr_320px]">
              <div className="bg-discord-channel rounded-lg border border-discord-border/50">
                <div className="p-4 border-b border-discord-border/50 flex items-center gap-2">
                  <Users size={20} className="text-discord-text-muted" />
                  <h2 className="font-semibold text-white">Your servers from OAuth2</h2>
                  <span className="text-xs text-discord-text-muted">({guilds.length})</span>
                </div>
                <div className="p-3 max-h-[520px] overflow-y-auto channel-scroll">
                  {guilds.length ? (
                    <div className="grid sm:grid-cols-2 gap-2">
                      {guilds.map((guild) => {
                        const icon = getGuildIconUrl(guild.id, guild.icon, 64);
                        return (
                          <div key={guild.id} className="flex items-center gap-3 p-3 rounded bg-discord-sidebar/70 hover:bg-discord-hover transition-colors">
                            {icon ? <img src={icon} alt="" className="w-10 h-10 rounded-full" /> : (
                              <div className="w-10 h-10 rounded-full bg-discord-blurple flex items-center justify-center text-white font-semibold">
                                {guild.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-medium text-white">{guild.name}</p>
                              <p className="text-xs text-discord-text-muted">Guild ID: {guild.id}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="p-4 text-discord-text-muted">No guilds were returned. Make sure the Discord app requested the <code>guilds</code> scope.</p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-discord-dark/50 rounded-lg p-4 border border-discord-border/50">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={20} className="text-discord-yellow flex-shrink-0 mt-0.5" />
                    <div className="text-sm leading-relaxed text-discord-text-muted space-y-2">
                      <h3 className="font-semibold text-discord-yellow">OAuth2 mode is limited</h3>
                      <p>Discord OAuth2 safely signs in a user and can return profile and guild membership with the configured scopes.</p>
                      <p>It does not expose a personal account token, so this app cannot read private channel messages or act as the user. Use bot-token mode for bot API features.</p>
                    </div>
                  </div>
                </div>

                <a href="https://discord.com/developers/docs/topics/oauth2" target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 bg-discord-blurple hover:bg-discord-blurple-hover text-white rounded-lg p-4 transition-colors">
                  <span className="font-medium">Discord OAuth2 docs</span>
                  <ExternalLink size={18} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
