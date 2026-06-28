import { Mic, MicOff, Headphones, HeadphoneOff, Settings } from 'lucide-react';
import useStore from '../store/useStore';
import { getUserAvatarUrl } from '../services/discordApi';

export default function UserPanel() {
  const { user, openSettings, userSettings, updateSettings } = useStore();
  if (!user) return null;
  const avatarUrl = getUserAvatarUrl(user.id, user.avatar, user.discriminator);
  const { isMuted, isDeafened } = userSettings;

  return (
    <div className="h-[52px] bg-discord-darker/60 px-2 flex items-center gap-1 flex-shrink-0">
      <button onClick={() => openSettings('my-account')}
        className="flex items-center gap-2 flex-1 min-w-0 rounded px-1 py-1 hover:bg-discord-hover transition-colors">
        <div className="relative flex-shrink-0">
          <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full"
            onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
          <div className={`absolute -bottom-0.5 -right-0.5 w-[14px] h-[14px] rounded-full border-[3px] border-[#232428] ${isDeafened || isMuted ? 'bg-discord-text-muted' : 'bg-discord-green'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white truncate leading-[18px]">{user.global_name || user.username}</p>
          <p className="text-[11px] text-discord-text-muted truncate leading-[13px]">{isDeafened ? 'Deafened' : isMuted ? 'Muted' : 'Online'}</p>
        </div>
      </button>

      <div className="flex items-center">
        <button onClick={() => updateSettings({ isMuted: !isMuted })}
          className={`w-8 h-8 flex items-center justify-center rounded hover:bg-discord-hover transition-colors ${isMuted ? 'text-discord-red' : 'text-discord-text-muted hover:text-discord-text'}`}
          title={isMuted ? 'Unmute' : 'Mute'}>
          {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          {isMuted && <div className="absolute w-[2px] h-5 bg-discord-red rotate-45 rounded" />}
        </button>
        <button onClick={() => updateSettings({ isDeafened: !isDeafened })}
          className={`w-8 h-8 flex items-center justify-center rounded hover:bg-discord-hover transition-colors ${isDeafened ? 'text-discord-red' : 'text-discord-text-muted hover:text-discord-text'}`}
          title={isDeafened ? 'Undeafen' : 'Deafen'}>
          {isDeafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
        </button>
        <button onClick={() => openSettings('my-account')}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-discord-hover text-discord-text-muted hover:text-discord-text transition-colors"
          title="User Settings">
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}
