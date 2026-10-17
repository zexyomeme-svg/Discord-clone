/**
 * Discord message markdown renderer.
 *
 * SECURITY MODEL
 * --------------
 * The output of `renderMarkdown` is injected with `dangerouslySetInnerHTML`, so
 * every character of untrusted Discord content must be neutralised before it can
 * reach the DOM. The strategy is:
 *
 *   1. Strip any sentinel characters that appear in the raw input, so an author
 *      cannot forge one of our internal placeholders.
 *   2. Pull code fences / inline code out of the string and replace them with
 *      sentinels, so no later transform can rewrite markup *inside* code.
 *   3. HTML-escape everything that remains (`& < > " '`).
 *   4. Apply Discord's own markup transforms to the escaped text. Because `<`
 *      and `>` are now `&lt;` / `&gt;`, these patterns MUST match the escaped
 *      forms — this was the bug in the previous implementation, which matched
 *      literal `<...>` and therefore never fired.
 *   5. Re-insert the (already escaped) code placeholders.
 *
 * All replacements use a replacer *function*, never a `$1` template string, so
 * `$&` / `$1` sequences inside user content cannot be re-expanded.
 *
 * Any value that did not come from the message body (resolved usernames, role
 * names, channel names) is escaped again at insertion time.
 */

/** Characters used as internal placeholders. Removed from input up front. */
const SENTINEL_START = '\uE000';
const SENTINEL_END = '\uE001';

/** Snowflake IDs are 17-19 digits in practice; allow a generous range. */
const SNOWFLAKE = '\\d{15,25}';

/** Emoji names are 2-32 characters of word chars per Discord's docs. */
const EMOJI_NAME = '[\\w]{2,32}';

export interface MentionLike {
  id: string;
  username?: string;
  global_name?: string | null;
}

export interface MemberLike {
  user?: MentionLike;
  nick?: string | null;
}

export interface RoleLike {
  id: string;
  name: string;
  color?: number;
}

export interface ChannelLike {
  id: string;
  name?: string;
}

export interface MarkdownContext {
  /** `message.mentions` — users the message actually mentions. */
  mentions?: MentionLike[];
  /** Guild member list, used to resolve mentions not in `mentions`. */
  members?: MemberLike[];
  /** Guild role list, used to resolve `<@&id>` role mentions. */
  roles?: RoleLike[];
  /** Guild channel list, used to resolve `<#id>` channel mentions. */
  channels?: ChannelLike[];
  /** The signed-in user, so `<@me>`-style self mentions can be highlighted. */
  currentUserId?: string | null;
  /** Hide identifying names (Settings → Streamer Mode). */
  streamerMode?: boolean;
}

/** Escape a string for safe insertion into HTML text or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripSentinels(value: string): string {
  return value.replace(new RegExp(`${SENTINEL_START}|${SENTINEL_END}`, 'g'), '');
}

function displayName(user: MentionLike | undefined, nick?: string | null): string {
  if (!user) return 'Unknown User';
  return nick || user.global_name || user.username || 'Unknown User';
}

function resolveUser(id: string, ctx: MarkdownContext): { name: string; known: boolean } {
  const fromMentions = ctx.mentions?.find((m) => m.id === id);
  if (fromMentions) return { name: displayName(fromMentions), known: true };

  const member = ctx.members?.find((m) => m.user?.id === id);
  if (member?.user) return { name: displayName(member.user, member.nick), known: true };

  return { name: 'Unknown User', known: false };
}

function resolveRole(id: string, ctx: MarkdownContext): { name: string; color: number } | null {
  const role = ctx.roles?.find((r) => r.id === id);
  if (!role) return null;
  return { name: role.name || 'role', color: role.color || 0 };
}

function resolveChannel(id: string, ctx: MarkdownContext): string | null {
  const channel = ctx.channels?.find((c) => c.id === id);
  return channel?.name || null;
}

function roleColorStyle(color: number): string {
  if (!color) return '';
  // Clamp to a 24-bit RGB hex value; `color` is a number from Discord.
  const hex = (color & 0xffffff).toString(16).padStart(6, '0');
  return ` style="color:#${hex}"`;
}

/**
 * Format a Discord `<t:unix:style>` timestamp into a readable local string.
 * Falls back to the raw unix time when the value is not a finite number.
 */
