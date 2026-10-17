import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INTENTS,
  GATEWAY_INTENTS,
  MAX_MESSAGE_LENGTH,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  getChannelIconUrl,
  getEmojiUrl,
  getGuildIconUrl,
  getUserAvatarUrl,
  normalizeBotToken,
  validateOutgoingMessage,
  ACTIVITY_TYPES,
  MAX_ACTIVITY_STATE_LENGTH,
  buildCustomStatusActivity,
  buildPresence,
  buildAttributionPresence,
  fetchAppInfo,
} from '../src/services/discordApi';

/** Minimal File stand-in so these tests can run in a node environment. */
function fakeFile(name: string, size: number): File {
  return { name, size } as unknown as File;
}

describe('normalizeBotToken', () => {
  it('strips a leading "Bot " prefix in any casing', () => {
    expect(normalizeBotToken('Bot abc123')).toBe('abc123');
    expect(normalizeBotToken('bot abc123')).toBe('abc123');
    expect(normalizeBotToken('BOT   abc123')).toBe('abc123');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBotToken('  abc123\n')).toBe('abc123');
  });

  it('leaves a bare token untouched', () => {
    expect(normalizeBotToken('abc123')).toBe('abc123');
  });
});

describe('validateOutgoingMessage', () => {
  it('accepts a normal message', () => {
    expect(validateOutgoingMessage('hello', [])).toBeNull();
  });

  it('accepts an attachment-only message', () => {
    expect(validateOutgoingMessage('   ', [fakeFile('a.png', 1024)])).toBeNull();
  });

  it('rejects an empty message', () => {
    expect(validateOutgoingMessage('   ', [])).toMatch(/empty/i);
  });

  it('rejects content over the 2000 character limit', () => {
    const error = validateOutgoingMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1), []);
    expect(error).toContain('2000');
    expect(error).toContain('2001');
  });

  it('accepts content exactly at the limit', () => {
    expect(validateOutgoingMessage('x'.repeat(MAX_MESSAGE_LENGTH), [])).toBeNull();
  });

  it('rejects more than 10 files', () => {
    const files = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, i) => fakeFile(`f${i}.png`, 10));
    expect(validateOutgoingMessage('hi', files)).toMatch(/10 files/);
  });

  // Discord's cap applies to the whole request. The old code checked each file
  // individually, so 10 x 24 MB (240 MB) passed validation and then failed at
  // the API with an opaque error.
  it('rejects when the COMBINED attachment size exceeds 25 MB', () => {
    const files = Array.from({ length: 10 }, () => fakeFile('big.bin', 24 * 1024 * 1024));
    const error = validateOutgoingMessage('hi', files);
    expect(error).toMatch(/25 MB per message/);
    expect(error).toMatch(/240\.0 MB/);
  });

  it('accepts 10 small files whose combined size is under the cap', () => {
    const files = Array.from({ length: 10 }, () => fakeFile('small.png', 1024 * 1024));
    expect(validateOutgoingMessage('hi', files)).toBeNull();
  });

  it('accepts a single file exactly at the cap', () => {
    expect(validateOutgoingMessage('hi', [fakeFile('exact.bin', MAX_UPLOAD_BYTES)])).toBeNull();
  });

  it('rejects a single file just over the cap', () => {
    expect(validateOutgoingMessage('hi', [fakeFile('over.bin', MAX_UPLOAD_BYTES + 1)])).toMatch(/25 MB/);
  });
});

describe('gateway intents', () => {
  it('uses the documented bit positions', () => {
    expect(GATEWAY_INTENTS.GUILDS).toBe(1);
    expect(GATEWAY_INTENTS.GUILD_MEMBERS).toBe(2);
    expect(GATEWAY_INTENTS.GUILD_MESSAGES).toBe(512);
    expect(GATEWAY_INTENTS.DIRECT_MESSAGES).toBe(4096);
    expect(GATEWAY_INTENTS.MESSAGE_CONTENT).toBe(32768);
  });

  it('requests guilds, members, guild messages, DMs and message content', () => {
    expect(DEFAULT_INTENTS).toBe(1 | 2 | 512 | 4096 | 32768);
  });
});

