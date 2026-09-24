import type { JSX } from 'react';
import { ShellIcon } from '../ShellIcon';
import { filterShortcuts, referenceShortcuts } from './shortcuts';
import { useAccountPreferences } from '../../user-preferences';

/** The searchable list shared by the "?" overlay and Settings → Keyboard & input (#230). */
export function ShortcutReference({ apple, query, onQuery }: { apple: boolean; query: string; onQuery: (q: string) => void }): JSX.Element {
  const { sendKey } = useAccountPreferences();
  const rows = filterShortcuts(referenceShortcuts(apple, sendKey), query);
  const groups = [...new Set(rows.map((r) => r.group))];
  return <div className="shortcut-reference">
    <div className="settings-search shortcut-search"><ShellIcon name="search" size={16}/><input aria-label="Search shortcuts" placeholder="Search shortcuts" value={query} onChange={(e) => onQuery(e.target.value)} /></div>
    {groups.map((g) => <section key={g} aria-label={g}>
      <h3 className="shortcut-group">{g}</h3>
      <dl className="shortcuts-list">{rows.filter((r) => r.group === g).map((r) => <div key={r.label}><dt>{r.label}</dt><dd><kbd>{r.keys}</kbd></dd></div>)}</dl>
    </section>)}
    {!rows.length && <p className="route-note" role="status">No shortcut matches “{query}”.</p>}
  </div>;
}
