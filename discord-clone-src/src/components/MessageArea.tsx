import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { Hash, Users, Search, PlusCircle, Smile, Loader2, FileText, Smile as EmojiIcon, Reply, MoreHorizontal, X } from 'lucide-react';
import useStore from '../store/useStore';
import { addReaction, getUserAvatarUrl } from '../services/discordApi';
import type { Message, Channel } from '../store/types';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';

function fmtTs(ts: string) {
  const d = new Date(ts);
  if (isToday(d)) return `Today at ${format(d, 'h:mm a')}`;
  if (isYesterday(d)) return `Yesterday at ${format(d, 'h:mm a')}`;
  return format(d, 'MM/dd/yyyy h:mm a');
}

function fmtShort(ts: string) { return format(new Date(ts), 'h:mm a'); }

function shouldGroup(prev: Message, curr: Message) {
  return prev.author.id === curr.author.id && (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) < 420000;
}

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
  r = r.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  r = r.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  r = r.replace(/<@!?(\d+)>/g, '<span class="bg-discord-mention text-[#c9cdfb] px-0.5 rounded cursor-pointer hover:bg-[#5865f2] hover:text-white font-medium">@user</span>');
  r = r.replace(/<@&(\d+)>/g, '<span class="bg-discord-mention text-[#c9cdfb] px-0.5 rounded">@role</span>');
  r = r.replace(/<#(\d+)>/g, '<span class="bg-discord-mention text-[#c9cdfb] px-0.5 rounded cursor-pointer hover:bg-[#5865f2] hover:text-white">#channel</span>');
  r = r.replace(/<a?:(\w+):(\d+)>/g, '<img src="https://cdn.discordapp.com/emojis/$2.png?size=24" alt=":$1:" class="inline-block w-5 h-5 align-middle" />');
  r = r.replace(/\n/g, '<br>');
  return r;
}

function DateDivider({ date }: { date: Date }) {
  let label = format(date, 'MMMM d, yyyy');
  if (isToday(date)) label = 'Today';
  else if (isYesterday(date)) label = 'Yesterday';
  return (
    <div className="flex items-center my-6 mx-4">
      <div className="flex-1 h-px bg-discord-border/50" />
      <span className="px-2 text-[11px] text-discord-text-muted font-bold uppercase">{label}</span>
      <div className="flex-1 h-px bg-discord-border/50" />
    </div>
  );
}

