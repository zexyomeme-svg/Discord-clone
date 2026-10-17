import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react';
import { Search, Loader2, AtSign, FileText, Reply, MoreHorizontal, Smile as EmojiIcon, Users } from 'lucide-react';
import useStore from '../store/useStore';
import { addReaction, getUserAvatarUrl } from '../services/discordApi';
import Composer from './Composer';
import type { Message, Channel } from '../store/types';
import { isSameDay } from 'date-fns';
// Shared with MessageArea. This file previously had its own copy that was
// missing mention, emoji, channel-link and blockquote support entirely, so DMs
// rendered noticeably less markup than guild channels.
import { renderMarkdown, type MarkdownContext } from '../utils/markdown';
import {
  formatDateDivider,
  formatMessageTimestamp,
  formatShortTimestamp,
  shouldGroupMessages,
} from '../utils/messageFormat';

/**
 * The DM chat column. Mirrors MessageArea's Material treatment — the two views
 * were visually inconsistent before, and both now render through the same
 * markdown helper and the same composer.
 */

function DateDivider({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 my-6 mx-4" role="separator">
      <div className="flex-1 h-px bg-outline-variant" aria-hidden="true" />
      <span className="px-3 py-1 rounded-m3-xs bg-surface-container text-label-small text-on-surface-variant uppercase tracking-[0.05em]">
        {formatDateDivider(date)}
      </span>
      <div className="flex-1 h-px bg-outline-variant" aria-hidden="true" />
    </div>
  );
}