describe('CDN url helpers', () => {
  it('builds an animated guild icon as gif', () => {
    expect(getGuildIconUrl('1', 'a_hash', 128)).toBe('https://cdn.discordapp.com/icons/1/a_hash.gif?size=128');
  });

  it('builds a static guild icon as png and returns null without a hash', () => {
    expect(getGuildIconUrl('1', 'hash')).toBe('https://cdn.discordapp.com/icons/1/hash.png?size=64');
    expect(getGuildIconUrl('1', null)).toBeNull();
    expect(getGuildIconUrl('1', undefined)).toBeNull();
  });

  it('falls back to a default avatar derived from the user id', () => {
    // (id >> 22) % 6 picks one of Discord's 6 default avatars.
    const url = getUserAvatarUrl('80351110224678912', null, '0');
    expect(url).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  });

  it('falls back to the legacy discriminator when present', () => {
    const url = getUserAvatarUrl('1', null, '7');
    expect(url).toBe('https://cdn.discordapp.com/embed/avatars/2.png'); // 7 % 5 === 2
  });

  it('never produces an out-of-range default avatar index', () => {
    const url = getUserAvatarUrl('not-a-snowflake', null, '0');
    expect(url).toBe('https://cdn.discordapp.com/embed/avatars/0.png');
  });

  it('builds a custom avatar url and honours animation', () => {
    expect(getUserAvatarUrl('1', 'a_x', '0', 64)).toBe('https://cdn.discordapp.com/avatars/1/a_x.gif?size=64');
    expect(getUserAvatarUrl('1', 'x', '0', 64)).toBe('https://cdn.discordapp.com/avatars/1/x.png?size=64');
  });

  it('returns null for a group DM without an icon', () => {
    expect(getChannelIconUrl('1', null)).toBeNull();
    expect(getChannelIconUrl('1', 'abc')).toContain('/channel-icons/1/abc.png');
  });

  it('builds emoji urls', () => {
    expect(getEmojiUrl('123', false)).toBe('https://cdn.discordapp.com/emojis/123.png?size=32');
    expect(getEmojiUrl('123', true, 64)).toBe('https://cdn.discordapp.com/emojis/123.gif?size=64');
  });

  it('percent-encodes id/hash values so a crafted value cannot leave the path', () => {
    const url = getGuildIconUrl('1', '../../evil', 64);
    expect(url).not.toContain('/../../');
    expect(url).toContain('..%2F..%2Fevil');
  });
});


// ---------------------------------------------------------------------------
// Custom status (activity type 4) — how the bot names the repository
// ---------------------------------------------------------------------------

describe('ACTIVITY_TYPES', () => {
  it('matches the documented gateway activity type numbers', () => {
    expect(ACTIVITY_TYPES).toEqual({
      PLAYING: 0,
      STREAMING: 1,
      LISTENING: 2,
      WATCHING: 3,
      CUSTOM: 4,
      COMPETING: 5,
    });
  });
});

describe('buildCustomStatusActivity', () => {
  it('builds a type-4 activity whose name is the literal Discord expects', () => {
    // For type 4 the client renders `state`, not `name`; name must be
    // "Custom Status".
    expect(buildCustomStatusActivity('Disclone · github.com/o/r')).toEqual({
      name: 'Custom Status',
      type: 4,
      state: 'Disclone · github.com/o/r',
    });
  });

  it('never emits an activity with a url — bots cannot link a custom status', () => {
    const activity = buildCustomStatusActivity('github.com/o/r');
    expect(activity).not.toBeNull();
    expect('url' in (activity as object)).toBe(false);
  });

  it('collapses whitespace and trims, so the member list is not fed padding', () => {
    expect(buildCustomStatusActivity('  hello   there  ')?.state).toBe('hello there');
  });

  it('truncates to the activity state limit', () => {
    const state = buildCustomStatusActivity('x'.repeat(400))?.state;
    expect(state).toHaveLength(MAX_ACTIVITY_STATE_LENGTH);
  });

  it.each([[''], ['   '], ['\t\n'], [null], [undefined]])(
    'returns null for blank input %s so callers can clear the status instead',
    (input) => {
      expect(buildCustomStatusActivity(input as string | null | undefined)).toBeNull();
    },
  );
});

