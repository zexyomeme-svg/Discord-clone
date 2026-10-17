import { PlusCircle, Loader2, FileText, Smile as EmojiIcon, X, Send } from 'lucide-react';
import { MAX_MESSAGE_LENGTH } from '../services/discordApi';

/**
 * The composer. An M3 filled text field: a tonal container that gains a
 * primary ring on focus, with icon buttons inside it and an explicit send
 * action that only lights up once there is something to send.
 */
export default function Composer({ input, setInput, onSubmit, placeholder, disabled, files, onRemoveFile, onPickFiles, fileInputRef, onInsertEmoji }: {
  input: string;
  setInput: (value: string | ((prev: string) => string)) => void;
  onSubmit: (e: React.FormEvent) => void;
  placeholder: string;
  disabled: boolean;
  files: File[];
  onRemoveFile: (index: number) => void;
  onPickFiles: (files: File[]) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onInsertEmoji: () => void;
}) {
  const remaining = MAX_MESSAGE_LENGTH - input.length;
  const overLimit = remaining < 0;
  const nearLimit = remaining <= 200 && !overLimit;
  const canSend = !disabled && (input.trim().length > 0 || files.length > 0) && !overLimit;

  return (
    <div className="px-4 pb-5 flex-shrink-0">
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 bg-surface-container-high text-on-surface
                rounded-m3-sm pl-2.5 pr-1.5 py-1.5 text-label-small ring-1 ring-outline-variant elev-1"
            >
              <FileText size={15} className="text-on-surface-variant flex-shrink-0" />
              <span className="max-w-[180px] truncate">{file.name}</span>
              <span className="text-on-surface-variant tabular-nums">{(file.size / 1024).toFixed(1)} KB</span>
              <button
                type="button"
                onClick={() => onRemoveFile(index)}
                aria-label={`Remove ${file.name}`}
                data-ripple
                className="m3-interactive w-6 h-6 flex items-center justify-center rounded-full
                  text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div
          className={`bg-surface-container-highest rounded-m3-xl flex items-end gap-1 px-1.5 py-1
            transition-[box-shadow,outline-color] duration-200 ease-standard elev-1
            focus-within:outline focus-within:outline-2 focus-within:outline-primary
            ${overLimit ? 'outline outline-2 outline-error' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              onPickFiles(Array.from(e.target.files || []));
              e.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            data-upload-trigger="true"
            onClick={() => fileInputRef.current?.click()}
            title="Upload files"
            aria-label="Upload files"
            data-ripple
            className="m3-interactive w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0
              text-on-surface-variant hover:text-on-surface transition-colors duration-200 ease-standard"
          >
            <PlusCircle size={22} />
          </button>

          <textarea
            data-message-input="true"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !overLimit) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
            placeholder={disabled ? 'Sending…' : placeholder}
            aria-label={placeholder}
            aria-invalid={overLimit || undefined}
            className="ring-on-container flex-1 bg-transparent text-on-surface py-2.5 outline-none resize-none
              max-h-[50vh] placeholder:text-on-surface-variant/70 leading-[22px] text-body-large min-w-0"
            style={{ minHeight: '22px' }}
            rows={1}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = `${t.scrollHeight}px`;
            }}
          />

          <div className="flex items-center gap-0.5 flex-shrink-0 pb-0.5">
            {nearLimit && (
              <span
                className={`text-label-small tabular-nums mr-1 ${overLimit ? 'text-error' : 'text-warning'}`}
                role="status"
              >
                {remaining}
              </span>
            )}
            <button
              type="button"
              onClick={onInsertEmoji}
              title="Insert emoji"
              aria-label="Insert emoji"
              data-ripple
              className="m3-interactive w-10 h-10 flex items-center justify-center rounded-full
                text-on-surface-variant hover:text-on-surface transition-colors duration-200 ease-standard"
            >
              <EmojiIcon size={22} />
            </button>
            {disabled ? (
              <span className="w-10 h-10 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-on-surface-variant" />
              </span>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                title="Send message"
                aria-label="Send message"
                data-ripple
                className={`m3-interactive w-10 h-10 flex items-center justify-center rounded-full
                  transition-[background-color,color,transform] duration-200 ease-emphasized
                  ${canSend
                    ? 'bg-primary text-on-primary scale-100'
                    : 'bg-transparent text-on-surface-variant/40 cursor-not-allowed scale-95'}`}
              >
                <Send size={19} />
              </button>
            )}
          </div>
        </div>

        {overLimit && (
          <p className="mt-1.5 ml-3 text-label-small text-error" role="alert">
            {Math.abs(remaining)} characters over Discord's {MAX_MESSAGE_LENGTH} character limit.
          </p>
        )}
      </form>
    </div>
  );
}
