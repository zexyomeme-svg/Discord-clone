import { describe, expect, it } from 'vitest';
import { escapeHtml, formatTimestamp, renderMarkdown, type MarkdownContext } from '../src/utils/markdown';

/** Tags renderMarkdown is allowed to emit. Anything else means injection. */
const ALLOWED_TAGS = new Set([
  'pre', 'code', 'strong', 'em', 'u', 'del', 'blockquote', 'a', 'span',
  'img', 'br', 'time',
]);

/**
 * The exact attribute set each tag may carry. Asserting an allowlist per tag is
 * far stronger than grepping the output for "onerror": escaped payload text such
 * as `&lt;img src=x onerror=alert(1)&gt;` legitimately contains those characters
 * while being completely inert, so a raw-text grep produces false positives.
 */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  pre: new Set(['data-lang']),
  code: new Set(),
  strong: new Set(),
  em: new Set(),
  u: new Set(),
  del: new Set(),
  blockquote: new Set(),
  br: new Set(),
  a: new Set(['href', 'target', 'rel']),
  span: new Set(['class', 'style']),
  img: new Set(['class', 'src', 'alt', 'title', 'loading']),
  time: new Set(['class', 'datetime']),
};

/** URL-bearing attributes must only ever point at http(s) or the Discord CDN. */
function assertSafeUrl(value: string): boolean {
  return /^(https?:\/\/|data:image\/)/i.test(value.trim());
}

/** Extract every tag name that survived into the output as *live* markup. */
function liveTagNames(html: string): string[] {
  const names: string[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) names.push(match[1].toLowerCase());
  return names;
}

/** Attributes that appear as live markup (not entity-encoded text). */
function liveAttributes(html: string): Array<{ tag: string; name: string; value: string }> {
  const out: Array<{ tag: string; name: string; value: string }> = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\/?>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(html)) !== null) {
    const tag = tagMatch[1].toLowerCase();
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(tagMatch[2])) !== null) {
      out.push({ tag, name: attrMatch[1].toLowerCase(), value: attrMatch[2] });
    }
  }
  return out;
}

const ctx: MarkdownContext = {
  mentions: [{ id: '111111111111111111', username: 'alice', global_name: 'Alice' }],
  members: [
    { user: { id: '222222222222222222', username: 'bob', global_name: null }, nick: 'Bobby' },
  ],
  roles: [{ id: '333333333333333333', name: 'Moderators', color: 0x5865f2 }],
  channels: [{ id: '444444444444444444', name: 'general' }],
  currentUserId: '111111111111111111',
};

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('is idempotent-safe for undefined/null coercion', () => {
    expect(escapeHtml(undefined as unknown as string)).toBe('');
    expect(escapeHtml(null as unknown as string)).toBe('');
  });
});

describe('renderMarkdown — Discord constructs', () => {
  // These five were completely broken before: the old renderer escaped the
  // content first and then matched a literal "<", so none of them ever fired.
  it('renders a user mention with the resolved display name', () => {
    const html = renderMarkdown('hey <@111111111111111111>!', ctx);
    expect(html).toContain('class="msg-mention msg-mention-self"');
    expect(html).toContain('@Alice');
    expect(html).not.toContain('&lt;@111');
  });

  it('prefers a guild nickname over the global name', () => {
    const html = renderMarkdown('<@222222222222222222>', ctx);
    expect(html).toContain('@Bobby');
  });

  it('marks the legacy nick-mention form <@!id>', () => {
    const html = renderMarkdown('<@!222222222222222222>', ctx);
    expect(html).toContain('@Bobby');
  });

  it('renders a role mention with its colour', () => {
    const html = renderMarkdown('<@&333333333333333333>', ctx);
    expect(html).toContain('@Moderators');
    expect(html).toContain('#5865f2');
  });

  it('renders a channel mention', () => {
    const html = renderMarkdown('see <#444444444444444444>', ctx);
    expect(html).toContain('#general');
    expect(html).toContain('msg-mention-channel');
  });

  it('falls back to a muted style for unresolvable ids', () => {
    const html = renderMarkdown('<@999999999999999999> <@&999999999999999999>', ctx);
    expect(html).toContain('msg-mention-unknown');
    expect(html).toContain('@Unknown User');
    expect(html).toContain('@role');
  });

  it('renders a static custom emoji as a png', () => {
    const html = renderMarkdown('nice <:blobcat:123456789012345678>', ctx);
    expect(html).toContain('https://cdn.discordapp.com/emojis/123456789012345678.png');
    expect(html).toContain('alt=":blobcat:"');
  });

  it('renders an animated custom emoji as a gif', () => {
    const html = renderMarkdown('<a:party:123456789012345678>', ctx);
    expect(html).toContain('https://cdn.discordapp.com/emojis/123456789012345678.gif');
  });

  it('renders a blockquote', () => {
    const html = renderMarkdown('> quoted line', ctx);
    expect(html).toContain('<blockquote>quoted line</blockquote>');
  });

  it('merges consecutive blockquote lines', () => {
    const html = renderMarkdown('> one\n> two\nplain', ctx);
    expect(html).toContain('<blockquote>one<br>two</blockquote>');
    expect(html).toContain('plain');
  });

  it('renders @everyone and @here as emphasised mentions', () => {
    const html = renderMarkdown('@everyone wake up @here', ctx);
    expect(html.match(/msg-mention-self/g)?.length).toBe(2);
  });

  it('renders <t:unix:style> timestamps', () => {
    const html = renderMarkdown('at <t:1700000000:F>', ctx);
    expect(html).toContain('<time class="msg-timestamp"');
    expect(html).toContain('datetime="2023-11-14T22:13:20.000Z"');
    expect(html).not.toContain('&lt;t:');
  });

  it('renders relative timestamps without throwing', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => renderMarkdown(`<t:${now - 3600}:R>`, ctx)).not.toThrow();
    expect(renderMarkdown(`<t:${now - 3600}:R>`, ctx)).toContain('hour');
  });

  it('survives an out-of-range timestamp instead of throwing a RangeError', () => {
    expect(() => renderMarkdown('<t:99999999999999999:F>', ctx)).not.toThrow();
  });
});

