import { useEffect, useRef } from 'react';
import { X, User, Shield, Palette, Bell, Keyboard, Accessibility, MonitorSpeaker, Globe, Zap, Link2, AppWindow, LogOut, ChevronRight } from 'lucide-react';
import useStore from '../store/useStore';
import { getUserAvatarUrl } from '../services/discordApi';
import type { SettingsPage } from '../store/types';

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
    <div className="mb-2">
      <h3 className="px-2.5 py-1.5 text-[11px] font-bold text-discord-text-muted uppercase tracking-[0.02em]">{section}</h3>
      {items.map(item => (
        <button key={item.id} onClick={() => onSelect(item.id)}
          className={`flex items-center gap-2 w-full px-2.5 py-[6px] rounded text-[15px] transition-colors mb-px ${
            current === item.id ? 'bg-discord-active text-white' : 'text-discord-text-muted hover:text-discord-text hover:bg-discord-hover'
          }`}>
          {item.label}
        </button>
      ))}
    </div>
  );
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
          <div key={field.label} className="flex items-center justify-between">
            <div>
              <p className="text-xs text-discord-text-muted uppercase font-bold tracking-wide">{field.label}</p>
              <p className="text-sm text-discord-text mt-0.5">{field.value}</p>
            </div>
            <button className="px-4 py-1.5 bg-discord-input hover:bg-discord-hover text-white text-sm rounded transition-colors font-medium">Edit</button>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <h3 className="text-xs text-discord-text-muted uppercase font-bold tracking-wide mb-3">Password and Authentication</h3>
        <button className="px-4 py-2 bg-discord-blurple hover:bg-discord-blurple-hover text-white text-sm rounded transition-colors font-medium">
          Change Password
        </button>
        <div className="mt-4 p-3 bg-discord-dark rounded-lg">
          <p className="text-sm text-discord-text-muted">
            {user.mfa_enabled ? '✅ Two-Factor Authentication is enabled.' : '⚠️ Two-Factor Authentication is not enabled.'}
          </p>
        </div>
      </div>

      <div className="mt-8 pt-4 border-t border-discord-border">
        <h3 className="text-xs text-discord-red uppercase font-bold tracking-wide mb-2">Account Removal</h3>
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-discord-red text-discord-red hover:bg-discord-red hover:text-white text-sm rounded transition-colors font-medium">
            Disable Account
          </button>
          <button className="px-4 py-2 border border-discord-red text-white bg-discord-red hover:bg-red-700 text-sm rounded transition-colors font-medium">
            Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfilesPage() {
  const { user } = useStore();
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
              <input type="text" defaultValue={user.global_name || user.username}
                className="w-full bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark focus:border-discord-blurple outline-none transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Avatar</label>
              <div className="flex items-center gap-4">
                <img src={avatarUrl} alt="" className="w-20 h-20 rounded-full"
                  onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
                <div className="flex gap-2">
                  <button className="px-4 py-2 bg-discord-blurple hover:bg-discord-blurple-hover text-white text-sm rounded transition-colors">Change Avatar</button>
                  <button className="px-4 py-2 text-white text-sm rounded border border-discord-border hover:bg-discord-hover transition-colors">Remove Avatar</button>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Banner Color</label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg" style={{ backgroundColor: user.accent_color ? `#${user.accent_color.toString(16).padStart(6, '0')}` : '#5865f2' }} />
                <input type="text" defaultValue={user.accent_color ? `#${user.accent_color.toString(16).padStart(6, '0')}` : '#5865f2'}
                  className="bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark focus:border-discord-blurple outline-none w-28" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">About Me</label>
              <textarea defaultValue={user.bio || ''} placeholder="Tell the world about yourself"
                className="w-full bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark focus:border-discord-blurple outline-none resize-none h-24" />
              <p className="text-xs text-discord-text-muted mt-1">You can use markdown and links.</p>
            </div>
          </div>
        </div>

        {/* Preview Card */}
        <div className="w-[280px] flex-shrink-0">
          <p className="text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Preview</p>
          <div className="bg-discord-popout rounded-lg overflow-hidden border border-discord-border">
            <div className="h-[60px]" style={{ backgroundColor: user.accent_color ? `#${user.accent_color.toString(16).padStart(6, '0')}` : '#5865f2' }} />
            <div className="px-3 pb-3 -mt-[32px]">
              <img src={avatarUrl} alt="" className="w-[64px] h-[64px] rounded-full border-[5px] border-discord-popout mb-1"
                onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
              <h4 className="text-lg font-bold text-white leading-tight">{user.global_name || user.username}</h4>
              <p className="text-sm text-discord-text-muted">{user.username}</p>
              {user.bio && (
                <div className="mt-2 pt-2 border-t border-discord-border">
                  <p className="text-xs font-bold text-discord-text-muted uppercase mb-1">About Me</p>
                  <p className="text-sm text-discord-text">{user.bio}</p>
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

function GenericPage({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-3">{title}</h2>
      <p className="text-sm text-discord-text-muted">{desc}</p>
      <div className="mt-6 p-6 bg-discord-dark rounded-lg text-center">
        <p className="text-discord-text-muted text-sm">This section is available when connected to a live Discord session.</p>
      </div>
    </div>
  );
}

function NotificationsPage() {
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Notifications</h2>
      <div className="space-y-4">
        {[
          { label: 'Enable Desktop Notifications', desc: 'Show browser notifications for new messages', default: true },
          { label: 'Enable Unread Message Badge', desc: 'Show a badge on the app icon when you have unread messages', default: true },
          { label: 'Enable Message Sound', desc: 'Play a sound when you receive a message', default: true },
          { label: 'Notification Sounds', desc: 'Play sound effects for various events like joining/leaving calls', default: true },
        ].map(item => (
          <ToggleRow key={item.label} label={item.label} desc={item.desc} defaultVal={item.default} />
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, defaultVal }: { label: string; desc: string; defaultVal: boolean }) {
  const ref = useRef(defaultVal);
  return (
    <div className="flex items-center justify-between py-2">
      <div><p className="text-sm font-medium text-discord-text">{label}</p><p className="text-xs text-discord-text-muted mt-0.5">{desc}</p></div>
      <button onClick={() => { ref.current = !ref.current; }}
        className={`w-10 h-6 rounded-full transition-colors relative ${ref.current ? 'bg-discord-green' : 'bg-discord-input'}`}>
        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${ref.current ? 'translate-x-5' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function VoicePage() {
  const { userSettings, updateSettings } = useStore();
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Voice & Video</h2>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Input Device</label>
          <select className="w-full bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark outline-none">
            <option>Default</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-discord-text-muted uppercase tracking-wide mb-2">Output Device</label>
          <select className="w-full bg-discord-dark text-discord-text text-sm rounded px-3 py-2 border border-discord-dark outline-none">
            <option>Default</option>
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between py-3">
        <div><p className="text-sm font-medium text-discord-text">Mute</p></div>
        <button onClick={() => updateSettings({ isMuted: !userSettings.isMuted })}
          className={`w-10 h-6 rounded-full transition-colors relative ${userSettings.isMuted ? 'bg-discord-green' : 'bg-discord-input'}`}>
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${userSettings.isMuted ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      </div>
      <div className="flex items-center justify-between py-3">
        <div><p className="text-sm font-medium text-discord-text">Deafen</p></div>
        <button onClick={() => updateSettings({ isDeafened: !userSettings.isDeafened })}
          className={`w-10 h-6 rounded-full transition-colors relative ${userSettings.isDeafened ? 'bg-discord-green' : 'bg-discord-input'}`}>
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${userSettings.isDeafened ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      </div>
    </div>
  );
}

function KeybindsPage() {
  const binds = [
    { action: 'Toggle Mute', keys: 'Ctrl + Shift + M' },
    { action: 'Toggle Deafen', keys: 'Ctrl + Shift + D' },
    { action: 'Search', keys: 'Ctrl + K' },
    { action: 'Mark as Read', keys: 'Escape' },
    { action: 'Scroll to Bottom', keys: 'Shift + Escape' },
    { action: 'Upload File', keys: 'Ctrl + Shift + U' },
  ];
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Keybinds</h2>
      <div className="space-y-2">
        {binds.map(b => (
          <div key={b.action} className="flex items-center justify-between p-3 bg-discord-dark rounded-lg hover:bg-discord-hover transition-colors">
            <span className="text-sm text-discord-text">{b.action}</span>
            <div className="flex items-center gap-1">
              {b.keys.split(' + ').map((k, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-discord-text-muted mx-1">+</span>}
                  <kbd className="px-2 py-1 bg-discord-sidebar rounded text-xs text-discord-text border border-discord-border font-mono">{k}</kbd>
                </span>
              ))}
              <button className="ml-3 text-discord-text-muted hover:text-white transition-colors"><ChevronRight size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      <button className="mt-4 px-4 py-2 bg-discord-blurple hover:bg-discord-blurple-hover text-white text-sm rounded transition-colors">
        Add a Keybind
      </button>
    </div>
  );
}

function AdvancedPage() {
  const { user } = useStore();
  return (
    <div className="animate-fade-in-fast">
      <h2 className="text-xl font-bold text-white mb-5">Advanced</h2>
      <div className="space-y-4">
        <div className="p-4 bg-discord-dark rounded-lg">
          <p className="text-xs text-discord-text-muted uppercase font-bold mb-1">User ID</p>
          <p className="text-sm text-discord-text font-mono select-all">{user?.id || 'N/A'}</p>
        </div>
        <div className="p-4 bg-discord-dark rounded-lg">
          <p className="text-xs text-discord-text-muted uppercase font-bold mb-1">Client Version</p>
          <p className="text-sm text-discord-text font-mono">Disclone v1.0.0</p>
        </div>
        <div className="p-4 bg-discord-dark rounded-lg">
          <p className="text-xs text-discord-text-muted uppercase font-bold mb-1">API Endpoint</p>
          <p className="text-sm text-discord-text font-mono select-all">https://discord.com/api/v10</p>
        </div>
        <div className="p-4 bg-discord-dark rounded-lg">
          <p className="text-xs text-discord-text-muted uppercase font-bold mb-1">Gateway</p>
          <p className="text-sm text-discord-text font-mono select-all">wss://gateway.discord.gg</p>
        </div>
      </div>
    </div>
  );
}

// ---- Page Router ----
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
    case 'privacy': return <GenericPage title="Privacy & Safety" desc="Control who can contact you, see your activity, and how your data is used." />;
    case 'authorized-apps': return <GenericPage title="Authorized Apps" desc="These are apps that you've granted access to your account." />;
    case 'connections': return <GenericPage title="Connections" desc="Connect your accounts from other platforms to your Discord profile." />;
    case 'language': return <GenericPage title="Language" desc="Select the language you'd like Discord to use." />;
    case 'streamer': return <GenericPage title="Streamer Mode" desc="Configure streamer mode to automatically hide personal information when streaming." />;
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

  const handleLogout = () => { logout(); closeSettings(); };

  return (
    <div className="fixed inset-0 z-[100] flex animate-settings-open bg-discord-channel">
      {/* Sidebar — right-aligned content */}
      <div className="flex-[1_0_218px] flex justify-end bg-discord-sidebar">
        <div className="w-[218px] overflow-y-auto channel-scroll py-[60px] px-[6px]">
          <SidebarNav items={USER_SETTINGS} section="User Settings" current={settingsPage} onSelect={setSettingsPage} />
          <div className="h-px bg-discord-border mx-2.5 my-2" />
          <SidebarNav items={APP_SETTINGS} section="App Settings" current={settingsPage} onSelect={setSettingsPage} />
          <div className="h-px bg-discord-border mx-2.5 my-2" />
          <button onClick={handleLogout}
            className="flex items-center justify-between w-full px-2.5 py-[6px] rounded text-[15px] text-discord-red hover:bg-discord-red/10 transition-colors">
            Log Out <LogOut size={16} />
          </button>
          <div className="h-px bg-discord-border mx-2.5 my-2" />
          <p className="px-2.5 text-[11px] text-discord-text-muted">Disclone v1.0.0</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-[1_1_800px] max-w-[740px]">
        <div ref={contentRef} className="h-full overflow-y-auto py-[60px] px-10">
          <SettingsContent page={settingsPage} />
        </div>
      </div>

      {/* Close button */}
      <div className="flex-[0_1_36px] flex flex-col items-center pt-[60px]">
        <button onClick={closeSettings}
          className="w-9 h-9 rounded-full border-2 border-discord-text-muted/40 flex items-center justify-center text-discord-text-muted hover:border-white hover:text-white transition-colors">
          <X size={18} />
        </button>
        <span className="text-[11px] text-discord-text-muted font-bold mt-1">ESC</span>
      </div>

      {/* Remaining space */}
      <div className="flex-[1_0_0px]" />
    </div>
  );
}