const MessageRow = memo(({ message, isGrouped, fontSize }: { message: Message; isGrouped: boolean; fontSize: number }) => {
  const { token, authMode, setError } = useStore();
  const avatarUrl = getUserAvatarUrl(message.author.id, message.author.avatar, message.author.discriminator);
  const isSys = message.type !== 0 && message.type !== 19;
  if (isSys) {
    return (
      <div className="px-[72px] py-0.5 text-discord-text-muted text-sm flex items-center gap-1">
        <span className="mr-1">→</span>
        <span><strong className="text-white font-medium">{message.author.username}</strong> {message.type === 7 ? 'joined the server.' : message.type === 8 ? 'just boosted the server!' : `triggered type ${message.type}`}</span>
        <span className="text-xs ml-1">{fmtShort(message.timestamp)}</span>
      </div>
    );
  }

  return (
    <div className={`group message-hover relative flex px-4 ${isGrouped ? 'py-[2px]' : 'mt-[17px] pt-[2px]'}`}>
      {/* Action bar */}
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
        <img src={avatarUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0 cursor-pointer hover:shadow-lg mr-4 mt-0.5"
          onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }} />
      )}

      <div className="flex-1 min-w-0">
        {!isGrouped && (
          <div className="flex items-baseline gap-1 leading-[22px]">
            <span className="font-medium text-white hover:underline cursor-pointer">{message.author.global_name || message.author.username}</span>
            {message.author.bot && <span className="bg-discord-blurple text-white text-[10px] font-medium px-[5px] py-[1px] rounded leading-[14px] uppercase ml-0.5 align-middle">Bot</span>}
            <span className="text-xs text-discord-text-muted ml-1">{fmtTs(message.timestamp)}</span>
          </div>
        )}

        {message.referenced_message && (
          <div className="flex items-center gap-1.5 text-sm text-discord-text-muted mb-0.5">
            <div className="w-[33px] h-[13px] border-l-2 border-t-2 border-discord-text-muted/30 rounded-tl ml-2" />
            <img src={getUserAvatarUrl(message.referenced_message.author.id, message.referenced_message.author.avatar, message.referenced_message.author.discriminator)}
              className="w-4 h-4 rounded-full" alt="" />
            <span className="text-xs font-medium text-discord-text hover:underline cursor-pointer">{message.referenced_message.author.username}</span>
            <span className="text-xs truncate max-w-[300px] hover:text-discord-text cursor-pointer">{message.referenced_message.content || 'Click to see attachment'}</span>
          </div>
        )}

        {message.content && (
          <div className="msg-content leading-[1.375rem] break-words" style={{ fontSize: `${fontSize}px` }}
            dangerouslySetInnerHTML={{ __html: renderMd(message.content) }} />
        )}

        {message.attachments.length > 0 && (
          <div className="mt-1 space-y-1">
            {message.attachments.map(att => {
              if (att.content_type?.startsWith('image/')) {
                const w = Math.min(att.width || 400, 400);
                const h = Math.min(att.height || 300, 300);
                return <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer">
                  <img src={att.proxy_url || att.url} alt={att.filename} className="rounded-lg cursor-pointer hover:shadow-lg transition-shadow" style={{ maxWidth: `${w}px`, maxHeight: `${h}px` }} />
                </a>;
              }
              return <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 bg-discord-sidebar rounded-lg p-3 hover:bg-discord-hover transition-colors max-w-[400px] border border-discord-border/50">
                <FileText size={24} className="text-discord-text-muted flex-shrink-0" />
                <div className="min-w-0"><p className="text-discord-text-link text-sm hover:underline truncate">{att.filename}</p><p className="text-xs text-discord-text-muted">{(att.size / 1024).toFixed(1)} KB</p></div>
              </a>;
            })}
          </div>
        )}

        {message.embeds.length > 0 && (
          <div className="mt-1 space-y-1">
            {message.embeds.map((embed, i) => (
              <div key={i} className="rounded-[4px] bg-discord-sidebar max-w-[520px] overflow-hidden border-l-4 grid"
                style={{ borderLeftColor: embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#202225' }}>
                <div className="p-3 overflow-hidden">
                  {embed.author && <div className="flex items-center gap-2 mb-1">{embed.author.icon_url && <img src={embed.author.icon_url} className="w-6 h-6 rounded-full" alt="" />}<span className="text-sm font-semibold text-white">{embed.author.name}</span></div>}
                  {embed.title && <p className="text-discord-text-link font-semibold text-sm hover:underline cursor-pointer">{embed.url ? <a href={embed.url} target="_blank" rel="noopener noreferrer">{embed.title}</a> : embed.title}</p>}
                  {embed.description && <p className="text-sm text-discord-text mt-1 leading-[18px]" style={{ whiteSpace: 'pre-line' }}>{embed.description}</p>}
                  {embed.fields && embed.fields.length > 0 && <div className="grid grid-cols-3 gap-2 mt-2">{embed.fields.map((f, fi) => <div key={fi} className={f.inline ? '' : 'col-span-3'}><p className="text-xs font-semibold text-white">{f.name}</p><p className="text-sm text-discord-text">{f.value}</p></div>)}</div>}
                  {embed.image && <img src={embed.image.url} className="mt-2 rounded max-w-full max-h-[300px]" alt="" />}
                  {embed.thumbnail && !embed.image && <img src={embed.thumbnail.url} className="absolute top-3 right-3 rounded w-20 h-20 object-cover" alt="" />}
                  {embed.footer && <div className="flex items-center gap-2 mt-2 text-xs text-discord-text-muted">{embed.footer.icon_url && <img src={embed.footer.icon_url} className="w-5 h-5 rounded-full" alt="" />}<span>{embed.footer.text}</span></div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {message.reactions && message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {message.reactions.map((r, i) => (
              <button key={i} className={`flex items-center gap-1 h-6 px-1.5 rounded text-xs border transition-colors ${r.me ? 'bg-discord-blurple/20 border-discord-blurple/40 text-discord-blurple' : 'bg-discord-dark border-transparent text-discord-text-muted hover:border-discord-text-muted/30'}`}>
                {r.emoji.id ? <img src={`https://cdn.discordapp.com/emojis/${r.emoji.id}.png?size=16`} className="w-4 h-4" alt="" /> : <span>{r.emoji.name}</span>}
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

function WelcomeMsg({ channel }: { channel?: Channel }) {
  return (
    <div className="px-4 pb-4 pt-16">
      <div className="w-[68px] h-[68px] rounded-full bg-discord-input flex items-center justify-center mb-3">
        <Hash size={42} className="text-white" />
      </div>
      <h1 className="text-[32px] font-bold text-white mb-1 leading-tight">Welcome to #{channel?.name || 'channel'}!</h1>
      <p className="text-discord-text-muted text-[15px]">This is the start of the <strong className="font-semibold">#{channel?.name || 'channel'}</strong> channel.{channel?.topic ? ` ${channel.topic}` : ''}</p>
    </div>
  );
}

export default function MessageArea() {
  const { selectedChannelId, selectedGuildId, channels, messages, isLoadingMessages, isLoadingMoreMessages, isSendingMessages, sendMessage: send, loadMoreMessages, toggleMemberList, showMemberList, typingUsers, userSettings } = useStore();
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const msgs = selectedChannelId ? messages[selectedChannelId] || [] : [];
  const guildCh = selectedGuildId ? channels[selectedGuildId] || [] : [];
  const ch = guildCh.find(c => c.id === selectedChannelId);
  const isSending = selectedChannelId ? Boolean(isSendingMessages[selectedChannelId]) : false;
  const typing = (selectedChannelId ? typingUsers[selectedChannelId] || [] : []).filter(t => Date.now() - t.timestamp < 10000);

  useEffect(() => { if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, autoScroll]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
    if (el.scrollTop < 100 && selectedChannelId && !isLoadingMessages) loadMoreMessages(selectedChannelId);
  }, [selectedChannelId, isLoadingMessages, loadMoreMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && files.length === 0) || !selectedChannelId) return;
    const msg = input; const sendingFiles = files; setInput(''); setFiles([]);
    try { await send(selectedChannelId, msg, sendingFiles); } catch { setInput(msg); setFiles(sendingFiles); }
  };

  if (!selectedChannelId) {
    return (
      <div className="flex-1 bg-discord-channel flex items-center justify-center min-h-0">
        <div className="text-center text-discord-text-muted animate-fade-in">
          <Hash size={48} className="mx-auto mb-4 opacity-20" />
          <p className="text-xl font-semibold text-discord-text">No Channel Selected</p>
          <p className="text-sm mt-1">Select a text channel to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-discord-channel flex flex-col min-w-0 min-h-0">
      {/* Header */}
      <div className="h-12 px-3 flex items-center justify-between border-b border-discord-darker/70 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Hash size={20} className="text-discord-text-muted flex-shrink-0" />
          <h3 className="font-semibold text-white text-[15px] truncate">{ch?.name || 'channel'}</h3>
          {ch?.topic && <><div className="w-px h-6 bg-discord-border mx-1.5 flex-shrink-0" /><p className="text-sm text-discord-text-muted truncate">{ch.topic}</p></>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
          <button onClick={toggleMemberList} className={`transition-colors ${showMemberList ? 'text-white' : 'text-discord-text-muted hover:text-discord-text'}`} title="Member List"><Users size={20} /></button>
          <div className="relative">
            <input type="text" placeholder="Search" className="w-[140px] focus:w-[200px] bg-discord-dark text-discord-text text-sm rounded h-[24px] px-1.5 outline-none placeholder:text-discord-text-muted transition-all" />
            <Search size={14} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-discord-text-muted pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0" onScroll={onScroll}>
        {isLoadingMoreMessages && msgs.length > 0 && (
          <div className="flex items-center justify-center py-3 text-xs text-discord-text-muted"><Loader2 size={16} className="animate-spin mr-2" />Loading older messages...</div>
        )}
        {isLoadingMessages && !msgs.length ? (
          <div className="flex items-center justify-center h-full"><Loader2 size={32} className="animate-spin text-discord-text-muted" /></div>
        ) : (
          <>
            <WelcomeMsg channel={ch} />
            {msgs.map((msg, i) => {
              const prev = i > 0 ? msgs[i - 1] : null;
              const grouped = prev ? shouldGroup(prev, msg) : false;
              const dateDivider = !prev || !isSameDay(new Date(prev.timestamp), new Date(msg.timestamp));
              return (
                <div key={msg.id}>
                  {dateDivider && <DateDivider date={new Date(msg.timestamp)} />}
                  <MessageRow message={msg} isGrouped={grouped && !dateDivider} fontSize={userSettings.fontSize} />
                </div>
              );
            })}
            <div ref={endRef} className="h-[30px]" />
          </>
        )}
      </div>

      {/* Typing */}
      <div className="h-6 px-4 flex items-center flex-shrink-0">
        {typing.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-discord-text-muted animate-fade-in-fast">
            <div className="flex gap-[3px]">
              <span className="w-[6px] h-[6px] bg-white rounded-full typing-dot" />
              <span className="w-[6px] h-[6px] bg-white rounded-full typing-dot" />
              <span className="w-[6px] h-[6px] bg-white rounded-full typing-dot" />
            </div>
            <span><strong>{typing.map(t => t.username).join(', ')}</strong> {typing.length === 1 ? 'is' : 'are'} typing...</span>
          </div>
        )}
      </div>

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

      {/* Input */}
      <form onSubmit={handleSend} className="px-4 pb-6 flex-shrink-0">
        <div className="bg-discord-input rounded-lg flex items-end">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { const selected = Array.from(e.target.files || []); setFiles((prev) => [...prev, ...selected].slice(0, 10)); e.currentTarget.value = ''; }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Upload files" className="p-[10px] text-discord-text-muted hover:text-discord-text transition-colors flex-shrink-0"><PlusCircle size={22} /></button>
          <textarea value={input} onChange={e => setInput(e.target.value)} disabled={isSending}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
            placeholder={isSending ? 'Sending...' : `Message #${ch?.name || 'channel'}`}
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
