import { useEffect } from 'react';
import { X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import useStore from '../store/useStore';

/**
 * Errors and confirmations, rendered as a Material 3 snackbar.
 *
 * Sits above the composer rather than floating over content, carries elevation
 * 3, and dismisses itself. Most messages this app raises are confirmations
 * ("Copied message text."), so the leading icon reflects the tone instead of
 * always showing a warning triangle.
 */

const DISMISS_AFTER_MS = 8000;

/** Heuristic: the store reuses `error` for both failures and confirmations. */
function looksLikeConfirmation(message: string): boolean {
  return /^(copied|saved|updated|added|removed|sent|done|success)/i.test(message.trim());
}

export default function ErrorNotification() {
  const { error, setError } = useStore();

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), DISMISS_AFTER_MS);
    return () => clearTimeout(t);
  }, [error, setError]);

  if (!error) return null;
  const positive = looksLikeConfirmation(error);

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[999] w-[min(92vw,34rem)] animate-snackbar-in pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto bg-surface-container-highest rounded-m3-sm elev-3 px-4 py-3 flex items-start gap-3">
        <span
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
            positive ? 'bg-success-container/60 text-success' : 'bg-error-container/60 text-error'
          }`}
        >
          {positive ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-label-large ${positive ? 'text-on-surface' : 'text-on-surface'}`}>
            {positive ? 'Done' : 'Something went wrong'}
          </p>
          <p className="text-body-small text-on-surface-variant mt-0.5 break-words leading-relaxed">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => setError(null)}
          data-ripple
          aria-label="Dismiss"
          className="m3-interactive flex-shrink-0 w-9 h-9 -my-1 -mr-1 rounded-full flex items-center justify-center
            text-on-surface-variant hover:text-on-surface transition-colors duration-200 ease-standard"
        >
          <X size={17} />
        </button>
      </div>
    </div>
  );
}
