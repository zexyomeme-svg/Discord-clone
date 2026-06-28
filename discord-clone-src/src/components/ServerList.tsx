import { MessageSquare, Plus, Compass } from 'lucide-react';
import useStore from '../store/useStore';
import { getGuildIconUrl } from '../services/discordApi';

export default function ServerList() {
  const { guilds, selectedGuildId, selectGuild, viewMode, setViewMode } = useStore();

  return (
    <div className="w-[72px] bg-discord-darker flex flex-col items-center py-3 overflow-y-auto thin-scroll flex-shrink-0 h-full gap-2">
      {/* Home */}
      <div className="tooltip-container relative">
        <button onClick={() => setViewMode('dms')}
          className={`w-12 h-12 flex items-center justify-center transition-all duration-200 ${
            viewMode === 'dms' ? 'bg-discord-blurple rounded-[16px]' : 'bg-discord-channel hover:bg-discord-blurple rounded-[24px] hover:rounded-[16px]'
          }`}>
          <MessageSquare size={24} className="text-white" />
        </button>
        {viewMode === 'dms' && <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-px w-1 h-10 bg-white rounded-r-full" />}
        <span className="tooltip-text">Direct Messages</span>
      </div>

      <div className="w-8 h-0.5 bg-discord-channel rounded-full flex-shrink-0" />

      {/* Servers */}
      {guilds.map((guild) => {
        const isSelected = selectedGuildId === guild.id && viewMode === 'servers';
        const iconUrl = getGuildIconUrl(guild.id, guild.icon, 128);
        const initials = guild.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3);

        return (
          <div key={guild.id} className="tooltip-container relative flex-shrink-0">
            <button onClick={() => selectGuild(guild.id)}
              className={`w-12 h-12 flex items-center justify-center transition-all duration-200 overflow-hidden ${
                isSelected ? 'rounded-[16px]' : 'rounded-[24px] hover:rounded-[16px]'
              }`} title={guild.name}>
              {iconUrl ? (
                <img src={iconUrl} alt="" className="w-full h-full object-cover"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    el.style.display = 'none';
                    if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = 'flex';
                  }} />
              ) : null}
              <div className={`${iconUrl ? 'hidden' : 'flex'} w-full h-full items-center justify-center text-sm font-medium transition-colors duration-200 ${
                isSelected ? 'bg-discord-blurple text-white' : 'bg-discord-channel text-discord-text hover:bg-discord-blurple hover:text-white'
              }`} style={iconUrl ? { display: 'none' } : undefined}>
                {initials}
              </div>
            </button>
            <div className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-px w-1 rounded-r-full transition-all duration-200 ${
              isSelected ? 'h-10 bg-white' : 'h-0 group-hover:h-5 bg-white'
            }`} />
            <span className="tooltip-text">{guild.name}</span>
          </div>
        );
      })}

      <div className="w-8 h-0.5 bg-discord-channel rounded-full flex-shrink-0" />

      <div className="tooltip-container relative flex-shrink-0">
        <button className="w-12 h-12 flex items-center justify-center rounded-[24px] hover:rounded-[16px] bg-discord-channel hover:bg-discord-green transition-all duration-200 group">
          <Plus size={24} className="text-discord-green group-hover:text-white transition-colors" />
        </button>
        <span className="tooltip-text">Add a Server</span>
      </div>

      <div className="tooltip-container relative flex-shrink-0">
        <button className="w-12 h-12 flex items-center justify-center rounded-[24px] hover:rounded-[16px] bg-discord-channel hover:bg-discord-green transition-all duration-200 group">
          <Compass size={24} className="text-discord-green group-hover:text-white transition-colors" />
        </button>
        <span className="tooltip-text">Explore Servers</span>
      </div>
    </div>
  );
}
