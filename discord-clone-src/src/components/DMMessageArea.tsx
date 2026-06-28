import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { Search, PlusCircle, Smile, Loader2, AtSign, FileText, Reply, MoreHorizontal, X } from 'lucide-react';
import { Smile as EmojiIcon } from 'lucide-react';
import useStore from '../store/useStore';
import { addReaction, getUserAvatarUrl } from '../services/discordApi';
import type { Message, Channel } from '../store/types';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';

function fmtTs(ts: string) { const d = new Date(ts); if (isToday(d)) return `Today at ${format(d, 'h:mm a')}`; if (isYesterday(d)) return `Yesterday at ${format(d, 'h:mm a')}`; return format(d, 'MM/dd/yyyy h:mm a'); }
function fmtShort(ts: string) { return format(new Date(ts), 'h:mm a'); }
function shouldGroup(p: Message, c: Message) { return p.author.id === c.author.id && (new Date(c.timestamp).getTime() - new Date(p.timestamp).getTime()) < 420000; }

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMd(content: string) {
  let r = escapeHtml(content);
  r = r.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
  r = r.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  r = r.replace(/__(.+?)__/g, '<u>$1</u>');
  r = r.replace(/~~(.+?)~~/g, '<del>$1</del>');
  r = r.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  r = r.replace(/\n/g, '<br>');
  return r;
}

function DateDivider({ date }: { date: Date }) {
  let l = format(date, 'MMMM d, yyyy'); if (isToday(date)) l = 'Today'; else if (isYesterday(date)) l = 'Yesterday';
  return <div className="flex items-center my-6 mx-4"><div className="flex-1 h-px bg-discord-border/50" /><span className="px-2 text-[11px] text-discord-text-muted font-bold uppercase">{l}</span><div className="flex-1 h-px bg-discord-border/50" /></div>;
}

const MsgRow = memo(({ message, isGrouped, fontSize, spacing, compactMode }: { message: Message; isGrouped: boolean; fontSize: number; spacing: number; compactMode: boolean }) => {
  const { token, authMode, setError } = useStore();
  const av = getUserAvatarUrl(message.author.id, message.author.avatar, message.author.discriminator);
  return (
    <div className={`group message-hover relative flex px-4 ${isGrouped ? 'py-[2px]' : 'pt-[2px]'}`} style={{ marginTop: isGrouped ? undefined : `${compactMode ? 4 : spacing}px` }}>
      <div className="msg-actions flex bg-discord-channel border border-discord-border rounded shadow-md">
        <button title="Add thumbs up reaction" onClick={() => { if (!token || authMode !== 'bot') return setError('Reactions require bot-token mode.'); addReaction(token, message.channel_id, message.id).catch((err) => setError(err.message || 'Failed to add reaction')); }} className="p-1 hover:bg-discord-hover text-discord-text-muted hover:text-discord-text transition-colors"><EmojiIcon size={18} /></button>
        <button title="Copy reply mention" onClick={() => { navigator.clipboard?.writeText(`<@${message.author.id}> `); setError('Copied reply mention to clipboard. Paste it into the message box.'); }} className="p-1 hover:bg-discord-hover text-discord-text-muted hover:text-discord-text transition-colors"><Reply size={18} /></button>
        <button title="Copy message text" onClick={() => { navigator.clipboard?.writeText(message.content || ''); setError('Copied message text.'); }} className="p-1 hover:bg-discord-hover text-discord-text-muted hover:text-discord-text transition-colors"><MoreHorizontal size={18} /></button>
      </div>
      {isGrouped ? (
        <div className="w-[40px] mr-4 flex-shrink-0 flex items-center justify-end">
          <span className="text-[11px] text-discord-text-muted opacity-0 group-hover:opacity-100 transition-opacity select-none">{fmtShort(message.timestamp)}</span>
        </div>
      ) : (
        <img src={av} alt="" className="w-10 h-10 rounded-full flex-shrink-0 cursor-pointer mr-4 mt-0.5"
          onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
      )}
      <div className="flex-1 min-w-0">
        {!isGrouped && (
          <div className="flex items-baseline gap-1 leading-[22px]">
            <span className="font-medium text-white hover:underline cursor-pointer">{message.author.global_name || message.author.username}</span>
            {message.author.bot && <span className="bg-discord-blurple text-white text-[10px] font-medium px-[5px] py-[1px] rounded uppercase ml-0.5">Bot</span>}
            <span className="text-xs text-discord-text-muted ml-1">{fmtTs(message.timestamp)}</span>
          </div>
        )}
        {message.content && <div className="msg-content leading-[1.375rem] break-words" style={{ fontSize: `${fontSize}px` }} dangerouslySetInnerHTML={{ __html: renderMd(message.content) }} />}
        {message.attachments.length > 0 && <div className="mt-1 space-y-1">{message.attachments.map(att => {
          if (att.content_type?.startsWith('image/')) return <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer"><img src={att.proxy_url || att.url} alt="" className="rounded-lg max-w-[400px] max-h-[300px]" /></a>;
          return <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 bg-discord-sidebar rounded-lg p-3 hover:bg-discord-hover max-w-[400px] border border-discord-border/50"><FileText size={24} className="text-discord-text-muted" /><div><p className="text-discord-text-link text-sm hover:underline">{att.filename}</p><p className="text-xs text-discord-text-muted">{(att.size/1024).toFixed(1)} KB</p></div></a>;
        })}</div>}
        {message.embeds.length > 0 && <div className="mt-1 space-y-1">{message.embeds.map((embed, i) => (
          <div key={i} className="rounded bg-discord-sidebar max-w-[520px] overflow-hidden border-l-4 p-3" style={{ borderLeftColor: embed.color ? `#${embed.color.toString(16).padStart(6,'0')}` : '#202225' }}>
            {embed.title && <p className="text-discord-text-link font-semibold text-sm">{embed.title}</p>}
            {embed.description && <p className="text-sm text-discord-text mt-1">{embed.description}</p>}
            {embed.image && <img src={embed.image.url} className="mt-2 rounded max-w-full max-h-[300px]" alt="" />}
          </div>
        ))}</div>}
      </div>
    </div>
  );
});