const MsgRow = memo(({ message, isGrouped, fontSize, spacing, compactMode, mdContext }: {
  message: Message;
  isGrouped: boolean;
  fontSize: number;
  spacing: number;
  compactMode: boolean;
  mdContext: MarkdownContext;
}) => {
  const { token, authMode, setError, userSettings } = useStore();
  const av = getUserAvatarUrl(message.author.id, message.author.avatar, message.author.discriminator);
  const authorName = userSettings.streamerMode ? 'Hidden User' : (message.author.global_name || message.author.username);
  const canReact = Boolean(token) && authMode === 'bot';

  const react = useCallback((emoji: string) => {
    if (!canReact) {
      setError('Reactions require bot-token mode.');
      return;
    }
    addReaction(token!, message.channel_id, message.id, emoji)
      .catch((err: Error) => setError(err.message || 'Failed to add reaction'));
  }, [canReact, token, message.channel_id, message.id, setError]);

  return (
    <div
      className={`group message-hover relative flex px-4 ${isGrouped ? 'py-[2px]' : 'pt-[2px] pb-[2px]'}`}
      style={{ marginTop: isGrouped ? undefined : `${compactMode ? 4 : spacing}px` }}
    >
      <div className="msg-actions flex">
        <button type="button" title="Add 👍 reaction" aria-label="Add thumbs up reaction" onClick={() => react('👍')}>
          <EmojiIcon size={18} />
        </button>
        <button
          type="button"
          title="Copy reply mention"
          aria-label="Copy reply mention"
          onClick={() => {
            navigator.clipboard?.writeText(`<@${message.author.id}> `);
            setError('Copied reply mention to clipboard. Paste it into the message box.');
          }}
        >
          <Reply size={18} />
        </button>
        <button
          type="button"
          title="Copy message text"
          aria-label="Copy message text"
          onClick={() => {
            navigator.clipboard?.writeText(message.content || '');
            setError('Copied message text.');
          }}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>

      {isGrouped ? (
        <div className="w-[40px] mr-4 flex-shrink-0 flex items-start justify-end pt-[2px]">
          <span className="text-label-small text-on-surface-variant opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150 select-none">
            {formatShortTimestamp(message.timestamp)}
          </span>
        </div>
      ) : (
        <img
          src={av}
          alt=""
          className="w-10 h-10 rounded-full flex-shrink-0 cursor-pointer mr-4 mt-0.5 bg-surface-container-highest
            transition-shadow duration-200 ease-emphasized hover:shadow-lg"
          onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
        />
      )}

      <div className="flex-1 min-w-0">
        {!isGrouped && (
          <div className="flex items-baseline gap-1.5 leading-[22px] flex-wrap">
            <span className="text-title-small text-on-surface font-medium hover:underline cursor-pointer">{authorName}</span>
            {message.author.bot && (
              <span className="bg-primary-container text-on-primary-container text-[10px] font-medium px-1.5 py-[1px]
                rounded-m3-xs uppercase tracking-[0.03em] align-middle">
                Bot
              </span>
            )}
            <span className="text-label-small text-on-surface-variant">{formatMessageTimestamp(message.timestamp)}</span>
            {message.edited_timestamp && (
              <span className="text-label-small text-on-surface-variant/70" title="Edited">(edited)</span>
            )}
          </div>
        )}

        {message.content && (
          <div
            className="msg-content leading-[1.375rem] break-words"
            style={{ fontSize: `${fontSize}px` }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content, mdContext) }}
          />
        )}

        {message.attachments.length > 0 && (
          <div className="mt-1.5 space-y-1.5">
            {message.attachments.map((att) => {
              if (att.content_type?.startsWith('image/')) {
                return (
                  <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="block w-fit max-w-full">
                    <img
                      src={att.proxy_url || att.url}
                      alt={att.filename}
                      className="rounded-m3-lg max-w-[400px] max-h-[300px] bg-surface-container-highest
                        transition-shadow duration-200 ease-emphasized hover:shadow-lg"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </a>
                );
              }
              return (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-surface-container rounded-m3-md p-3 max-w-[400px]
                    ring-1 ring-outline-variant transition-shadow duration-200 ease-emphasized hover:shadow-md"
                >
                  <FileText size={24} className="text-on-surface-variant flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-primary text-label-large hover:underline truncate">{att.filename}</p>
                    <p className="text-label-small text-on-surface-variant tabular-nums">{(att.size / 1024).toFixed(1)} KB</p>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {message.embeds.length > 0 && (
          <div className="mt-1.5 space-y-1.5">
            {message.embeds.map((embed, i) => (
              <div
                key={i}
                className="relative rounded-m3-md bg-surface-container max-w-[520px] overflow-hidden ring-1 ring-outline-variant"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : 'var(--color-outline-variant)' }}
                />
                <div className="p-3 pl-4">
                  {embed.title && <p className="text-primary text-title-small">{embed.title}</p>}
                  {embed.description && (
                    <p className="text-body-small text-on-surface mt-1" style={{ whiteSpace: 'pre-line' }}>{embed.description}</p>
                  )}
                  {embed.image && <img src={embed.image.url} className="mt-2 rounded-m3-sm max-w-full max-h-[300px]" alt="" />}
                </div>
              </div>
            ))}
          </div>
        )}

        {message.reactions && message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {message.reactions.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => react(r.emoji.name || '👍')}
                disabled={!canReact}
                data-ripple
                title={r.emoji.name ? `React with ${r.emoji.name}` : 'React'}
                className={`m3-interactive flex items-center gap-1 h-7 pl-1 pr-2 rounded-m3-sm text-label-medium
                  transition-colors duration-200 ease-standard disabled:opacity-40 disabled:cursor-not-allowed
                  ${r.me
                    ? 'bg-secondary-container text-on-secondary-container ring-1 ring-primary/50'
                    : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface ring-1 ring-outline-variant'}`}
              >
                {r.emoji.id
                  ? <img src={`https://cdn.discordapp.com/emojis/${r.emoji.id}.png?size=16`} className="w-4 h-4 object-contain" alt="" />
                  : <span className="text-[15px] leading-none">{r.emoji.name}</span>}
                <span className="tabular-nums">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

function DMWelcome({ channel }: { channel: Channel }) {
  const r = channel.recipients?.[0];
  const isGroup = channel.type === 3;
  const av = r ? getUserAvatarUrl(r.id, r.avatar, r.discriminator) : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const name = isGroup
    ? (channel.name || 'Group DM')
    : (r?.global_name || r?.username || 'Unknown User');

  return (
    <div className="px-4 pt-16 pb-4">
      {isGroup ? (
        <div className="w-20 h-20 rounded-m3-xl bg-secondary-container flex items-center justify-center mb-4 elev-1">
          <Users size={38} className="text-on-secondary-container" />
        </div>
      ) : (
        <img
          src={av}
          alt=""
          className="w-20 h-20 rounded-full mb-4 bg-surface-container-highest elev-1"
          onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
        />
      )}
      <h1 className="text-headline-small font-bold text-on-surface mb-1.5 leading-tight">{name}</h1>
      <p className="text-body-large text-on-surface-variant max-w-2xl">
        {isGroup
          ? <>This is the start of the <strong className="font-medium text-on-surface">{name}</strong> group conversation.</>
          : <>This is the beginning of your direct message history with <strong className="font-medium text-on-surface">{name}</strong>.</>}
      </p>
    </div>
  );
}

export default function DMMessageArea() {
  const { selectedChannelId, dmChannels, messages, isLoadingMessages, isLoadingMoreMessages, isSendingMessages, sendMessage: send, loadMoreMessages, userSettings, user } = useStore();
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const msgs = selectedChannelId ? messages[selectedChannelId] || [] : [];
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const shownMessages = normalizedSearch
    ? msgs.filter((msg) =>
      (msg.content || '').toLowerCase().includes(normalizedSearch)
      || (msg.author?.username || '').toLowerCase().includes(normalizedSearch)
      || (msg.author?.global_name || '').toLowerCase().includes(normalizedSearch)
      || msg.attachments?.some((att) => att.filename.toLowerCase().includes(normalizedSearch))
    )
    : msgs;
  const ch = dmChannels.find((c) => c.id === selectedChannelId);

  // DM participants become the mention-resolution context so <@id> in a DM
  // renders a real name instead of "Unknown User".
  const mdContext = useMemo<MarkdownContext>(() => {
    const recipients = ch?.recipients || [];
    const participants = user ? [...recipients, user] : recipients;
    return {
      mentions: participants,
      members: participants.map((p) => ({ user: p, nick: null })),
      currentUserId: user?.id ?? null,
      streamerMode: userSettings.streamerMode,
    };
  }, [ch, user, userSettings.streamerMode]);

  const r = ch?.recipients?.[0];
  const rName = ch?.type === 3
    ? (ch.name || 'Group DM')
    : (r?.global_name || r?.username || 'Unknown');
  const isSending = selectedChannelId ? Boolean(isSendingMessages[selectedChannelId]) : false;

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length, autoScroll]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
    if (el.scrollTop < 100 && selectedChannelId && !isLoadingMessages) loadMoreMessages(selectedChannelId);
  }, [selectedChannelId, isLoadingMessages, loadMoreMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && files.length === 0) || !selectedChannelId) return;
    const m = input;
    const sendingFiles = files;
    setInput('');
    setFiles([]);
    try {
      await send(selectedChannelId, m, sendingFiles);
    } catch {
      setInput(m);
      setFiles(sendingFiles);
    }
  };

  if (!selectedChannelId || !ch) {
    return (
      <div className="flex-1 bg-surface-container-high flex items-center justify-center min-h-0">
        <div className="text-center text-on-surface-variant animate-fade-in px-6">
          <div className="w-20 h-20 mx-auto mb-5 rounded-m3-xl bg-surface-container-highest flex items-center justify-center">
            <AtSign size={38} className="text-on-surface-variant/60" />
          </div>
          <p className="text-title-large text-on-surface">Select a conversation</p>
          <p className="text-body-medium mt-1.5 max-w-xs mx-auto">Choose a DM from the sidebar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface-container-high flex flex-col min-w-0 min-h-0">
      <div className="h-12 px-3 flex items-center justify-between flex-shrink-0 elev-1 bg-surface-container-high z-10">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {ch.type === 3 ? (
            <Users size={20} className="text-on-surface-variant flex-shrink-0" />
          ) : (
            <img
              src={getUserAvatarUrl(r?.id ?? '', r?.avatar ?? null, r?.discriminator ?? '0')}
              alt=""
              className="w-6 h-6 rounded-full flex-shrink-0 bg-surface-container-highest"
              onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
            />
          )}
          <h3 className="font-medium text-on-surface text-title-small truncate">{rName}</h3>
        </div>
        <div className="flex items-center flex-shrink-0 ml-2 relative">
          <input
            type="text"
            data-app-search="true"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search messages in this conversation"
            className="w-[132px] focus:w-[196px] bg-surface-container-lowest text-on-surface text-body-small
              rounded-m3-sm h-8 px-2.5 pr-8 outline-none placeholder:text-on-surface-variant/70
              focus:outline focus:outline-2 focus:outline-primary
              transition-[width,outline-color] duration-300 ease-emphasized"
          />
          <Search size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0" onScroll={onScroll}>
        {isLoadingMoreMessages && msgs.length > 0 && (
          <div className="flex items-center justify-center py-3 text-label-small text-on-surface-variant">
            <Loader2 size={15} className="animate-spin mr-2" aria-hidden="true" />
            Loading older messages…
          </div>
        )}
        {isLoadingMessages && !msgs.length ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={32} className="animate-spin text-on-surface-variant" aria-label="Loading messages" />
          </div>
        ) : (
          <>
            <DMWelcome channel={ch} />
            {normalizedSearch && (
              <div className="px-4 py-2 mx-4 mb-2 rounded-m3-sm bg-surface-container text-body-small text-on-surface-variant">
                Showing {shownMessages.length} result{shownMessages.length === 1 ? '' : 's'} for “{searchQuery}”.
                <button type="button" onClick={() => setSearchQuery('')} className="ml-2 text-primary hover:underline font-medium">
                  Clear
                </button>
              </div>
            )}
            {shownMessages.map((msg, i) => {
              const prev = i > 0 ? shownMessages[i - 1] : null;
              const grouped = prev ? shouldGroupMessages(prev, msg) : false;
              const dd = !prev || !isSameDay(new Date(prev.timestamp), new Date(msg.timestamp));
              return (
                <div key={msg.id}>
                  {dd && <DateDivider date={new Date(msg.timestamp)} />}
                  <MsgRow
                    message={msg}
                    isGrouped={grouped && !dd}
                    fontSize={userSettings.fontSize}
                    spacing={userSettings.messageGroupSpacing}
                    compactMode={userSettings.compactMode}
                    mdContext={mdContext}
                  />
                </div>
              );
            })}
            {!normalizedSearch && !shownMessages.length && (
              <p className="px-4 pb-4 text-body-medium text-on-surface-variant">No messages here yet.</p>
            )}
            <div ref={endRef} className="h-[30px]" />
          </>
        )}
      </div>

      <div className="h-6 flex-shrink-0" />

      <Composer
        input={input}
        setInput={setInput}
        onSubmit={handleSend}
        placeholder={`Message @${rName}`}
        disabled={isSending}
        files={files}
        onRemoveFile={(index) => setFiles((prev) => prev.filter((_, i) => i !== index))}
        onPickFiles={(picked) => setFiles((prev) => [...prev, ...picked].slice(0, 10))}
        fileInputRef={fileInputRef}
        onInsertEmoji={() => setInput((v) => `${v}😊`)}
      />
    </div>
  );
}
