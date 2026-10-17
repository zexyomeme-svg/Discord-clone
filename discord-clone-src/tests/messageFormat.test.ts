import { describe, expect, it } from 'vitest';
import {
  MESSAGE_GROUP_WINDOW_MS,
  formatDateDivider,
  formatMessageTimestamp,
  formatShortTimestamp,
  isSameCalendarDay,
  isSystemMessage,
  shouldGroupMessages,
  systemMessageVerb,
} from '../src/utils/messageFormat';
import type { Message } from '../src/store/types';

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: '1',
    channel_id: '10',
    author: { id: 'u1', username: 'alice', discriminator: '0', avatar: null },
    content: 'hi',
    timestamp: new Date(2026, 5, 1, 12, 0, 0).toISOString(),
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0,
    ...overrides,
  } as Message;
}

function at(base: Message, deltaMs: number): Message {
  return {
    ...base,
    timestamp: new Date(new Date(base.timestamp).getTime() + deltaMs).toISOString(),
  };
}

describe('shouldGroupMessages', () => {
  const base = msg();

  it('groups consecutive messages from the same author within 7 minutes', () => {
    expect(shouldGroupMessages(base, at(base, MESSAGE_GROUP_WINDOW_MS - 1))).toBe(true);
  });

  it('does not group once the 7 minute window is exceeded', () => {
    expect(shouldGroupMessages(base, at(base, MESSAGE_GROUP_WINDOW_MS))).toBe(false);
    expect(shouldGroupMessages(base, at(base, MESSAGE_GROUP_WINDOW_MS + 60_000))).toBe(false);
  });

  it('does not group messages from different authors', () => {
    const other = msg({ author: { id: 'u2', username: 'bob', discriminator: '0', avatar: null } });
    expect(shouldGroupMessages(base, at(other, 1000))).toBe(false);
  });

  it('does not group across channels', () => {
    expect(shouldGroupMessages(base, at(msg({ channel_id: '20' }), 1000))).toBe(false);
  });

  // System messages (joins, boosts, pins) must always break the visual group.
  it('breaks the group for system messages on either side', () => {
    const join = msg({ type: 7 });
    expect(shouldGroupMessages(base, at(join, 1000))).toBe(false);
    expect(shouldGroupMessages(join, at(base, 1000))).toBe(false);
  });

  it('still groups a reply (type 19) with the previous message', () => {
    expect(shouldGroupMessages(base, at(msg({ type: 19 }), 1000))).toBe(true);
  });

  it('does not group when the later message is older (clock skew)', () => {
    expect(shouldGroupMessages(base, at(base, -5000))).toBe(false);
  });

  it('tolerates missing arguments', () => {
    expect(shouldGroupMessages(undefined as unknown as Message, base)).toBe(false);
    expect(shouldGroupMessages(base, undefined as unknown as Message)).toBe(false);
  });
});

describe('isSystemMessage', () => {
  it('treats 0 (default) and 19 (reply) as normal messages', () => {
    expect(isSystemMessage(msg({ type: 0 }))).toBe(false);
    expect(isSystemMessage(msg({ type: 19 }))).toBe(false);
  });

  it('treats everything else as a system message', () => {
    for (const type of [1, 2, 3, 7, 8, 9, 11, 18, 24, 99]) {
      expect(isSystemMessage(msg({ type }))).toBe(true);
    }
  });
});

describe('systemMessageVerb', () => {
  it('describes the common types', () => {
    expect(systemMessageVerb(7)).toContain('joined the server');
    expect(systemMessageVerb(8)).toContain('boosted');
    expect(systemMessageVerb(9)).toContain('pinned');
  });

  it('falls back to a readable message for unknown types', () => {
    expect(systemMessageVerb(1234)).toContain('type 1234');
  });

  it('always returns a non-empty, sentence-like string', () => {
    for (const type of [1, 2, 3, 7, 8, 9, 11, 18, 24, 999]) {
      const verb = systemMessageVerb(type);
      expect(verb.length).toBeGreaterThan(0);
      // Ends with terminal punctuation. Type 8 intentionally ends with "!" to
      // match Discord's own boost copy, so "." is not the only valid ending.
      expect(verb.endsWith('.') || verb.endsWith('!')).toBe(true);
    }
  });
});

describe('formatMessageTimestamp', () => {
  it('uses "Today at ..." for today', () => {
    const today = new Date();
    expect(formatMessageTimestamp(today.toISOString())).toMatch(/^Today at \d{1,2}:\d{2} [AP]M$/);
  });

  it('uses "Yesterday at ..." for yesterday', () => {
    const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(formatMessageTimestamp(y.toISOString())).toMatch(/^Yesterday at \d{1,2}:\d{2} [AP]M$/);
  });

  it('falls back to a full date otherwise', () => {
    const old = new Date(2020, 0, 15, 9, 30).toISOString();
    expect(formatMessageTimestamp(old)).toMatch(/^01\/15\/2020 \d{1,2}:\d{2} [AP]M$/);
  });

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatMessageTimestamp('not a date')).toBe('');
    expect(formatMessageTimestamp('')).toBe('');
  });
});

describe('formatShortTimestamp', () => {
  it('returns only a clock time', () => {
    expect(formatShortTimestamp(new Date(2026, 5, 1, 16, 20).toISOString())).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
  });

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatShortTimestamp('garbage')).toBe('');
  });
});

describe('formatDateDivider', () => {
  it('labels today and yesterday specially', () => {
    expect(formatDateDivider(new Date())).toBe('Today');
    expect(formatDateDivider(new Date(Date.now() - 86_400_000))).toBe('Yesterday');
  });

  it('labels other days with a full date', () => {
    expect(formatDateDivider(new Date(2026, 0, 5))).toBe('January 5, 2026');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatDateDivider(new Date('nope'))).toBe('');
  });
});

describe('isSameCalendarDay', () => {
  it('compares calendar days, not 24h windows', () => {
    expect(isSameCalendarDay(new Date(2026, 5, 1, 23, 59), new Date(2026, 5, 1, 0, 1))).toBe(true);
    expect(isSameCalendarDay(new Date(2026, 5, 1, 23, 59), new Date(2026, 5, 2, 0, 1))).toBe(false);
  });
});