function DMWelcome({ channel }: { channel: Channel }) {
  const r = channel.recipients?.[0];
  const av = r ? getUserAvatarUrl(r.id, r.avatar, r.discriminator) : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const name = r?.global_name || r?.username || 'Unknown User';
  return (
    <div className="px-4 pt-16 pb-4">
      <img src={av} alt="" className="w-20 h-20 rounded-full mb-3" onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
      <h1 className="text-[32px] font-bold text-white mb-1 leading-tight">{name}</h1>
      <p className="text-discord-text-muted text-[15px]">This is the beginning of your direct message history with <strong className="text-white font-semibold">{name}</strong>.</p>
    </div>
  );
}

export default function DMMessageArea() {
  const { selectedChannelId, dmChannels, messages, isLoadingMessages, isLoadingMoreMessages, isSendingMessages, sendMessage: send, loadMoreMessages, userSettings } = useStore();
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const msgs = selectedChannelId ? messages[selectedChannelId] || [] : [];
  const ch = dmChannels.find(c => c.id === selectedChannelId);
  const r = ch?.recipients?.[0];
  const rName = r?.global_name || r?.username || 'Unknown';
  const isSending = selectedChannelId ? Boolean(isSendingMessages[selectedChannelId]) : false;

  useEffect(() => { if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, autoScroll]);
  const onScroll = useCallback(() => {
    const el = containerRef.current; if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
    if (el.scrollTop < 100 && selectedChannelId && !isLoadingMessages) loadMoreMessages(selectedChannelId);
  }, [selectedChannelId, isLoadingMessages, loadMoreMessages]);

  const handleSend = async (e: React.FormEvent) => { e.preventDefault(); if ((!input.trim() && files.length === 0) || !selectedChannelId) return; const m = input; const sendingFiles = files; setInput(''); setFiles([]); try { await send(selectedChannelId, m, sendingFiles); } catch { setInput(m); setFiles(sendingFiles); } };

  if (!selectedChannelId || !ch) {
    return (
      <div className="flex-1 bg-discord-channel flex items-center justify-center min-h-0">
        <div className="text-center text-discord-text-muted animate-fade-in">
          <AtSign size={48} className="mx-auto mb-4 opacity-20" />
          <p className="text-xl font-semibold text-discord-text">Select a Conversation</p>
          <p className="text-sm mt-1">Choose a DM from the sidebar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-discord-channel flex flex-col min-w-0 min-h-0">
      <div className="h-12 px-3 flex items-center justify-between border-b border-discord-darker/70 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2"><AtSign size={20} className="text-discord-text-muted" /><h3 className="font-semibold text-white text-[15px]">{rName}</h3></div>
        <div className="flex items-center gap-3">
          <div className="relative"><input type="text" placeholder="Search" className="w-[140px] focus:w-[200px] bg-discord-dark text-discord-text text-sm rounded h-[24px] px-1.5 outline-none placeholder:text-discord-text-muted transition-all" /><Search size={14} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-discord-text-muted pointer-events-none" /></div>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0" onScroll={onScroll}>
        {isLoadingMoreMessages && msgs.length > 0 && (
          <div className="flex items-center justify-center py-3 text-xs text-discord-text-muted"><Loader2 size={16} className="animate-spin mr-2" />Loading older messages...</div>
        )}
        {isLoadingMessages && !msgs.length ? (
          <div className="flex items-center justify-center h-full"><Loader2 size={32} className="animate-spin text-discord-text-muted" /></div>
        ) : (
          <>
            <DMWelcome channel={ch} />
            {msgs.map((msg, i) => {
              const prev = i > 0 ? msgs[i-1] : null;
              const grouped = prev ? shouldGroup(prev, msg) : false;
              const dd = !prev || !isSameDay(new Date(prev.timestamp), new Date(msg.timestamp));
              return <div key={msg.id}>{dd && <DateDivider date={new Date(msg.timestamp)} />}<MsgRow message={msg} isGrouped={grouped && !dd} fontSize={userSettings.fontSize} spacing={userSettings.messageGroupSpacing} compactMode={userSettings.compactMode} /></div>;
            })}
            <div ref={endRef} className="h-[30px]" />
          </>
        )}
      </div>

      <div className="h-6 flex-shrink-0" />

      {files.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2 flex-shrink-0">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center gap-2 bg-discord-input text-discord-text rounded px-2 py-1 text-xs">
              <FileText size={14} />
              <span className="max-w-[180px] truncate">{file.name}</span>
              <span className="text-discord-text-muted">{(file.size / 1024).toFixed(1)} KB</span>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))} className="text-discord-text-muted hover:text-white"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSend} className="px-4 pb-6 flex-shrink-0">
        <div className="bg-discord-input rounded-lg flex items-end">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { const selected = Array.from(e.target.files || []); setFiles((prev) => [...prev, ...selected].slice(0, 10)); e.currentTarget.value = ''; }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Upload files" className="p-[10px] text-discord-text-muted hover:text-discord-text transition-colors flex-shrink-0"><PlusCircle size={22} /></button>
          <textarea value={input} onChange={e => setInput(e.target.value)} disabled={isSending}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
            placeholder={isSending ? 'Sending...' : `Message @${rName}`}
            className="flex-1 bg-transparent text-discord-text py-[10px] outline-none resize-none max-h-[50vh] placeholder:text-discord-text-muted leading-[22px]"
            style={{ fontSize: `${userSettings.fontSize}px`, minHeight: '22px' }}
            rows={1}
            onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }} />
          <div className="flex items-center gap-0.5 p-1.5 flex-shrink-0">
            <button type="button" onClick={() => setInput((v) => `${v}😊`)} title="Insert emoji" className="p-1 text-discord-text-muted hover:text-discord-text transition-colors rounded hover:bg-discord-hover"><Smile size={22} /></button>
            {isSending && <Loader2 size={18} className="animate-spin text-discord-text-muted mx-1" />}
          </div>
        </div>
      </form>
    </div>
  );
}
