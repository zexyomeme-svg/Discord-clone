import { useEffect, useRef, useState } from 'react';
import { X, User, Shield, Palette, Bell, Keyboard, Accessibility, MonitorSpeaker, Globe, Zap, Link2, AppWindow, LogOut, ChevronRight, Copy, Check, Info, ExternalLink } from 'lucide-react';
import useStore from '../store/useStore';
import { getUserAvatarUrl } from '../services/discordApi';
import type { SettingsPage, UserSettings } from '../store/types';
import GithubMark from './GithubMark';

interface NavItem {
  id: SettingsPage;
  label: string;
  icon: React.ElementType;
}

const USER_SETTINGS: NavItem[] = [
  { id: 'my-account', label: 'My Account', icon: User },
  { id: 'profiles', label: 'Profiles', icon: User },
  { id: 'privacy', label: 'Privacy & Safety', icon: Shield },
  { id: 'authorized-apps', label: 'Authorized Apps', icon: AppWindow },
  { id: 'connections', label: 'Connections', icon: Link2 },
];

const APP_SETTINGS: NavItem[] = [
  { id: 'about', label: 'About Disclone', icon: Info },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility },
  { id: 'voice', label: 'Voice & Video', icon: MonitorSpeaker },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'keybinds', label: 'Keybinds', icon: Keyboard },
  { id: 'language', label: 'Language', icon: Globe },
  { id: 'streamer', label: 'Streamer Mode', icon: Zap },
  { id: 'advanced', label: 'Advanced', icon: Zap },
];

