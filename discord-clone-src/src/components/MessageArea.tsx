import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react';
import { Hash, Users, Search, Loader2, FileText, Smile as EmojiIcon, Reply, MoreHorizontal, Lock } from 'lucide-react';
import useStore from '../store/useStore';
import { addReaction, getUserAvatarUrl } from '../services/discordApi';
import Composer from './Composer';
import type { Message, Channel } from '../store/types';
import { isSameDay } from 'date-fns';
// Shared with DMMessageArea. The previous per-file copies had drifted: this one
// had mention/emoji/blockquote rules that could never match (they looked for a
// literal `<` after the content had already been escaped to `&lt;`), and the DM
// copy was missing them entirely.
import { renderMarkdown, type MarkdownContext } from '../utils/markdown';
import {
  formatDateDivider,
  formatMessageTimestamp,
  formatShortTimestamp,
  isSystemMessage,
  shouldGroupMessages,
  systemMessageVerb,
} from '../utils/messageFormat';

/**
 * Guild chat column: 48px top app bar, scrolling message list, typing row and
 * composer. Discord's structure, Material 3's surfaces and interaction states.
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

/** M3 assist chip used for reactions. */
const ReactionChip = memo(({ emojiUrl, emojiName, count, mine, disabled, onClick }: {
  emojiUrl: string | null;
  emojiName: string | null;
  count: number;
  mine: boolean;
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-ripple
    title={emojiName ? `React with ${emojiName}` : 'React'}
    className={`m3-interactive flex items-center gap-1 h-7 pl-1 pr-2 rounded-m3-sm text-label-medium
      transition-colors duration-200 ease-standard disabled:opacity-40 disabled:cursor-not-allowed
      ${mine
        ? 'bg-secondary-container text-on-secondary-container ring-1 ring-primary/50'
        : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface ring-1 ring-outline-variant'}`}
  >
    {emojiUrl
      ? <img src={emojiUrl} className="w-4 h-4 object-contain" alt="" />
      : <span className="text-[15px] leading-none">{emojiName}</span>}
    <span className="tabular-nums">{count}</span>
  </button>
));

const MessageRow = memo(({ message, isGrouped, fontSize, spacing, compactMode, mdContext }: {
  message: Message;
  isGrouped: boolean;
  fontSize: number;
  spacing: number;
  compactMode: boolean;
  mdContext: MarkdownContext;
}) => {
  const { token, authMode, setError, userSettings } = useStore();
  const avatarUrl = getUserAvatarUrl(message.author.id, message.author.avatar, message.author.discriminator);
  const authorName = userSettings.streamerMode ? 'Hidden User' : (message.author.global_name || message.author.username);
  const isSys = isSystemMessage(message);
  const canReact = Boolean(token) && authMode === 'bot';

  const react = useCallback((emoji: string) => {
    if (!canReact) {
      setError('Reactions require bot-token mode.');
      return;
    }
    addReaction(token!, message.channel_id, message.id, emoji)
      .catch((err: Error) => setError(err.message || 'Failed to add reaction'));
  }, [canReact, token, message.channel_id, message.id, setError]);

  if (isSys) {
    return (
      <div className="px-[76px] py-1 text-on-surface-variant text-body-small flex items-center gap-1.5">
        <span aria-hidden="true">→</span>
        <span>
          <strong className="text-on-surface font-medium">{authorName}</strong>{' '}
          {systemMessageVerb(message.type)}
        </span>
        <span className="text-label-small ml-1">{formatShortTimestamp(message.timestamp)}</span>
      </div>
    );
  }

  return (
    <div
      className={`group message-hover relative flex px-4 ${isGrouped ? 'py-[2px]' : 'pt-[2px] pb-[2px]'}`}
      style={{ marginTop: isGrouped ? undefined : `${compactMode ? 4 : spacing}px` }}
    >
      {/* Hover action bar — elevation 3, shaped like an M3 surface container. */}
      <div className="msg-actions flex">
        <button
          type="button"
          title="Add 👍 reaction"
          aria-label="Add thumbs up reaction"
          onClick={() => react('👍')}
        >
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
          src={avatarUrl}
          alt=""
          className="w-10 h-10 rounded-full flex-shrink-0 cursor-pointer mr-4 mt-0.5
            bg-surface-container-highest transition-shadow duration-200 ease-emphasized hover:shadow-lg"
          onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
        />
      )}

      <div className="flex-1 min-w-0">
        {!isGrouped && (
          <div className="flex items-baseline gap-1.5 leading-[22px] flex-wrap">
            <span className="text-title-small text-on-surface font-medium hover:underline cursor-pointer">
              {authorName}
            </span>
            {message.author.bot && (
              <span className="bg-primary-container text-on-primary-container text-[10px] font-medium
                px-1.5 py-[1px] rounded-m3-xs leading-[14px] uppercase tracking-[0.03em] align-middle">
                Bot
              </span>
            )}
            <span className="text-label-small text-on-surface-variant">{formatMessageTimestamp(message.timestamp)}</span>
            {message.edited_timestamp && (
              <span className="text-label-small text-on-surface-variant/70" title="Edited">(edited)</span>
            )}
          </div>
        )}

        {message.referenced_message && (
          <div className="flex items-center gap-1.5 text-body-small text-on-surface-variant mb-1 max-w-[520px]">
            <span
              aria-hidden="true"
              className="w-[26px] h-[10px] border-l-2 border-t-2 border-outline rounded-tl-sm ml-3 flex-shrink-0"
            />
            <img
              src={getUserAvatarUrl(message.referenced_message.author.id, message.referenced_message.author.avatar, message.referenced_message.author.discriminator)}
              className="w-4 h-4 rounded-full flex-shrink-0"
              alt=""
            />
            <span className="text-label-small font-medium text-on-surface hover:underline cursor-pointer truncate flex-shrink-0">
              {userSettings.streamerMode ? 'Hidden User' : message.referenced_message.author.username}
            </span>
            <span className="text-label-small truncate hover:text-on-surface cursor-pointer">
              {message.referenced_message.content || 'Click to see attachment'}
            </span>
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
                const w = Math.min(att.width || 400, 400);
                const h = Math.min(att.height || 300, 300);
                return (
                  <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="block w-fit max-w-full">
                    <img
                      src={att.proxy_url || att.url}
                      alt={att.filename}
                      className="rounded-m3-lg cursor-pointer bg-surface-container-highest
                        transition-shadow duration-200 ease-emphasized hover:shadow-lg"
                      style={{ maxWidth: `${w}px`, maxHeight: `${h}px` }}
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
                    <p className="text-label-small text-on-surface-variant tabular-nums">
                      {(att.size / 1024).toFixed(1)} KB
                    </p>
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
                className="relative rounded-m3-md bg-surface-container max-w-[520px] overflow-hidden
                  ring-1 ring-outline-variant grid"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : 'var(--color-outline-variant)' }}
                />
                <div className="p-3 pl-4 overflow-hidden">
                  {embed.author && (
                    <div className="flex items-center gap-2 mb-1">
                      {embed.author.icon_url && <img src={embed.author.icon_url} className="w-6 h-6 rounded-full" alt="" />}
                      <span className="text-label-large text-on-surface">{embed.author.name}</span>
                    </div>
                  )}
                  {embed.title && (
                    <p className="text-primary text-title-small hover:underline cursor-pointer">
                      {embed.url
                        ? <a href={embed.url} target="_blank" rel="noopener noreferrer">{embed.title}</a>
                        : embed.title}
                    </p>
                  )}
                  {embed.description && (
                    <p className="text-body-small text-on-surface mt-1 leading-[18px]" style={{ whiteSpace: 'pre-line' }}>
                      {embed.description}
                    </p>
                  )}
                  {embed.fields && embed.fields.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {embed.fields.map((f, fi) => (
                        <div key={fi} className={f.inline ? '' : 'col-span-3'}>
                          <p className="text-label-small text-on-surface">{f.name}</p>
                          <p className="text-body-small text-on-surface-variant">{f.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {embed.image && <img src={embed.image.url} className="mt-2 rounded-m3-sm max-w-full max-h-[300px]" alt="" />}
                  {embed.thumbnail && !embed.image && (
                    <img src={embed.thumbnail.url} className="absolute top-3 right-3 rounded-m3-sm w-20 h-20 object-cover" alt="" />
                  )}
                  {embed.footer && (
                    <div className="flex items-center gap-2 mt-2 text-label-small text-on-surface-variant">
                      {embed.footer.icon_url && <img src={embed.footer.icon_url} className="w-5 h-5 rounded-full" alt="" />}
                      <span>{embed.footer.text}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {message.reactions && message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {message.reactions.map((r, i) => (
              <ReactionChip
                key={i}
                emojiUrl={r.emoji.id ? `https://cdn.discordapp.com/emojis/${r.emoji.id}.png?size=16` : null}
                emojiName={r.emoji.name}
                count={r.count}
                mine={Boolean(r.me)}
                disabled={!canReact}
                onClick={() => react(r.emoji.name || '👍')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

function WelcomeMsg({ channel }: { channel?: Channel }) {
  const isNsfw = Boolean(channel?.nsfw);
  return (
    <div className="px-4 pb-4 pt-16">
      <div className="w-[68px] h-[68px] rounded-m3-xl bg-secondary-container flex items-center justify-center mb-4 elev-1">
        {isNsfw
          ? <Lock size={36} className="text-on-secondary-container" />
          : <Hash size={40} className="text-on-secondary-container" />}
      </div>
      <h1 className="text-headline-small font-bold text-on-surface mb-1.5 leading-tight">
        Welcome to #{channel?.name || 'channel'}!
      </h1>
      <p className="text-body-large text-on-surface-variant max-w-2xl">
        This is the start of the <strong className="font-medium text-on-surface">#{channel?.name || 'channel'}</strong> channel.
        {channel?.topic ? ` ${channel.topic}` : ''}
      </p>
    </div>
  );
}

export default function MessageArea() {
  const { selectedChannelId, selectedGuildId, channels, messages, members, roles, user, isLoadingMessages, isLoadingMoreMessages, isSendingMessages, sendMessage: send, loadMoreMessages, toggleMemberList, showMemberList, typingUsers, userSettings } = useStore();
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const guildCh = selectedGuildId ? channels[selectedGuildId] || [] : [];
  const guildMembers = selectedGuildId ? members[selectedGuildId] || [] : [];
  const guildRoles = selectedGuildId ? roles[selectedGuildId] || [] : [];

  // Built once per guild/channel change so mention, role, channel and emoji
  // markup can resolve to real names instead of generic placeholders.
  const mdContext = useMemo<MarkdownContext>(() => ({
    members: guildMembers,
    roles: guildRoles,
    channels: guildCh,
    currentUserId: user?.id ?? null,
    streamerMode: userSettings.streamerMode,
  }), [guildMembers, guildRoles, guildCh, user?.id, userSettings.streamerMode]);

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
  const ch = guildCh.find((c) => c.id === selectedChannelId);
  const isSending = selectedChannelId ? Boolean(isSendingMessages[selectedChannelId]) : false;
  const typing = (selectedChannelId ? typingUsers[selectedChannelId] || [] : []).filter((t) => Date.now() - t.timestamp < 10000);

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
    const msg = input;
    const sendingFiles = files;
    setInput('');
    setFiles([]);
    try {
      await send(selectedChannelId, msg, sendingFiles);
    } catch {
      // Restore the draft so a failed send does not lose what was typed.
      setInput(msg);
      setFiles(sendingFiles);
    }
  };

  if (!selectedChannelId) {
    return (
      <div className="flex-1 bg-surface-container-high flex items-center justify-center min-h-0">
        <div className="text-center text-on-surface-variant animate-fade-in px-6">
          <div className="w-20 h-20 mx-auto mb-5 rounded-m3-xl bg-surface-container-highest flex items-center justify-center">
            <Hash size={38} className="text-on-surface-variant/60" />
          </div>
          <p className="text-title-large text-on-surface">No channel selected</p>
          <p className="text-body-medium mt-1.5 max-w-xs mx-auto">Select a text channel to start chatting.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface-container-high flex flex-col min-w-0 min-h-0">
      {/* Top app bar */}
      <div className="h-12 px-3 flex items-center justify-between flex-shrink-0 elev-1 bg-surface-container-high z-10">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {ch?.nsfw
            ? <Lock size={19} className="text-on-surface-variant flex-shrink-0" />
            : <Hash size={20} className="text-on-surface-variant flex-shrink-0" />}
          <h3 className="font-medium text-on-surface text-title-small truncate">{ch?.name || 'channel'}</h3>
          {ch?.topic && (
            <>
              <div className="w-px h-6 bg-outline-variant mx-1.5 flex-shrink-0" aria-hidden="true" />
              <p className="text-body-small text-on-surface-variant truncate">{ch.topic}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <button
            type="button"
            onClick={toggleMemberList}
            data-ripple
            title="Toggle member list"
            aria-label="Toggle member list"
            aria-pressed={showMemberList}
            className={`m3-interactive w-9 h-9 flex items-center justify-center rounded-full transition-colors duration-200 ease-standard
              ${showMemberList ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            <Users size={20} />
          </button>
          <div className="relative ml-1">
            <input
              type="text"
              data-app-search="true"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search messages in this channel"
              className="w-[132px] focus:w-[196px] bg-surface-container-lowest text-on-surface text-body-small
                rounded-m3-sm h-8 px-2.5 outline-none placeholder:text-on-surface-variant/70
                focus:outline focus:outline-2 focus:outline-primary
                transition-[width,outline-color] duration-300 ease-emphasized"
            />
            <Search size={15} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Messages */}
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
            <WelcomeMsg channel={ch} />
            {normalizedSearch && (
              <div className="px-4 py-2 mx-4 mb-2 rounded-m3-sm bg-surface-container text-body-small text-on-surface-variant">
                Showing {shownMessages.length} result{shownMessages.length === 1 ? '' : 's'} for “{searchQuery}”.
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="ml-2 text-primary hover:underline font-medium"
                >
                  Clear
                </button>
              </div>
            )}
            {shownMessages.map((msg, i) => {
              const prev = i > 0 ? shownMessages[i - 1] : null;
              const grouped = prev ? shouldGroupMessages(prev, msg) : false;
              const dateDivider = !prev || !isSameDay(new Date(prev.timestamp), new Date(msg.timestamp));
              return (
                <div key={msg.id}>
                  {dateDivider && <DateDivider date={new Date(msg.timestamp)} />}
                  <MessageRow
                    message={msg}
                    isGrouped={grouped && !dateDivider}
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

      {/* Typing indicator */}
      <div className="h-6 px-4 flex items-center flex-shrink-0" aria-live="polite">
        {typing.length > 0 && (
          <div className="flex items-center gap-2 text-label-small text-on-surface-variant animate-fade-in-fast">
            <div className="flex gap-[3px]" aria-hidden="true">
              <span className="w-[6px] h-[6px] bg-on-surface-variant rounded-full typing-dot" />
              <span className="w-[6px] h-[6px] bg-on-surface-variant rounded-full typing-dot" />
              <span className="w-[6px] h-[6px] bg-on-surface-variant rounded-full typing-dot" />
            </div>
            <span>
              <strong className="font-medium text-on-surface">{typing.map((t) => t.username).join(', ')}</strong>{' '}
              {typing.length === 1 ? 'is' : 'are'} typing…
            </span>
          </div>
        )}
      </div>

      <Composer
        input={input}
        setInput={setInput}
        onSubmit={handleSend}
        placeholder={`Message #${ch?.name || 'channel'}`}
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