describe('renderMarkdown — text formatting', () => {
  it('renders bold, underline, strikethrough and spoiler', () => {
    const html = renderMarkdown('**b** __u__ ~~s~~ ||hidden||', ctx);
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<u>u</u>');
    expect(html).toContain('<del>s</del>');
    expect(html).toContain('<span class="msg-spoiler">hidden</span>');
  });

  it('renders single-asterisk italics without eating bold', () => {
    expect(renderMarkdown('*it*', ctx)).toContain('<em>it</em>');
    expect(renderMarkdown('**bold**', ctx)).not.toContain('<em>');
  });

  it('renders ***bold italic*** as both', () => {
    const html = renderMarkdown('***both***', ctx);
    expect(html).toContain('<strong><em>both</em></strong>');
    expect(html).not.toContain('*');
  });

  it('renders inline underscores as italics but not inside words', () => {
    expect(renderMarkdown('_it_', ctx)).toContain('<em>it</em>');
    expect(renderMarkdown('snake_case_name', ctx)).not.toContain('<em>');
  });

  it('renders headings h1-h3', () => {
    expect(renderMarkdown('# one', ctx)).toContain('msg-h1');
    expect(renderMarkdown('## two', ctx)).toContain('msg-h2');
    expect(renderMarkdown('### three', ctx)).toContain('msg-h3');
  });

  it('autolinks http(s) URLs with noopener/noreferrer', () => {
    const html = renderMarkdown('go to https://example.com/a?b=1&c=2', ctx);
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('does not autolink non-http schemes', () => {
    const html = renderMarkdown('javascript:alert(1) and ftp://x.com', ctx);
    expect(html).not.toContain('<a href');
  });

  it('converts newlines to <br>', () => {
    expect(renderMarkdown('a\nb', ctx)).toBe('a<br>b');
  });
});

describe('renderMarkdown — code protection', () => {
  it('does not transform markup inside a fenced code block', () => {
    const html = renderMarkdown('```js\n**not bold** <@111111111111111111>\n```', ctx);
    expect(html).toContain('<pre data-lang="js"><code>');
    expect(html).toContain('**not bold**');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('msg-mention');
  });

  it('does not transform markup inside inline code', () => {
    const html = renderMarkdown('use `**literal**` here', ctx);
    expect(html).toContain('<code>**literal**</code>');
    expect(html).not.toContain('<strong>');
  });

  it('does not autolink inside a code fence', () => {
    const html = renderMarkdown('```\nhttps://example.com\n```', ctx);
    expect(html).not.toContain('<a href');
  });

  it('escapes HTML inside code blocks', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```', ctx);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
  });
});

/**
 * Assert the full structural safety invariant of a rendered fragment:
 * only whitelisted tags, only whitelisted attributes per tag, and no URL-bearing
 * attribute pointing anywhere but http(s) / the Discord CDN.
 */
function assertSafeHtml(html: string) {
  for (const tag of liveTagNames(html)) {
    expect(ALLOWED_TAGS.has(tag), `unexpected live tag <${tag}> in: ${html}`).toBe(true);
  }
  for (const attr of liveAttributes(html)) {
    const allowed = ALLOWED_ATTRIBUTES[attr.tag];
    expect(allowed, `no attribute allowlist for <${attr.tag}>`).toBeDefined();
    expect(
      allowed!.has(attr.name),
      `attribute ${attr.name} not allowed on <${attr.tag}> in: ${html}`,
    ).toBe(true);
    if (attr.name === 'href' || attr.name === 'src') {
      expect(assertSafeUrl(attr.value), `unsafe ${attr.name}="${attr.value}"`).toBe(true);
    }
    if (attr.name === 'style') {
      expect(attr.value).toMatch(/^color:#[0-9a-f]{6}$/);
    }
  }
}

describe('renderMarkdown — XSS resistance', () => {
  const payloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(document.cookie)</script>',
    'https://x.com/" onmouseover="alert(1)',
    'javascript:alert(1)',
    "https://x.com/a' onerror='alert(1)",
    '<a href="javascript:alert(1)">click</a>',
    '<svg/onload=alert(1)>',
    '"><iframe src=//evil.com></iframe>',
    '$&$1$$ injection via replace pattern',
    '**bold <script>alert(1)</script>**',
    '`<img src=x onerror=alert(1)>`',
    '<@111111111111111111 onmouseover=alert(1)>',
    '<:emoji:123456789012345678" onerror="alert(1)>',
    '<t:1700000000:R" onload="alert(1)>',
    '> <script>alert(1)</script>',
    '\uE0000\uE001 forged sentinel',
    '<SCRIPT SRC=//evil.com/x.js></SCRIPT>',
    '<body onload=alert(1)>',
    '<img src="x" onerror="alert(1)"',
    '[link](javascript:alert(1))',
  ];

  for (const payload of payloads) {
    it(`neutralises ${JSON.stringify(payload.slice(0, 48))}`, () => {
      const html = renderMarkdown(payload, ctx);

      // Only whitelisted tags may exist as live markup.
      for (const tag of liveTagNames(html)) {
        expect(ALLOWED_TAGS.has(tag), `unexpected live tag <${tag}> in: ${html}`).toBe(true);
      }

      // Every live attribute must be on the per-tag allowlist. This is what
      // actually rules out an injected event handler or a javascript: URL.
      for (const attr of liveAttributes(html)) {
        const allowed = ALLOWED_ATTRIBUTES[attr.tag];
        expect(allowed, `unexpected live tag <${attr.tag}> in: ${html}`).toBeDefined();
        expect(
          allowed!.has(attr.name),
          `attribute ${attr.name} not allowed on <${attr.tag}> in: ${html}`,
        ).toBe(true);

        if (attr.name === 'href' || attr.name === 'src') {
          expect(assertSafeUrl(attr.value), `unsafe ${attr.name}="${attr.value}" in: ${html}`).toBe(true);
        }
        if (attr.name === 'src' && attr.tag === 'img') {
          expect(attr.value.startsWith('https://cdn.discordapp.com/emojis/')).toBe(true);
        }
        if (attr.name === 'style') {
          // The only style we emit is a role colour.
          expect(attr.value).toMatch(/^color:#[0-9a-f]{6}$/);
        }
      }

      // A live <script> element would already have been caught by the tag
      // allowlist; this is a cheap belt-and-braces check.
      expect(liveTagNames(html)).not.toContain('script');
    });
  }

  it('cannot be tricked by a forged placeholder sentinel', () => {
    // The renderer strips sentinel characters from input before use, so an
    // author cannot forge a code-placeholder index and pull HTML out of the
    // internal store.
    const html = renderMarkdown('\uE0000\uE001\uE00099\uE001', ctx);
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('<code');
  });

  it('escapes resolved names coming from Discord data', () => {
    const evil: MarkdownContext = {
      mentions: [{ id: '111111111111111111', username: '<img src=x onerror=alert(1)>' }],
      roles: [{ id: '333333333333333333', name: '"><script>alert(1)</script>', color: 1 }],
      channels: [{ id: '444444444444444444', name: '"><iframe src=//evil>' }],
    };
    const html = renderMarkdown(
      '<@111111111111111111> <@&333333333333333333> <#444444444444444444>',
      evil,
    );
    assertSafeHtml(html);
    // The hostile names must still be *visible* to the reader, just inert.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;iframe src=//evil&gt;');
  });
});

describe('renderMarkdown — edge cases', () => {
  it('returns an empty string for empty or nullish input', () => {
    expect(renderMarkdown('', ctx)).toBe('');
    expect(renderMarkdown(undefined as unknown as string, ctx)).toBe('');
    expect(renderMarkdown(null as unknown as string, ctx)).toBe('');
  });

  it('works with no context at all', () => {
    expect(renderMarkdown('**hi**')).toContain('<strong>hi</strong>');
  });

  it('honours streamer mode by masking names', () => {
    const html = renderMarkdown('<@111111111111111111> <#444444444444444444>', {
      ...ctx,
      streamerMode: true,
    });
    expect(html).toContain('@Hidden User');
    expect(html).toContain('#hidden-channel');
    expect(html).not.toContain('Alice');
    expect(html).not.toContain('general');
  });
});

describe('formatTimestamp', () => {
  it('supports every Discord style flag', () => {
    for (const style of ['t', 'T', 'd', 'D', 'F', 'R', undefined]) {
      expect(() => formatTimestamp('1700000000', style)).not.toThrow();
      expect(formatTimestamp('1700000000', style)).not.toBe('');
    }
  });

  it('returns the raw input for a non-numeric value', () => {
    expect(formatTimestamp('not-a-number')).toBe('not-a-number');
  });
});
