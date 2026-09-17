/** App-wide keyboard shortcuts. One table so the help dialog and the handler never disagree.
 *  "Mod" is ⌘ on Apple platforms and Ctrl elsewhere (HIG: use the platform's command key). */
export type ShortcutId = 'search' | 'newChat' | 'settings' | 'help';
export type Shortcut = { id: ShortcutId; key: string; shift?: boolean; label: string };

export const SHORTCUTS: Shortcut[] = [
  { id: 'search', key: 'k', label: 'Search projects and chats' },
  { id: 'newChat', key: 'o', shift: true, label: 'New chat' },
  { id: 'settings', key: ',', label: 'Open Settings' },
  { id: 'help', key: '/', label: 'Show keyboard shortcuts' },
];

export function isApple(platform: string): boolean { return /mac|iphone|ipad|ipod/i.test(platform); }

type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean };

export function matchShortcut(event: KeyLike, apple: boolean): ShortcutId | null {
  if (event.isComposing || event.altKey) return null;
  const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  const key = event.key.toLowerCase();
  const found = SHORTCUTS.find((s) => s.key === key && !!s.shift === event.shiftKey);
  return found ? found.id : null;
}

export function describe(shortcut: Shortcut, apple: boolean): string {
  const key = shortcut.key === ',' ? ',' : shortcut.key.toUpperCase();
  return apple ? `⌘${shortcut.shift ? '⇧' : ''}${key}` : `Ctrl+${shortcut.shift ? 'Shift+' : ''}${key}`;
}
