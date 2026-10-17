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
      return { label: 'Connecting…', tone: 'text-warning', spinner: true };
    case 'fatal':
      return { label: 'Realtime unavailable', tone: 'text-error', spinner: false };
    case 'closed':
      return { label: 'Disconnected', tone: 'text-on-surface-variant', spinner: false };
    default:
      return null;
  }
}

/** M3 icon button: 40px target, state layer, ripple. */
function IconButton({
  label,
  pressed,
  activeTone = 'text-error',
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  activeTone?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-ripple
      className={`m3-interactive w-10 h-10 flex items-center justify-center rounded-full
        transition-colors duration-200 ease-standard
        ${pressed ? activeTone : 'text-on-surface-variant hover:text-on-surface'}`}
    >
      {children}
    </button>
  );
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

  const presenceColour = gatewayStatus === 'fatal' ? 'bg-error'
    : gateway?.spinner ? 'bg-warning'
    : gatewayStatus === 'closed' ? 'bg-on-surface-variant'
    : isDeafened || isMuted ? 'bg-on-surface-variant'
    : 'bg-success';

  return (
    <div className="h-[52px] bg-surface-container-low px-2 flex items-center gap-1 flex-shrink-0">
      <button
        type="button"
        onClick={() => openSettings('my-account')}
        data-ripple
        className="m3-interactive flex items-center gap-2 flex-1 min-w-0 rounded-m3-lg px-1 py-1
          text-left transition-colors duration-200 ease-standard"
        aria-label={`Open settings for ${displayName}`}
      >
        <div className="relative flex-shrink-0">
          <img
            src={avatarUrl}
            alt=""
            className="w-8 h-8 rounded-full bg-surface-container-highest"
            onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
          />
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-[14px] h-[14px] rounded-full
              ring-[3px] ring-surface-container-low ${presenceColour}`}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-label-large text-on-surface truncate leading-[18px]">{displayName}</p>
          <p
            className={`text-label-small truncate leading-[14px] flex items-center gap-1 ${gateway ? gateway.tone : 'text-on-surface-variant'}`}
            title={gateway?.spinner ? undefined : (gatewayDetail || statusLine)}
          >
            {gateway?.spinner && <Loader2 size={10} className="animate-spin flex-shrink-0" aria-hidden="true" />}
            {gateway && !gateway.spinner && gatewayStatus === 'fatal' && <WifiOff size={10} className="flex-shrink-0" aria-hidden="true" />}
            <span className="truncate">{statusLine}</span>
          </p>
        </div>
      </button>

      <div className="flex items-center flex-shrink-0">
        <IconButton
          label={isMuted ? 'Unmute' : 'Mute'}
          pressed={isMuted}
          onClick={() => updateSettings({ isMuted: !isMuted })}
        >
          {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </IconButton>
        <IconButton
          label={isDeafened ? 'Undeafen' : 'Deafen'}
          pressed={isDeafened}
          onClick={() => updateSettings({ isDeafened: !isDeafened })}
        >
          {isDeafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
        </IconButton>
        <IconButton label="User Settings" onClick={() => openSettings('my-account')}>
          <Settings size={18} />
        </IconButton>
      </div>
    </div>
  );
}