describe('buildPresence', () => {
  it('wraps an activity in a valid IDENTIFY/STATUS_UPDATE presence payload', () => {
    const activity = buildCustomStatusActivity('hi');
    expect(buildPresence(activity)).toEqual({
      since: null,
      activities: [activity],
      status: 'online',
      afk: false,
    });
  });

  it('honours an explicit status', () => {
    expect(buildPresence(null, 'dnd').status).toBe('dnd');
  });

  it('sends an empty activity list when there is nothing to show', () => {
    // An empty list is what *clears* a custom status on Discord.
    expect(buildPresence(null).activities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Attribution presence — the user-facing opt-out
// ---------------------------------------------------------------------------

describe('buildAttributionPresence', () => {
  const DEFAULT_TEXT = 'Disclone · github.com/o/r · site.onrender.com';

  it('broadcasts the deployment default when the user has not overridden it', () => {
    const presence = buildAttributionPresence({
      broadcastPresence: true,
      presenceText: '',
      defaultText: DEFAULT_TEXT,
    });
    expect(presence?.activities).toHaveLength(1);
    expect(presence?.activities[0].type).toBe(ACTIVITY_TYPES.CUSTOM);
    expect(presence?.activities[0].state).toBe(DEFAULT_TEXT);
    expect(presence?.status).toBe('online');
  });

  it('prefers the user\'s own text over the deployment default', () => {
    const presence = buildAttributionPresence({
      broadcastPresence: true,
      presenceText: 'My custom line',
      defaultText: DEFAULT_TEXT,
    });
    expect(presence?.activities[0].state).toBe('My custom line');
  });

  it('falls back to the default when the override is only whitespace', () => {
    const presence = buildAttributionPresence({
      broadcastPresence: true,
      presenceText: '   ',
      defaultText: DEFAULT_TEXT,
    });
    expect(presence?.activities[0].state).toBe(DEFAULT_TEXT);
  });

  it('returns null when the user has opted out', () => {
    // Null becomes an empty activity list, which clears the status — opting out
    // must actually remove the text, not leave the previous value on the bot.
    expect(
      buildAttributionPresence({ broadcastPresence: false, defaultText: DEFAULT_TEXT }),
    ).toBeNull();
  });

  it('returns null when there is no text at all to show', () => {
    expect(buildAttributionPresence({ broadcastPresence: true })).toBeNull();
    expect(
      buildAttributionPresence({ broadcastPresence: true, presenceText: '', defaultText: '' }),
    ).toBeNull();
  });

  it('tolerates nullish inputs', () => {
    expect(
      buildAttributionPresence({ broadcastPresence: true, presenceText: null, defaultText: null }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/app-info — fetched at runtime so a redeployment needs no rebuild
// ---------------------------------------------------------------------------

describe('fetchAppInfo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: string, init: { ok?: boolean; status?: number; throws?: boolean } = {}) {
    if (init.throws) {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
      return;
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        text: async () => body,
      })),
    );
  }

  it('requests the endpoint on the same origin (no hardcoded host)', async () => {
    stubFetch('{}');
    await fetchAppInfo();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith('/api/app-info');
  });

  it('returns the parsed attribution payload', async () => {
    const payload = {
      name: 'Disclone',
      version: '1.3.0',
      githubUrl: 'https://github.com/zexyomeme-svg/Discord-clone',
      siteUrl: 'https://discord-clone-render.onrender.com',
      githubDisplay: 'github.com/zexyomeme-svg/Discord-clone',
      siteDisplay: 'discord-clone-render.onrender.com',
      presenceText: 'Disclone · github.com/zexyomeme-svg/Discord-clone',
      presenceEditable: true,
    };
    stubFetch(JSON.stringify(payload));
    expect(await fetchAppInfo()).toEqual(payload);
  });

  it('returns null instead of throwing when the server is unreachable', async () => {
    stubFetch('', { throws: true });
    expect(await fetchAppInfo()).toBeNull();
  });

  it('returns null on a non-2xx response', async () => {
    stubFetch('{"name":"x"}', { ok: false, status: 500 });
    expect(await fetchAppInfo()).toBeNull();
  });

  it('returns null on an empty body', async () => {
    stubFetch('');
    expect(await fetchAppInfo()).toBeNull();
  });

  it('returns null when the SPA catch-all served HTML instead of JSON', async () => {
    // The classic misconfiguration: /api/app-info falls through to index.html.
    // JSON.parse would throw on that, so it must be caught and reported as null.
    stubFetch('<!doctype html><html><body>SPA</body></html>');
    expect(await fetchAppInfo()).toBeNull();
  });

  it('returns null on malformed JSON rather than throwing', async () => {
    stubFetch('{not json');
    expect(await fetchAppInfo()).toBeNull();
  });
});
