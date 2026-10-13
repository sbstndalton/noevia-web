import type { Message } from './types';

/** The longest title a chat takes from its first message (#1601). */
export const CHAT_TITLE_MAX = 80;

/** The title a chat takes from a message (#1601, #1579). A message past the limit is cut at the last word
 *  boundary that leaves room for the ellipsis, so a title never ends mid-word. A single word too long to
 *  leave a boundary is cut hard, still with the ellipsis, and a surrogate pair is never split. Titles
 *  stored by the old bare `slice(0, 80)` are left as they are; `titleAfterSend` still recognises them. */
export function deriveChatTitle(text: string): string {
  if (text.length <= CHAT_TITLE_MAX) return text;
  let head = text.slice(0, CHAT_TITLE_MAX - 1).replace(/[\uD800-\uDBFF]$/, '');
  const boundary = head.search(/\s\S*$/);
  if (boundary >= CHAT_TITLE_MAX / 2) head = head.slice(0, boundary);
  return head.replace(/\s+$/, '') + '…';
}

/** Only an automatically derived title follows an edited first prompt. */
export function titleAfterSend(title: string, previous: Message[], base: Message[] | undefined, text: string): string {
  const first = previous.find(message => message.role === 'user');
  // Derived means what the first prompt gives now, or what the old bare 80-character cut gave.
  const derived = !!first && (title === deriveChatTitle(first.content) || title === first.content.slice(0, CHAT_TITLE_MAX));
  return base?.length === 0 && derived ? deriveChatTitle(text) : title;
}