export function formatTimestamp(unix: string, style?: string): string {
  const seconds = Number(unix);
  if (!Number.isFinite(seconds)) return unix;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return unix;

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateText = date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

  switch (style) {
    case 'R': {
      const diff = date.getTime() - Date.now();
      const abs = Math.abs(diff);
      const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
        [1000 * 60 * 60 * 24 * 365, 'year'],
        [1000 * 60 * 60 * 24 * 30, 'month'],
        [1000 * 60 * 60 * 24, 'day'],
        [1000 * 60 * 60, 'hour'],
        [1000 * 60, 'minute'],
      ];
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      for (const [ms, unit] of units) {
        if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
      }
      return rtf.format(Math.round(diff / 1000), 'second');
    }
    case 'T':
      return time;
    case 'D':
      return dateText;
    case 'F':
      return `${dateText} ${time}`;
    case 'd':
      return date.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
    case 't':
    default:
      return time;
  }
}

/**
 * Render Discord message content to safe HTML.
 *
 * Supports: code fences, inline code, bold, italic, underline, strikethrough,
 * spoilers, blockquotes, headings, autolinks, user/role/channel mentions,
 * custom emoji, and `<t:...>` timestamps.
 */
export function renderMarkdown(content: string, ctx: MarkdownContext = {}): string {
  if (!content) return '';

  const raw = stripSentinels(String(content));

  // -- 1. Protect code so nothing inside it is transformed -------------------
  const codeStore: string[] = [];
  const stash = (html: string): string => {
    const index = codeStore.push(html) - 1;
    return `${SENTINEL_START}${index}${SENTINEL_END}`;
  };

  let text = raw;

  // Fenced code blocks: ```lang\ncode``` (language tag optional).
  text = text.replace(/```([\w+#-]*)\n?([\s\S]*?)```/g, (_m, lang: string, body: string) =>
    stash(
      `<pre data-lang="${escapeHtml(lang || '')}"><code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`,
    ),
  );

  // Inline code: `code`
  text = text.replace(/`([^`\n]+)`/g, (_m, body: string) => stash(`<code>${escapeHtml(body)}</code>`));

  // -- 2. Escape everything that is left ------------------------------------
  text = escapeHtml(text);

  // -- 3. Discord markup, matched against the ESCAPED forms ------------------

  // Everyone / here. Done before name resolution so a user literally named
  // "everyone" cannot be double-wrapped by the mention pass below.
  text = text.replace(/@everyone\b/g, '<span class="msg-mention msg-mention-self">@everyone</span>');
  text = text.replace(/@here\b/g, '<span class="msg-mention msg-mention-self">@here</span>');

  // Custom emoji: <:name:id> and <a:name:id> (animated).
  text = text.replace(
    new RegExp(`&lt;(a?):(${EMOJI_NAME}):(${SNOWFLAKE})&gt;`, 'g'),
    (_m, animated: string, name: string, id: string) => {
      const ext = animated === 'a' ? 'gif' : 'png';
      const safeName = escapeHtml(name);
      return `<img class="msg-emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=32" alt=":${safeName}:" title=":${safeName}:" loading="lazy" />`;
    },
  );

  // Role mentions: <@&id>  (the `&` is escaped to `&amp;`).
  text = text.replace(new RegExp(`&lt;@&amp;(${SNOWFLAKE})&gt;`, 'g'), (_m, id: string) => {
    const role = resolveRole(id, ctx);
    if (!role) return `<span class="msg-mention msg-mention-unknown">@role</span>`;
    const label = ctx.streamerMode ? 'Hidden Role' : role.name;
    return `<span class="msg-mention"${roleColorStyle(role.color)}>@${escapeHtml(label)}</span>`;
  });

  // User mentions: <@id> and the legacy nick form <@!id>.
  text = text.replace(new RegExp(`&lt;@!?(${SNOWFLAKE})&gt;`, 'g'), (_m, id: string) => {
    const { name, known } = resolveUser(id, ctx);
    const label = ctx.streamerMode ? 'Hidden User' : name;
    const isSelf = ctx.currentUserId != null && ctx.currentUserId === id;
    const classes = [
      'msg-mention',
      known ? '' : 'msg-mention-unknown',
      isSelf ? 'msg-mention-self' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<span class="${classes}">@${escapeHtml(label)}</span>`;
  });

  // Channel mentions: <#id>
  text = text.replace(new RegExp(`&lt;#(${SNOWFLAKE})&gt;`, 'g'), (_m, id: string) => {
    const name = resolveChannel(id, ctx);
    const label = ctx.streamerMode ? 'hidden-channel' : name || 'deleted-channel';
    return `<span class="msg-mention msg-mention-channel">#${escapeHtml(label)}</span>`;
  });

  // Timestamps: <t:1700000000:R>
  text = text.replace(
    /&lt;t:(-?\d{1,17})(?::([RrDdTtFf]))?&gt;/g,
    (_m, unix: string, style?: string) => {
      const label = formatTimestamp(unix, style);
      const date = new Date(Number(unix) * 1000);
      // toISOString() throws a RangeError for out-of-range dates.
      let iso = '';
      try {
        iso = date.toISOString();
      } catch {
        iso = '';
      }
      return `<time class="msg-timestamp" datetime="${escapeHtml(iso)}">${escapeHtml(label)}</time>`;
    },
  );

  // Headings: `# text` .. `### text` (Discord supports h1-h3).
  text = text.replace(/^### (.+)$/gm, '<span class="msg-h msg-h3">$1</span>');
  text = text.replace(/^## (.+)$/gm, '<span class="msg-h msg-h2">$1</span>');
  text = text.replace(/^# (.+)$/gm, '<span class="msg-h msg-h1">$1</span>');

  // Blockquotes. `>` is escaped to `&gt;`. Consecutive quoted lines merge.
  text = text.replace(/^(?:&gt; ?(?:.*\n?))+/gm, (block) => {
    const inner = block
      .split('\n')
      .map((line) => line.replace(/^&gt; ?/, ''))
      .join('\n')
      .replace(/\n$/, '');
    return `<blockquote>${inner}</blockquote>`;
  });

  // Bold, then underline, then strikethrough, then spoiler, then italics.
  // Order matters: `***` before `**` before `*`, and `__` before `_`.
  text = text.replace(/\*\*\*([\s\S]+?)\*\*\*/g, (_m, b) => `<strong><em>${b}</em></strong>`);
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, (_m, b) => `<strong>${b}</strong>`);
  text = text.replace(/__([\s\S]+?)__/g, (_m, b) => `<u>${b}</u>`);
  text = text.replace(/~~([\s\S]+?)~~/g, (_m, b) => `<del>${b}</del>`);
  text = text.replace(/\|\|([\s\S]+?)\|\|/g, (_m, b) => `<span class="msg-spoiler">${b}</span>`);
  text = text.replace(/(^|[^*_\\])\*([^*\n]+?)\*(?!\*)/g, (_m, pre: string, b: string) => `${pre}<em>${b}</em>`);
  text = text.replace(/(^|[^_\w\\])_([^_\n]+?)_(?!_)/g, (_m, pre: string, b: string) => `${pre}<em>${b}</em>`);

  // Autolinks. Quotes and angle brackets are already escaped, so the match
  // cannot break out of the href attribute. `&` is intentionally allowed so
  // query strings survive (as `&amp;`, which is correct inside an attribute).
  text = text.replace(
    /(https?:\/\/[^\s<]+)/g,
    (_m, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`,
  );

  // Newlines last, so <pre>/<blockquote> content is not double-broken.
  text = text.replace(/\n/g, '<br>');

  // -- 4. Restore protected code --------------------------------------------
  text = text.replace(
    new RegExp(`${SENTINEL_START}(\\d+)${SENTINEL_END}`, 'g'),
    (_m, index: string) => codeStore[Number(index)] ?? '',
  );

  return text;
}

export default renderMarkdown;
