import { useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import useStore from '../store/useStore';

export default function ErrorNotification() {
  const { error, setError } = useStore();
  useEffect(() => {
    if (error) { const t = setTimeout(() => setError(null), 8000); return () => clearTimeout(t); }
  }, [error, setError]);
  if (!error) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[999] animate-slide-up max-w-sm">
      <div className="bg-discord-popout border border-discord-border rounded-lg shadow-2xl p-3.5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-discord-red/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertTriangle size={16} className="text-discord-red" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-white">Something went wrong</p>
          <p className="text-sm text-discord-text-muted mt-0.5 break-words">{error}</p>
        </div>
        <button onClick={() => setError(null)}
          className="flex-shrink-0 text-discord-text-muted hover:text-white rounded p-0.5 transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
