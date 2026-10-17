import { describe, expect, it } from 'vitest';
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
