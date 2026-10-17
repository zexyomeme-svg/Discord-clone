import { Mic, MicOff, Headphones, HeadphoneOff, Settings, WifiOff, Loader2 } from 'lucide-react';
import useStore from '../store/useStore';
import { getUserAvatarUrl } from '../services/discordApi';

/** Human-readable label + colour for the realtime gateway connection state. */
function gatewayStatusInfo(status: string | null): { label: string; tone: string; spinner: boolean } | null {
  switch (status) {
    case 'ready':
      return null; // Connected: nothing to warn about, keep the panel clean.
    case 'connecting':
    case 'identifying':
    case 'resuming':
    case 'reconnecting':
      return { label: 'Connecting…', tone: 'text-discord-yellow', spinner: true };
    case 'fatal':
      return { label: 'Realtime unavailable', tone: 'text-discord-red', spinner: false };
    case 'closed':
      return { label: 'Disconnected', tone: 'text-discord-text-muted', spinner: false };
    default:
      return null;
  }
}

export default function UserPanel() {
  const { user, openSettings, userSettings, updateSettings, gatewayStatus, gatewayDetail } = useStore();
  if (!user) return null;
  const avatarUrl = getUserAvatarUrl(user.id, user.avatar, user.discriminator);
  const { isMuted, isDeafened } = userSettings;
  const displayName = userSettings.localDisplayName || user.global_name || user.username;
  const gateway = gatewayStatusInfo(gatewayStatus);

  const statusLine = gateway
    ? gateway.label
    : isDeafened ? 'Deafened' : isMuted ? 'Muted' : 'Online';

  return (
    <div className="h-[52px] bg-discord-darker/60 px-2 flex items-center gap-1 flex-shrink-0">
      <button onClick={() => openSettings('my-account')}
        className="flex items-center gap-2 flex-1 min-w-0 rounded px-1 py-1 hover:bg-discord-hover transition-colors">
        <div className="relative flex-shrink-0">
          <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full"
            onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-[14px] h-[14px] rounded-full border-[3px] border-[#232428] ${
              gatewayStatus === 'fatal' ? 'bg-discord-red'
              : gateway && gateway.spinner ? 'bg-discord-yellow'
              : gatewayStatus === 'closed' ? 'bg-discord-text-muted'
              : isDeafened || isMuted ? 'bg-discord-text-muted'
              : 'bg-discord-green'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white truncate leading-[18px]">{displayName}</p>
          <p
            className={`text-[11px] truncate leading-[13px] flex items-center gap-1 ${gateway ? gateway.tone : 'text-discord-text-muted'}`}
            title={gateway?.spinner ? undefined : (gatewayDetail || statusLine)}
          >
            {gateway?.spinner && <Loader2 size={10} className="animate-spin flex-shrink-0" />}
            {gateway && !gateway.spinner && gatewayStatus === 'fatal' && <WifiOff size={10} className="flex-shrink-0" />}
            <span className="truncate">{statusLine}</span>
          </p>
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