function SidebarNav({ items, section, current, onSelect }: { items: NavItem[]; section: string; current: SettingsPage; onSelect: (p: SettingsPage) => void }) {
  return (
    <div className="mb-3">
      <h3 className="px-3 py-1.5 text-label-small text-on-surface-variant uppercase tracking-[0.05em]">{section}</h3>
      <div className="space-y-0.5">
        {items.map(item => {
          const Icon = item.icon;
          const active = current === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={active ? 'page' : undefined}
              data-ripple
              className={`m3-interactive flex items-center gap-3 w-full h-10 px-3 rounded-m3-xl
                text-left transition-colors duration-200 ease-standard
                ${active
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="truncate text-label-large">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


/**
 * Material 3 switch: a 52x32 track with a 2px outline when off, a thumb that
 * grows from 16px to 24px as it crosses, and a check inside the on-state thumb.
 * The border is always present (transparent-matched when on) so the geometry
 * does not shift between states.
 */
function SettingsToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      data-ripple
      className={`m3-interactive relative w-[52px] h-8 rounded-full flex-shrink-0 border-2
        transition-colors duration-200 ease-emphasized
        ${enabled ? 'bg-primary border-primary' : 'bg-surface-container-highest border-outline'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center
          transition-all duration-200 ease-emphasized
          ${enabled ? 'left-[20px] w-6 h-6 bg-on-primary' : 'left-[4px] w-4 h-4 bg-outline'}`}
      >
        {enabled && <Check size={15} className="text-primary" strokeWidth={3} />}
      </span>
    </button>
  );
}

function SettingsRow({ label, desc, enabled, onToggle }: { label: string; desc?: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <div><p className="text-sm font-medium text-discord-text">{label}</p>{desc && <p className="text-xs text-discord-text-muted mt-0.5">{desc}</p>}</div>
      <SettingsToggle enabled={enabled} onToggle={onToggle} />
    </div>
  );
}

function copyToClipboard(value: string, setError: (error: string | null) => void) {
  navigator.clipboard?.writeText(value);
  setError('Copied to clipboard.');
}

// ---- Content Pages ----

function MyAccountPage() {
  const { user } = useStore();
  if (!user) return null;
  const avatarUrl = getUserAvatarUrl(user.id, user.avatar, user.discriminator);

  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">My Account</h2>
      <div className="bg-discord-dark rounded-lg overflow-hidden">
        <div className="h-[100px] relative" style={{ backgroundColor: user.accent_color ? `#${user.accent_color.toString(16).padStart(6, '0')}` : '#5865f2' }}>
          <div className="absolute -bottom-[40px] left-4">
            <img src={avatarUrl} alt="" className="w-[80px] h-[80px] rounded-full border-[6px] border-discord-dark"
              onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
          </div>
        </div>
        <div className="pt-[50px] px-4 pb-4">
          <h3 className="text-xl font-bold text-white">{user.global_name || user.username}</h3>
          <p className="text-sm text-discord-text-muted">{user.username}{user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : ''}</p>
        </div>
      </div>

      <div className="bg-discord-dark rounded-lg p-4 mt-4 space-y-5">
        {[
          { label: 'DISPLAY NAME', value: user.global_name || user.username },
          { label: 'USERNAME', value: user.username },
          { label: 'EMAIL', value: user.email || '••••••••@••••.com' },
          { label: 'PHONE NUMBER', value: 'Not set' },
        ].map(field => (
          <div key={field.label}>
            <p className="text-xs text-discord-text-muted uppercase font-bold tracking-wide">{field.label}</p>
            <p className="text-sm text-discord-text mt-0.5">{field.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <h3 className="text-xs text-discord-text-muted uppercase font-bold tracking-wide mb-3">Password and Authentication</h3>
        <div className="p-3 bg-discord-dark rounded-lg space-y-2">
          <p className="text-sm text-discord-text-muted">
            {user.mfa_enabled ? '✅ Two-Factor Authentication is enabled.' : '⚠️ Two-Factor Authentication is not enabled.'}
          </p>
          <p className="text-xs text-discord-text-muted">Password, 2FA, email, phone, and account-removal controls are intentionally not shown here because Discord does not allow bot/OAuth2 API sessions to mutate those account-security settings.</p>
        </div>
      </div>
    </div>
  );
}

function ProfilesPage() {
  const { user, userSettings, updateSettings } = useStore();
  const [displayName, setDisplayName] = useState(userSettings.localDisplayName || user?.global_name || user?.username || '');
  const [bannerColor, setBannerColor] = useState(userSettings.localBannerColor || (user?.accent_color ? `#${user.accent_color.toString(16).padStart(6, '0')}` : '#5865f2'));
  const [bio, setBio] = useState(userSettings.localBio || user?.bio || '');
  if (!user) return null;
  const avatarUrl = getUserAvatarUrl(user.id, user.avatar, user.discriminator);

  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Profiles</h2>
      <div className="flex gap-6">
        <div className="flex-1">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Display Name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark focus:border-discord-blurple outline-none transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Avatar</label>
              <div className="flex items-center gap-4">
                <img src={avatarUrl} alt="" className="w-20 h-20 rounded-full"
                  onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
                <p className="text-xs text-discord-text-muted leading-relaxed">Discord avatar changes are account-security/profile mutations and must be done in Discord. This page saves local display preview fields.</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Banner Color</label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg" style={{ backgroundColor: bannerColor }} />
                <input type="text" value={bannerColor} onChange={(e) => setBannerColor(e.target.value)}
                  className="bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark focus:border-discord-blurple outline-none w-28" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">About Me</label>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell the world about yourself"
                className="w-full bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark focus:border-discord-blurple outline-none resize-none h-24" />
              <p className="text-xs text-discord-text-muted mt-1">You can use markdown and links.</p>
            </div>
            <button onClick={() => updateSettings({ localDisplayName: displayName.trim(), localBannerColor: bannerColor, localBio: bio })} className="px-4 py-2 bg-discord-blurple hover:bg-discord-blurple-hover text-white text-sm rounded transition-colors">Save Local Preview</button>
          </div>
        </div>

        {/* Preview Card */}
        <div className="w-[280px] flex-shrink-0">
          <p className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Preview</p>
          <div className="bg-discord-popout rounded-lg overflow-hidden border border-discord-border">
            <div className="h-[60px]" style={{ backgroundColor: bannerColor }} />
            <div className="px-3 pb-3 -mt-[32px]">
              <img src={avatarUrl} alt="" className="w-[64px] h-[64px] rounded-full border-[5px] border-discord-popout mb-1"
                onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
              <h4 className="text-lg font-bold text-white leading-tight">{displayName || user.username}</h4>
              <p className="text-sm text-discord-text-muted">{user.username}</p>
              {bio && (
                <div className="mt-2 pt-2 border-t border-discord-border">
                  <p className="text-xs font-bold text-discord-text-muted uppercase mb-1">About Me</p>
                  <p className="text-sm text-discord-text">{bio}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppearancePage() {
  const { userSettings, updateSettings } = useStore();

  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Appearance</h2>

      {/* Theme */}
      <div className="mb-8">
        <h3 className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-3">Theme</h3>
        <div className="flex gap-3">
          {(['dark', 'light'] as const).map(t => (
            <button key={t} onClick={() => updateSettings({ theme: t })}
              className={`flex-1 rounded-lg p-4 border-2 transition-colors ${
                userSettings.theme === t ? 'border-discord-blurple bg-discord-blurple/10' : 'border-discord-border hover:border-discord-text-muted/50 bg-discord-dark'
              }`}>
              <div className={`w-full h-16 rounded-md mb-2 ${t === 'dark' ? 'bg-discord-channel' : 'bg-gray-200'}`}>
                <div className={`h-3 rounded m-2 ${t === 'dark' ? 'bg-discord-sidebar' : 'bg-gray-300'}`} style={{ width: '60%' }} />
                <div className={`h-2 rounded mx-2 ${t === 'dark' ? 'bg-discord-hover' : 'bg-gray-300'}`} style={{ width: '80%' }} />
                <div className={`h-2 rounded mx-2 mt-1 ${t === 'dark' ? 'bg-discord-hover' : 'bg-gray-300'}`} style={{ width: '40%' }} />
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  userSettings.theme === t ? 'border-discord-blurple' : 'border-discord-text-muted'
                }`}>
                  {userSettings.theme === t && <div className="w-2.5 h-2.5 rounded-full bg-discord-blurple" />}
                </div>
                <span className="text-sm font-medium text-discord-text capitalize">{t}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Message Display */}
      <div className="mb-8">
        <h3 className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-3">Message Display</h3>
        <div className="flex gap-3">
          {[false, true].map(compact => (
            <button key={String(compact)} onClick={() => updateSettings({ compactMode: compact })}
              className={`flex-1 rounded-lg p-4 border-2 transition-colors ${
                userSettings.compactMode === compact ? 'border-discord-blurple bg-discord-blurple/10' : 'border-discord-border hover:border-discord-text-muted/50 bg-discord-dark'
              }`}>
              <div className="space-y-2 mb-3">
                {compact ? (
                  <>
                    <div className="flex items-center gap-2"><div className="text-[10px] text-discord-text-muted">12:00</div><div className="h-2 bg-discord-hover rounded w-full" /></div>
                    <div className="flex items-center gap-2"><div className="text-[10px] text-discord-text-muted">12:01</div><div className="h-2 bg-discord-hover rounded w-3/4" /></div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-2"><div className="w-6 h-6 rounded-full bg-discord-blurple/40 flex-shrink-0" /><div className="space-y-1 flex-1"><div className="h-2.5 bg-discord-hover rounded w-1/3" /><div className="h-2 bg-discord-hover rounded w-full" /></div></div>
                    <div className="flex items-start gap-2"><div className="w-6 h-6 rounded-full bg-discord-green/40 flex-shrink-0" /><div className="space-y-1 flex-1"><div className="h-2.5 bg-discord-hover rounded w-1/4" /><div className="h-2 bg-discord-hover rounded w-3/4" /></div></div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  userSettings.compactMode === compact ? 'border-discord-blurple' : 'border-discord-text-muted'
                }`}>
                  {userSettings.compactMode === compact && <div className="w-2.5 h-2.5 rounded-full bg-discord-blurple" />}
                </div>
                <span className="text-sm font-medium text-discord-text">{compact ? 'Compact' : 'Cozy'}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Font Size */}
      <div className="mb-8">
        <h3 className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-3">
          Chat Font Scaling — {userSettings.fontSize}px
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-discord-text-muted font-bold">12px</span>
          <input type="range" min={12} max={24} step={1} value={userSettings.fontSize}
            onChange={e => updateSettings({ fontSize: parseInt(e.target.value) })}
            className="flex-1 accent-discord-blurple h-1.5 bg-discord-dark rounded-full cursor-pointer" />
          <span className="text-xs text-discord-text-muted font-bold">24px</span>
        </div>
        <div className="mt-3 p-3 bg-discord-dark rounded-lg" style={{ fontSize: `${userSettings.fontSize}px` }}>
          <p className="text-discord-text">This is a preview of your chat font size.</p>
        </div>
      </div>

      {/* Space Between Groups */}
      <div className="mb-8">
        <h3 className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-3">
          Space Between Message Groups — {userSettings.messageGroupSpacing}px
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-discord-text-muted font-bold">0px</span>
          <input type="range" min={0} max={24} step={4} value={userSettings.messageGroupSpacing}
            onChange={e => updateSettings({ messageGroupSpacing: parseInt(e.target.value) })}
            className="flex-1 accent-discord-blurple h-1.5 bg-discord-dark rounded-full cursor-pointer" />
          <span className="text-xs text-discord-text-muted font-bold">24px</span>
        </div>
      </div>

      {/* Saturation */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-discord-text-muted uppercase tracking-wide">Saturation</h3>
          <span className="text-xs text-discord-text-muted">{userSettings.saturation}%</span>
        </div>
        <input type="range" min={0} max={200} step={10} value={userSettings.saturation}
          onChange={e => updateSettings({ saturation: parseInt(e.target.value) })}
          className="w-full accent-discord-blurple h-1.5 bg-discord-dark rounded-full cursor-pointer" />
      </div>

      {/* Show role colors toggle */}
      <div className="flex items-center justify-between py-3">
        <div>
          <p className="text-sm font-medium text-discord-text">Show Role Colors in Names</p>
          <p className="text-xs text-discord-text-muted mt-0.5">Show the highest role color as the name color in chat.</p>
        </div>
        <button onClick={() => updateSettings({ showRoleColors: !userSettings.showRoleColors })}
          className={`w-10 h-6 rounded-full transition-colors relative ${
            userSettings.showRoleColors ? 'bg-discord-green' : 'bg-discord-input'
          }`}>
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            userSettings.showRoleColors ? 'translate-x-5' : 'translate-x-1'
          }`} />
        </button>
      </div>
    </div>
  );
}

function AccessibilityPage() {
  const { userSettings, updateSettings } = useStore();
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Accessibility</h2>
      <div className="space-y-6">
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium text-discord-text">Compact Mode</p>
            <p className="text-xs text-discord-text-muted mt-0.5">Make messages take up less vertical space.</p>
          </div>
          <button onClick={() => updateSettings({ compactMode: !userSettings.compactMode })}
            className={`w-10 h-6 rounded-full transition-colors relative ${userSettings.compactMode ? 'bg-discord-green' : 'bg-discord-input'}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${userSettings.compactMode ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium text-discord-text">Role Colors</p>
            <p className="text-xs text-discord-text-muted mt-0.5">Show colored names based on role.</p>
          </div>
          <button onClick={() => updateSettings({ showRoleColors: !userSettings.showRoleColors })}
            className={`w-10 h-6 rounded-full transition-colors relative ${userSettings.showRoleColors ? 'bg-discord-green' : 'bg-discord-input'}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${userSettings.showRoleColors ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
        <div>
          <h3 className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-3">
            Chat Font Size — {userSettings.fontSize}px
          </h3>
          <input type="range" min={12} max={24} step={1} value={userSettings.fontSize}
            onChange={e => updateSettings({ fontSize: parseInt(e.target.value) })}
            className="w-full accent-discord-blurple h-1.5 bg-discord-dark rounded-full cursor-pointer" />
        </div>
        <div>
          <h3 className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-3">
            Saturation — {userSettings.saturation}%
          </h3>
          <input type="range" min={0} max={200} step={10} value={userSettings.saturation}
            onChange={e => updateSettings({ saturation: parseInt(e.target.value) })}
            className="w-full accent-discord-blurple h-1.5 bg-discord-dark rounded-full cursor-pointer" />
        </div>
      </div>
    </div>
  );
}

function GenericPage({ title, desc, children }: { title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-3">{title}</h2>
      <p className="text-sm text-discord-text-muted">{desc}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function PrivacyPage() {
  const { userSettings, updateSettings } = useStore();
  return (
    <GenericPage title="Privacy & Safety" desc="Control local privacy-related display preferences.">
      <div className="bg-discord-dark rounded-lg p-4 space-y-1">
        <SettingsRow label="Streamer Mode" desc="Hide sensitive profile details in local UI." enabled={userSettings.streamerMode} onToggle={() => updateSettings({ streamerMode: !userSettings.streamerMode })} />
        <SettingsRow label="Developer Mode" desc="Show IDs and technical information where available." enabled={userSettings.developerMode} onToggle={() => updateSettings({ developerMode: !userSettings.developerMode })} />
      </div>
    </GenericPage>
  );
}

function AuthorizedAppsPage() {
  const { authMode } = useStore();
  return (
    <GenericPage title="Authorized Apps" desc="Review the current connection mode.">
      <div className="bg-discord-dark rounded-lg p-4">
        <p className="text-sm text-discord-text">Current auth mode: <strong>{authMode === 'oauth' ? 'Discord OAuth2' : 'Bot Token'}</strong></p>
        <p className="text-xs text-discord-text-muted mt-2">Manage Discord-authorized apps in Discord User Settings. Bot-token sessions can be ended with Log Out.</p>
      </div>
    </GenericPage>
  );
}

function ConnectionsPage() {
  return (
    <GenericPage title="Connections" desc="Connect this deployment to Discord through bot tokens or OAuth2.">
      <div className="bg-discord-dark rounded-lg p-4 space-y-2 text-sm text-discord-text-muted">
        <p>Bot token mode powers server channels, messages, uploads, and reactions.</p>
        <p>OAuth2 mode powers safe user sign-in and guild listing.</p>
      </div>
    </GenericPage>
  );
}

function LanguagePage() {
  const { userSettings, updateSettings } = useStore();
  const languages: Array<{ value: UserSettings['language']; label: string }> = [
    { value: 'en-US', label: 'English, US' },
    { value: 'en-GB', label: 'English, UK' },
    { value: 'es-ES', label: 'Español' },
    { value: 'fr-FR', label: 'Français' },
    { value: 'de-DE', label: 'Deutsch' },
    { value: 'pt-BR', label: 'Português do Brasil' },
  ];
  return (
    <GenericPage title="Language" desc="Select the local UI language preference.">
      <select value={userSettings.language} onChange={(e) => updateSettings({ language: e.target.value as UserSettings['language'] })} className="w-full bg-discord-dark text-discord-text rounded px-3 py-2 outline-none">
        {languages.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
      <p className="text-xs text-discord-text-muted mt-3">Full text translation is not bundled; this preference is saved for integrations and future UI text.</p>
    </GenericPage>
  );
}

function StreamerPage() {
  const { userSettings, updateSettings } = useStore();
  return (
    <GenericPage title="Streamer Mode" desc="Hide sensitive information while streaming.">
      <div className="bg-discord-dark rounded-lg p-4">
        <SettingsRow label="Enable Streamer Mode" desc="Masks sensitive profile fields locally." enabled={userSettings.streamerMode} onToggle={() => updateSettings({ streamerMode: !userSettings.streamerMode })} />
      </div>
    </GenericPage>
  );
}

function NotificationsPage() {
  const { userSettings, updateSettings, requestNotificationPermission } = useStore();
  // Delegated to the store so the permission result and the stored preference
  // can never disagree, and so a denied/blocked state is reported to the user.
  const requestNotifications = () => void requestNotificationPermission();
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Notifications</h2>
      <div className="space-y-2">
        <SettingsRow label="Enable Desktop Notifications" desc="Ask the browser for permission and save the preference." enabled={userSettings.desktopNotifications} onToggle={() => userSettings.desktopNotifications ? updateSettings({ desktopNotifications: false }) : requestNotifications()} />
        <SettingsRow label="Enable Unread Message Badge" desc="Show unread state in the app UI." enabled={userSettings.unreadBadge} onToggle={() => updateSettings({ unreadBadge: !userSettings.unreadBadge })} />
        <SettingsRow label="Enable Message Sound" desc="Play a short sound when sending/receiving messages where supported." enabled={userSettings.messageSound} onToggle={() => updateSettings({ messageSound: !userSettings.messageSound })} />
        <SettingsRow label="Notification Sounds" desc="Play sound effects for app events." enabled={userSettings.notificationSounds} onToggle={() => updateSettings({ notificationSounds: !userSettings.notificationSounds })} />
      </div>
    </div>
  );
}

function VoicePage() {
  const { userSettings, updateSettings, setError } = useStore();
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);

  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError('This browser does not support media device selection.');
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter((d) => d.kind === 'audioinput'));
      setOutputs(devices.filter((d) => d.kind === 'audiooutput'));
    } catch (err: any) {
      setError(err.message || 'Could not load media devices.');
    }
  };

  const requestDeviceAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      await refreshDevices();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await refreshDevices();
      setError('Voice device list refreshed.');
    } catch (err: any) {
      setError(err.message || 'Microphone permission was not granted.');
      await refreshDevices();
    }
  };

  useEffect(() => { refreshDevices(); }, []);

  const inputOptions = inputs.length ? inputs : [];
  const outputOptions = outputs.length ? outputs : [];

  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Voice & Video</h2>
      <div className="mb-4 p-3 bg-discord-dark rounded-lg text-sm text-discord-text-muted">
        These controls save the browser devices used by this web UI. Click refresh/allow microphone access if your device names are hidden.
      </div>
      <button onClick={requestDeviceAccess} className="mb-6 px-4 py-2 bg-discord-blurple hover:bg-discord-blurple-hover text-white text-sm rounded transition-colors font-medium">
        Refresh Voice Devices
      </button>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Input Device</label>
          <select value={userSettings.inputDevice} onChange={(e) => updateSettings({ inputDevice: e.target.value })} className="w-full bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark outline-none">
            <option value="default">Default</option>
            {inputOptions.map((d, index) => <option key={d.deviceId || index} value={d.deviceId}>{d.label || `Microphone ${index + 1}`}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Output Device</label>
          <select value={userSettings.outputDevice} onChange={(e) => updateSettings({ outputDevice: e.target.value })} className="w-full bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark outline-none">
            <option value="default">Default</option>
            {outputOptions.map((d, index) => <option key={d.deviceId || index} value={d.deviceId}>{d.label || `Speaker ${index + 1}`}</option>)}
          </select>
        </div>
      </div>
      <SettingsRow label="Mute" desc="Sets the local mute status shown in the user panel." enabled={userSettings.isMuted} onToggle={() => updateSettings({ isMuted: !userSettings.isMuted })} />
      <SettingsRow label="Deafen" desc="Sets the local deafen status shown in the user panel." enabled={userSettings.isDeafened} onToggle={() => updateSettings({ isDeafened: !userSettings.isDeafened })} />
    </div>
  );
}

function KeybindsPage() {
  const { updateSettings, userSettings, closeSettings } = useStore();
  const binds = [
    { action: 'Toggle Mute', keys: 'Ctrl + Shift + M', run: () => updateSettings({ isMuted: !userSettings.isMuted }) },
    { action: 'Toggle Deafen', keys: 'Ctrl + Shift + D', run: () => updateSettings({ isDeafened: !userSettings.isDeafened }) },
    { action: 'Open Search', keys: 'Ctrl + K', run: () => (document.querySelector('[data-app-search="true"]') as HTMLInputElement | null)?.focus() },
    { action: 'Close Settings', keys: 'Escape', run: () => closeSettings() },
    { action: 'Upload File', keys: 'Ctrl + Shift + U', run: () => (document.querySelector('[data-upload-trigger="true"]') as HTMLButtonElement | null)?.click() },
  ];
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Keybinds</h2>
      <div className="space-y-2">
        {binds.map(b => (
          <button key={b.action} onClick={b.run} className="w-full flex items-center justify-between p-3 bg-discord-dark rounded-lg hover:bg-discord-hover transition-colors text-left">
            <span className="text-sm text-discord-text">{b.action}</span>
            <div className="flex items-center gap-1">
              {b.keys.split(' + ').map((k, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-discord-text-muted mx-1">+</span>}
                  <kbd className="px-2 py-1 bg-discord-sidebar rounded text-xs text-discord-text border border-discord-border font-mono">{k}</kbd>
                </span>
              ))}
              <ChevronRight size={14} className="ml-3 text-discord-text-muted" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdvancedPage() {
  const { user, userSettings, updateSettings, setError } = useStore();
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Advanced</h2>
      <div className="space-y-4">
        <div className="p-4 bg-discord-dark rounded-lg">
          <div className="flex items-center justify-between">
            <div><p className="text-xs text-discord-text-muted uppercase font-bold mb-1">User ID</p><p className="text-sm text-discord-text font-mono select-all">{user?.id || 'N/A'}</p></div>
            <button onClick={() => copyToClipboard(user?.id || '', setError)} className="text-discord-text-muted hover:text-white"><Copy size={16} /></button>
          </div>
        </div>
        <div className="p-4 bg-discord-dark rounded-lg">
          <SettingsRow label="Developer Mode" desc="Enable local developer-focused display options." enabled={userSettings.developerMode} onToggle={() => updateSettings({ developerMode: !userSettings.developerMode })} />
          <SettingsRow label="Reduced Motion" desc="Reduce animation intensity in the local UI." enabled={userSettings.reducedMotion} onToggle={() => updateSettings({ reducedMotion: !userSettings.reducedMotion })} />
          <SettingsRow label="High Contrast" desc="Increase contrast for selected UI elements." enabled={userSettings.highContrast} onToggle={() => updateSettings({ highContrast: !userSettings.highContrast })} />
        </div>
        <div className="p-4 bg-discord-dark rounded-lg space-y-2">
          <p className="text-xs text-discord-text-muted uppercase font-bold">Client Version</p>
          <p className="text-sm text-discord-text font-mono">Disclone v1.0.0</p>
          <p className="text-xs text-discord-text-muted uppercase font-bold pt-2">API Endpoint</p>
          <p className="text-sm text-discord-text font-mono select-all">https://discord.com/api/v10</p>
          <p className="text-xs text-discord-text-muted uppercase font-bold pt-2">Gateway</p>
          <p className="text-sm text-discord-text font-mono select-all">wss://gateway.discord.gg</p>
        </div>
      </div>
    </div>
  );
}

// ---- Page Router ----
/**
 * Attribution page: where this build came from, where it is deployed, and what
 * the bot tells Discord users about both.
 *
 * The presence preview is shown because Discord imposes a real constraint worth
 * surfacing rather than hiding: a bot may only set an activity's name, state and
 * type, its `url` field is validated against twitch.tv/youtube.com, and
 * rich-presence buttons are ignored for bots. So the status can *name* the
 * repository but can never make it clickable — the clickable links are here.
 */
function AboutPage() {
  const { appInfo, userSettings, updateSettings, setError, gatewayStatus } = useStore();

  const preview = userSettings.presenceText.trim() || appInfo?.presenceText || '';
  const overLimit = preview.length > 96;
  const live = gatewayStatus === 'ready';

  const link = (href: string | null, label: string, sub: string | null, icon: React.ReactNode) => {
    if (!href) return null;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-ripple
        className="m3-interactive flex items-center gap-3 p-3.5 rounded-m3-md bg-surface-container-high
          text-on-surface ring-1 ring-outline-variant
          transition-shadow duration-200 ease-standard hover:shadow-md"
      >
        <span className="w-10 h-10 rounded-m3-sm bg-secondary-container text-on-secondary-container
          flex items-center justify-center flex-shrink-0">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-label-large truncate">{label}</span>
          {sub && <span className="block text-label-small text-on-surface-variant truncate">{sub}</span>}
        </span>
        <ExternalLink size={16} className="text-on-surface-variant flex-shrink-0" aria-hidden="true" />
      </a>
    );
  };

  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-headline-small font-medium text-on-surface mb-1.5">
        About {appInfo?.name || 'Disclone'}
      </h2>
      <p className="text-body-medium text-on-surface-variant mb-6">
        Open-source Discord client. Version {appInfo?.version || '—'}.
      </p>

      <div className="space-y-2.5 mb-6">
        {link(appInfo?.githubUrl ?? null, 'Source code on GitHub', appInfo?.githubDisplay ?? null, <GithubMark />)}
        {link(appInfo?.siteUrl ?? null, 'Live deployment', appInfo?.siteDisplay ?? null, <Globe size={20} />)}
        {!appInfo?.githubUrl && !appInfo?.siteUrl && (
          <p className="text-body-small text-on-surface-variant p-3.5 rounded-m3-md bg-surface-container-high">
            Attribution is not configured on this deployment. Set <code className="px-1 rounded-m3-xs bg-surface-container-lowest">APP_GITHUB_URL</code> and{' '}
            <code className="px-1 rounded-m3-xs bg-surface-container-lowest">APP_SITE_URL</code>.
          </p>
        )}
      </div>

      <div className="p-4 rounded-m3-lg bg-surface-container-high ring-1 ring-outline-variant">
        <h3 className="text-title-small text-on-surface mb-1">Bot presence</h3>
        <p className="text-body-small text-on-surface-variant mb-3 leading-relaxed">
          Advertise this project to people who meet the bot inside Discord and never open this client.
        </p>

        <SettingsRow
          label="Show attribution in the bot's status"
          desc="Sets a Discord custom status while the realtime connection is live."
          enabled={userSettings.broadcastPresence}
          onToggle={() => updateSettings({ broadcastPresence: !userSettings.broadcastPresence })}
        />

        {userSettings.broadcastPresence && (
          <div className="mt-4 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="presence-text" className="text-label-small text-on-surface-variant">
                  Status text
                </label>
                <span className={`text-label-small tabular-nums ${overLimit ? 'text-error' : 'text-on-surface-variant/70'}`}>
                  {preview.length}/96
                </span>
              </div>
              <input
                id="presence-text"
                value={userSettings.presenceText}
                onChange={(e) => updateSettings({ presenceText: e.target.value })}
                placeholder={appInfo?.presenceText || 'Disclone · github.com/…'}
                disabled={!appInfo?.presenceEditable}
                className="w-full bg-surface-container-lowest text-on-surface text-body-medium rounded-m3-sm
                  px-3 py-2.5 outline-none placeholder:text-on-surface-variant/60 disabled:opacity-50
                  focus:outline focus:outline-2 focus:outline-primary transition-[outline-color] duration-200"
              />
              <p className="mt-1.5 text-label-small text-on-surface-variant">
                {appInfo?.presenceEditable
                  ? 'Leave blank to use the deployment default.'
                  : 'Pinned by the server via APP_PRESENCE_TEXT; set that variable to change it.'}
              </p>
              {overLimit && (
                <p className="mt-1 text-label-small text-error" role="alert">
                  Discord truncates activity text; keep it under 96 characters.
                </p>
              )}
            </div>

            {/* What Discord users actually see. */}
            <div className="p-3 rounded-m3-md bg-surface-container">
              <p className="text-label-small text-on-surface-variant mb-2 uppercase tracking-[0.05em]">
                Preview — as shown in the member list
              </p>
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-success" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-label-large text-on-surface truncate">
                    {(appInfo?.name) || 'Disclone'}
                  </span>
                  <span className={`block text-label-small truncate ${preview ? 'text-on-surface-variant' : 'text-on-surface-variant/60'}`}>
                    {preview || 'No status'}
                  </span>
                </span>
              </div>
            </div>

            {!live && (
              <p className="text-label-small text-warning flex items-start gap-2">
                <Info size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  The realtime connection is not live, so this is not being broadcast yet. It is sent when the
                  gateway connects and re-sent whenever you change it here.
                </span>
              </p>
            )}

            <button
              type="button"
              data-ripple
              onClick={() => {
                if (!preview) { setError('There is no status text to copy.'); return; }
                copyToClipboard(preview, setError);
              }}
              className="m3-interactive flex items-center gap-2 h-9 px-4 rounded-m3-xl
                text-label-large text-primary transition-colors duration-200 ease-standard"
            >
              <Copy size={15} aria-hidden="true" /> Copy status text
            </button>
          </div>
        )}
      </div>

      <p className="mt-5 text-label-small text-on-surface-variant leading-relaxed">
        A bot's Discord status is plain text — Discord only lets bots set an activity's name, state and type, its{' '}
        <code className="px-1 rounded-m3-xs bg-surface-container-high">url</code> field accepts only twitch.tv and
        youtube.com, and rich-presence buttons are ignored for bots. That is why the links above are clickable here
        but the status is not.
      </p>
    </div>
  );
}

function SettingsContent({ page }: { page: SettingsPage }) {
  switch (page) {
    case 'my-account': return <MyAccountPage />;
    case 'profiles': return <ProfilesPage />;
    case 'appearance': return <AppearancePage />;
    case 'accessibility': return <AccessibilityPage />;
    case 'notifications': return <NotificationsPage />;
    case 'voice': return <VoicePage />;
    case 'keybinds': return <KeybindsPage />;
    case 'advanced': return <AdvancedPage />;
    case 'privacy': return <PrivacyPage />;
    case 'authorized-apps': return <AuthorizedAppsPage />;
    case 'connections': return <ConnectionsPage />;
    case 'language': return <LanguagePage />;
    case 'streamer': return <StreamerPage />;
    case 'about': return <AboutPage />;
    default: return <GenericPage title="Settings" desc="Select an option from the sidebar." />;
  }
}

// ---- Main Component ----
export default function SettingsModal() {
  const { settingsOpen, closeSettings, settingsPage, setSettingsPage, logout } = useStore();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSettings(); };
    if (settingsOpen) { window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }
  }, [settingsOpen, closeSettings]);

  // Scroll content to top on page change
  useEffect(() => { contentRef.current?.scrollTo(0, 0); }, [settingsPage]);

  if (!settingsOpen) return null;

  // logout() is async: in OAuth mode it asks the backend to revoke the Discord
  // access token before clearing local state.
  const handleLogout = () => { closeSettings(); void logout(); };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col md:flex-row animate-settings-open bg-discord-channel">
      {/* Sidebar — right-aligned content */}
      <div className="w-full md:w-auto md:flex-[1_0_218px] flex md:justify-end bg-surface-container max-h-[38vh] md:max-h-none flex-shrink-0 md:elev-1">
        <div className="w-full md:w-[218px] overflow-y-auto channel-scroll py-3 md:py-[60px] px-2">
          <SidebarNav items={USER_SETTINGS} section="User Settings" current={settingsPage} onSelect={setSettingsPage} />
          <div className="h-px bg-outline-variant mx-3 my-2" />
          <SidebarNav items={APP_SETTINGS} section="App Settings" current={settingsPage} onSelect={setSettingsPage} />
          <div className="h-px bg-outline-variant mx-3 my-2" />
          <button
            type="button"
            onClick={handleLogout}
            data-ripple
            className="m3-interactive flex items-center justify-between gap-2 w-full h-10 px-3 rounded-m3-xl
              text-label-large text-error transition-colors duration-200 ease-standard"
          >
            Log out <LogOut size={17} aria-hidden="true" />
          </button>
          <div className="h-px bg-outline-variant mx-3 my-2" />
          <p className="px-3 text-label-small text-on-surface-variant">Disclone v1.3.0</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 md:flex-[1_1_800px] md:max-w-[740px] min-h-0">
        <div ref={contentRef} className="h-full overflow-y-auto py-5 md:py-[60px] px-4 md:px-10 pb-24">
          <SettingsContent page={settingsPage} />
        </div>
      </div>

      {/* Close button */}
      <div className="absolute top-3 right-3 md:static md:flex-[0_1_36px] flex flex-col items-center md:pt-[60px]">
        <button onClick={closeSettings}
          className="w-9 h-9 rounded-full border-2 border-discord-text-muted/40 flex items-center justify-center text-discord-text-muted hover:border-white hover:text-white transition-colors">
          <X size={18} />
        </button>
        <span className="text-[11px] text-discord-text-muted font-bold mt-1">ESC</span>
      </div>

      {/* Remaining space */}
      <div className="hidden md:block flex-[1_0_0px]" />
    </div>
  );
}
