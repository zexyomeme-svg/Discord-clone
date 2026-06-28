import { useState } from 'react';
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import useStore from '../store/useStore';

export default function LoginScreen() {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { login, isLoading, error } = useStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) { setLocalError('Please enter a token'); return; }
    setLocalError(null);
    try { await login(token.trim()); } catch { /* handled in store */ }
  };

  const displayError = localError || error;

  return (
    <div className="h-full w-full bg-discord-dark flex items-center justify-center p-4 overflow-auto">
      {/* Background shimmer */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-[radial-gradient(ellipse_at_30%_20%,rgba(88,101,242,0.08)_0%,transparent_50%)]" />
        <div className="absolute -bottom-1/2 -right-1/2 w-[200%] h-[200%] bg-[radial-gradient(ellipse_at_70%_80%,rgba(235,69,158,0.05)_0%,transparent_50%)]" />
      </div>

      <div className="w-full max-w-[480px] relative z-10 animate-scale-in">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-3">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path d="M40.634 8.636a39.37 39.37 0 00-9.718-3.015.148.148 0 00-.157.074c-.42.747-.886 1.722-1.213 2.489a36.347 36.347 0 00-10.9 0 25.04 25.04 0 00-1.232-2.489.154.154 0 00-.157-.074 39.28 39.28 0 00-9.718 3.015.14.14 0 00-.064.055C2.216 16.36.803 23.837 1.501 31.215c.003.043.027.084.06.11a39.58 39.58 0 0011.913 6.023.155.155 0 00.168-.055 28.283 28.283 0 002.438-3.966.151.151 0 00-.083-.21 26.08 26.08 0 01-3.726-1.775.153.153 0 01-.015-.254c.25-.188.5-.383.74-.58a.148.148 0 01.155-.021c7.817 3.57 16.28 3.57 24.008 0a.147.147 0 01.157.019c.24.197.49.394.742.582a.153.153 0 01-.013.254 24.494 24.494 0 01-3.728 1.773.152.152 0 00-.081.212 31.746 31.746 0 002.436 3.964.153.153 0 00.168.057 39.484 39.484 0 0011.93-6.023.154.154 0 00.06-.108c.837-8.666-1.402-16.19-5.934-22.524a.12.12 0 00-.063-.057zM16.357 26.834c-1.951 0-3.558-1.791-3.558-3.993 0-2.2 1.575-3.993 3.558-3.993 1.998 0 3.59 1.808 3.558 3.993 0 2.202-1.575 3.993-3.558 3.993zm13.154 0c-1.95 0-3.558-1.791-3.558-3.993 0-2.2 1.576-3.993 3.558-3.993 1.999 0 3.59 1.808 3.558 3.993 0 2.202-1.56 3.993-3.558 3.993z" fill="#5865F2"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">Welcome back!</h1>
          <p className="text-discord-text-muted text-base">We're so excited to see you again!</p>
        </div>

        {/* Form */}
        <div className="bg-discord-channel rounded-md p-8 shadow-xl">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold uppercase mb-2 tracking-wide" style={{ color: displayError ? '#fa777c' : '#b5bac1' }}>
                Token {displayError && <span className="normal-case font-normal italic"> - {displayError}</span>}
                <span className="text-discord-red ml-0.5">*</span>
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setLocalError(null); }}
                  placeholder="Enter your bot token"
                  className="w-full bg-discord-dark text-discord-text rounded px-3 py-2.5 pr-10 text-base outline-none border border-transparent focus:border-discord-blurple transition-colors h-10"
                  disabled={isLoading}
                  autoFocus
                />
                <button type="button" onClick={() => setShowToken(!showToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-discord-text-muted hover:text-white transition-colors">
                  {showToken ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={isLoading}
              className="w-full bg-discord-blurple hover:bg-discord-blurple-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded transition-colors flex items-center justify-center gap-2 h-11 text-base">
              {isLoading ? (<><Loader2 size={20} className="animate-spin" />Connecting...</>) : 'Log In'}
            </button>
          </form>

          <div className="mt-4">
            <p className="text-sm text-discord-text-muted">
              Need a token?{' '}
              <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer"
                className="text-discord-text-link hover:underline">Discord Developer Portal</a>
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-discord-dark/50">
            <div className="flex items-start gap-3 p-3 bg-discord-dark/40 rounded-md">
              <AlertCircle size={18} className="text-discord-yellow mt-0.5 flex-shrink-0" />
              <div className="text-xs text-discord-text-muted space-y-1.5 leading-relaxed">
                <p className="font-semibold text-discord-yellow text-[13px]">How to get started:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Visit <span className="text-discord-text-link">discord.com/developers</span></li>
                  <li>Create a New Application → Bot → Reset Token</li>
                  <li>Enable <strong className="text-discord-text">Privileged Gateway Intents</strong></li>
                  <li>Invite bot to server, then paste token above</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
