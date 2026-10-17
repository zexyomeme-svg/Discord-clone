import { useEffect, useState, useId } from 'react';
import { Eye, EyeOff, Info, Loader2, ExternalLink, ShieldAlert } from 'lucide-react';
import useStore from '../store/useStore';
import { fetchOAuthConfig } from '../services/discordApi';

/**
 * Sign-in screen, rebuilt as a Material 3 card.
 *
 * The token field is a genuine M3 filled text field: the label floats on focus
 * or when the field has content, the active indicator thickens and takes the
 * primary colour, and an error swaps both to the error colour with supporting
 * text underneath — rather than being crammed into the label as Discord does.
 */

function TokenField({ id, value, onChange, disabled, invalid, supporting }: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  invalid: boolean;
  supporting: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const floated = value.length > 0;

  return (
    <div>
      <div
        className={`relative h-14 rounded-m3-sm rounded-b-none bg-surface-container-highest
          border-b-2 transition-colors duration-200 ease-standard
          ${invalid ? 'border-error' : 'border-outline-variant focus-within:border-primary'}`}
      >
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder=" "
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-supporting`}
          className="peer absolute inset-0 w-full h-full bg-transparent pl-4 pr-12 pt-5 text-body-large
            text-on-surface outline-none disabled:opacity-40"
        />
        <label
          htmlFor={id}
          className={`absolute left-4 pointer-events-none origin-left transition-all duration-200 ease-emphasized
            ${floated ? 'top-1.5 text-label-small scale-[0.92]' : 'top-1/2 -translate-y-1/2 text-body-large'}
            peer-focus:top-1.5 peer-focus:text-label-small peer-focus:scale-[0.92] peer-focus:translate-y-0
            ${invalid ? 'text-error' : 'text-on-surface-variant peer-focus:text-primary'}`}
        >
          Bot token
        </label>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          data-ripple
          aria-label={revealed ? 'Hide token' : 'Show token'}
          className="m3-interactive absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full
            flex items-center justify-center text-on-surface-variant hover:text-on-surface
            transition-colors duration-200 ease-standard"
        >
          {revealed ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>
      <p
        id={`${id}-supporting`}
        role={invalid ? 'alert' : undefined}
        className={`mt-1.5 ml-4 text-label-small min-h-[16px] ${invalid ? 'text-error' : 'text-on-surface-variant'}`}
      >
        {supporting}
      </p>
    </div>
  );
}

export default function LoginScreen() {
  const [token, setToken] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const { login, isLoading, error } = useStore();
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthWarning, setOauthWarning] = useState<string | null>(null);
  const fieldId = useId();

  useEffect(() => {
    let cancelled = false;
    void fetchOAuthConfig().then((config) => {
      if (cancelled) return;
      setOauthEnabled(Boolean(config?.enabled));
      setOauthWarning(config?.warning ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setLocalError('Enter a bot token to continue.');
      return;
    }
    setLocalError(null);
    try {
      await login(token.trim());
    } catch {
      /* the store surfaces the error */
    }
  };

  const displayError = localError || error;

  return (
    <div className="h-full w-full bg-surface flex items-center justify-center p-4 overflow-auto">
      {/* Tonal ambience — two large, very low-contrast washes of the source colour. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-[radial-gradient(ellipse_at_30%_20%,color-mix(in_srgb,var(--color-primary)_7%,transparent)_0%,transparent_55%)]" />
        <div className="absolute -bottom-1/2 -right-1/2 w-[200%] h-[200%] bg-[radial-gradient(ellipse_at_70%_80%,color-mix(in_srgb,var(--color-tertiary)_5%,transparent)_0%,transparent_55%)]" />
      </div>

      <div className="w-full max-w-[460px] relative z-10 animate-scale-in">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-[72px] h-[72px] mb-4 rounded-m3-xl bg-primary-container elev-2">
            <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <path d="M40.634 8.636a39.37 39.37 0 00-9.718-3.015.148.148 0 00-.157.074c-.42.747-.886 1.722-1.213 2.489a36.347 36.347 0 00-10.9 0 25.04 25.04 0 00-1.232-2.489.154.154 0 00-.157-.074 39.28 39.28 0 00-9.718 3.015.14.14 0 00-.064.055C2.216 16.36.803 23.837 1.501 31.215c.003.043.027.084.06.11a39.58 39.58 0 0011.913 6.023.155.155 0 00.168-.055 28.283 28.283 0 002.438-3.966.151.151 0 00-.083-.21 26.08 26.08 0 01-3.726-1.775.153.153 0 01-.015-.254c.25-.188.5-.383.74-.58a.148.148 0 01.155-.021c7.817 3.57 16.28 3.57 24.008 0a.147.147 0 01.157.019c.24.197.49.394.742.582a.153.153 0 01-.013.254 24.494 24.494 0 01-3.728 1.773.152.152 0 00-.081.212 31.746 31.746 0 002.436 3.964.153.153 0 00.168.057 39.484 39.484 0 0011.93-6.023.154.154 0 00.06-.108c.837-8.666-1.402-16.19-5.934-22.524a.12.12 0 00-.063-.057zM16.357 26.834c-1.951 0-3.558-1.791-3.558-3.993 0-2.2 1.575-3.993 3.558-3.993 1.998 0 3.59 1.808 3.558 3.993 0 2.202-1.575 3.993-3.558 3.993zm13.154 0c-1.95 0-3.558-1.791-3.558-3.993 0-2.2 1.576-3.993 3.558-3.993 1.999 0 3.59 1.808 3.558 3.993 0 2.202-1.56 3.993-3.558 3.993z" fill="currentColor" className="text-on-primary-container" />
            </svg>
          </div>
          <h1 className="text-headline-small font-medium text-on-surface mb-1">Welcome back</h1>
          <p className="text-body-medium text-on-surface-variant">Sign in with a Discord bot token or your Discord account.</p>
        </div>

        <div className="bg-surface-container rounded-m3-xl p-6 sm:p-8 elev-3">
          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <TokenField
              id={fieldId}
              value={token}
              onChange={(next) => { setToken(next); setLocalError(null); }}
              disabled={isLoading}
              invalid={Boolean(displayError)}
              supporting={displayError || 'From the Developer Portal → your app → Bot.'}
            />

            <button
              type="submit"
              disabled={isLoading}
              data-ripple
              className="m3-interactive w-full h-12 rounded-m3-xl bg-primary text-on-primary text-label-large
                disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2
                transition-[box-shadow,opacity] duration-200 ease-standard hover:shadow-md"
            >
              {isLoading
                ? (<><Loader2 size={20} className="animate-spin" aria-hidden="true" />Connecting…</>)
                : 'Sign in with bot token'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3" role="separator">
            <div className="h-px flex-1 bg-outline-variant" />
            <span className="text-label-small uppercase tracking-[0.05em] text-on-surface-variant">or</span>
            <div className="h-px flex-1 bg-outline-variant" />
          </div>

          {/* Outlined button: the secondary action in an M3 pair. */}
          <a
            href="/auth/discord/login"
            aria-disabled={!oauthEnabled}
            tabIndex={oauthEnabled ? 0 : -1}
            data-ripple={oauthEnabled ? '' : undefined}
            className={`m3-interactive w-full h-12 rounded-m3-xl text-label-large flex items-center justify-center gap-2
              transition-colors duration-200 ease-standard
              ${oauthEnabled
                ? 'text-primary outline outline-1 outline-outline-variant hover:outline-primary'
                : 'text-on-surface-variant/50 outline outline-1 outline-outline-variant/50 pointer-events-none'}`}
          >
            <ExternalLink size={18} aria-hidden="true" /> Continue with Discord
          </a>

          {!oauthEnabled && (
            <p className="mt-3 text-label-small text-on-surface-variant leading-relaxed">
              {oauthWarning
                ? 'Discord sign-in is unavailable: the server has credentials but cannot determine a trusted public URL. Set PUBLIC_BASE_URL (or DISCORD_REDIRECT_URI) on the server.'
                : 'Discord sign-in is disabled until DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are configured on the server.'}
            </p>
          )}

          <div className="mt-5 pt-5 border-t border-outline-variant">
            <div className="flex items-start gap-3 p-3.5 bg-tertiary-container/40 rounded-m3-md">
              <Info size={18} className="text-tertiary mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div className="text-label-small text-on-surface-variant space-y-1.5 leading-relaxed min-w-0">
                <p className="text-label-large text-on-surface">Getting a bot token</p>
                <ol className="list-decimal list-inside space-y-1 marker:text-on-surface-variant/70">
                  <li>
                    Visit{' '}
                    <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      discord.com/developers
                    </a>
                  </li>
                  <li>New Application → Bot → Reset Token</li>
                  <li>Enable <strong className="text-on-surface font-medium">Privileged Gateway Intents</strong></li>
                  <li>Invite the bot to your server, then paste the token above</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2.5 px-3.5 py-3 rounded-m3-md bg-error-container/25">
            <ShieldAlert size={16} className="text-error mt-0.5 flex-shrink-0" aria-hidden="true" />
            <p className="text-label-small text-on-surface-variant leading-relaxed">
              Personal account tokens are not supported — automating a user account breaks Discord's Terms and risks a
              ban. Use a bot token, or the Discord sign-in above.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
