import type { Message } from './types';

/** Only an automatically derived title follows an edited first prompt. */
export function titleAfterSend(title: string, previous: Message[], base: Message[] | undefined, text: string): string {
  const first = previous.find(message => message.role === 'user');
  return base?.length === 0 && first && title === first.content.slice(0, 80)
    ? text.slice(0, 80) : title;
}
