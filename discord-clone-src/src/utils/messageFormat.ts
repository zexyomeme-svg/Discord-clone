/**
 * Shared message presentation helpers.
 *
 * These were previously copy-pasted into both MessageArea.tsx and
 * DMMessageArea.tsx (along with a second, divergent markdown renderer). Keeping
 * them in one module means the guild and DM views can no longer drift apart.
 */
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import type { Message } from '../store/types';

/** Discord groups consecutive messages from the same author within 7 minutes. */
export const MESSAGE_GROUP_WINDOW_MS = 7 * 60 * 1000;

/** "Today at 4:20 PM" / "Yesterday at 4:20 PM" / "06/01/2026 4:20 PM". */
export function formatMessageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  if (isToday(date)) return `Today at ${format(date, 'h:mm a')}`;
  if (isYesterday(date)) return `Yesterday at ${format(date, 'h:mm a')}`;
  return `${format(date, 'MM/dd/yyyy')} ${format(date, 'h:mm a')}`;
}

/** Bare clock time used on hover for grouped follow-up messages. */
export function formatShortTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'h:mm a');
}

/** Label for the date divider between message groups. */
export function formatDateDivider(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMMM d, yyyy');
}

/** Whether `curr` should be rendered as a continuation of `prev`. */
export function shouldGroupMessages(prev: Message, curr: Message): boolean {
  if (!prev || !curr) return false;
  if (prev.author?.id !== curr.author?.id) return false;
  // System messages (joins, boosts, replies) always break the group.
  if (isSystemMessage(prev) || isSystemMessage(curr)) return false;
  if (prev.channel_id !== curr.channel_id) return false;
  const delta = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
  return delta >= 0 && delta < MESSAGE_GROUP_WINDOW_MS;
}

/**
 * True for non-chat message types. Type 0 is DEFAULT and 19 is REPLY; both are
 * rendered as normal messages.
 */
export function isSystemMessage(message: Message): boolean {
  return message.type !== 0 && message.type !== 19;
}

/** Human-readable text for the system messages this client renders. */
export function systemMessageVerb(type: number): string {
  switch (type) {
    case 1:
      return 'added a recipient.';
    case 2:
      return 'removed a recipient.';
    case 3:
      return 'started a call.';
    case 7:
      return 'joined the server.';
    case 8:
      return 'just boosted the server!';
    case 9:
      return 'pinned a message.';
    case 11:
      return 'started a thread.';
    case 18:
      return 'started a stage.';
    case 24:
      return 'published an automated message.';
    default:
      return `sent a system message (type ${type}).`;
  }
}

/** Whether two dates fall on the same calendar day. */
export function isSameCalendarDay(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}
