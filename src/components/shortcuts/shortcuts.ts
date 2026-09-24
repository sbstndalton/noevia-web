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

/** "?" opens the reference, as in most web apps, but only outside text fields so typing a question
 *  mark is never stolen. */
export function isHelpKey(event: KeyLike & { targetEditable: boolean }): boolean {
  return event.key === '?' && !event.targetEditable && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing;
}

export type ReferenceRow = { group: 'App' | 'Composer' | 'Dialogs'; label: string; keys: string };

/** Every shortcut noevia actually handles, for the "?" overlay and Settings → Keyboard & input.
 *  Built from the same table the handlers use, plus the composer and edit-box keys, so the reference
 *  cannot drift from behaviour. The send keys follow the account's input preference. */
export function referenceShortcuts(apple: boolean, sendKey: 'enter' | 'mod-enter' = 'enter'): ReferenceRow[] {
  const mod = apple ? '⌘' : 'Ctrl+';
  const shiftEnter = apple ? '⇧Enter' : 'Shift+Enter';
  return [
    ...SHORTCUTS.map((s): ReferenceRow => ({ group: 'App', label: s.label, keys: describe(s, apple) })),
    { group: 'App', label: 'Show keyboard shortcuts (outside a text field)', keys: '?' },
    { group: 'Composer', label: 'Send a message', keys: sendKey === 'enter' ? 'Enter' : `${mod}Enter` },
    { group: 'Composer', label: 'New line in a message', keys: sendKey === 'enter' ? shiftEnter : 'Enter' },
    { group: 'Composer', label: 'Save an edited message and re-run', keys: `${mod}Enter` },
    { group: 'Composer', label: 'Cancel editing a message', keys: 'Esc' },
    { group: 'Dialogs', label: 'Close a dialog, menu, search or Settings', keys: 'Esc' },
    { group: 'Dialogs', label: 'Move between menu items', keys: '↑ ↓ Home End' },
  ];
}

/** Case-insensitive match on the action or its keys; an empty query keeps everything. */
export function filterShortcuts(rows: ReferenceRow[], query: string): ReferenceRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.label.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q) || r.group.toLowerCase().includes(q));
}
