import { useEffect, useMemo, useRef, useState } from 'react';
import { SettingsView } from './SettingsView';
import type { SettingsViewProps } from './SettingsView';
import { fetchProfile } from '../api';
import { PreviewPanel } from './PreviewPanel';
import { UsageView } from './UsageView';
import { ShellIcon } from './ShellIcon';

type Item = [id: string, label: string];
type Group = { name: string; items: Item[]; admin?: boolean };

// Two audiences, following the Personal/Administration split Nextcloud uses:
// things you change about your own account, and things that change the
// deployment for everyone. Sections that only ever had placeholder content are
// no longer nav rows of their own — they are listed together under "Planned"
// so the navigation describes what noevia can actually do today.
//
// Removed outright rather than deferred, because they cannot apply to a
// self-hosted single-server install: Billing (no plans or invoices to show),
// Voice, Browser and Computer use (host-application features, not this app's).
const PERSONAL: Item[] = [
  ['general', 'General'],
  ['profile', 'Profile & security'],
  ['diary', 'Diary & storage'],
  ['providers', 'Your connections'],
  ['usage', 'Usage & activity'],
  ['planned', 'Planned features'],
];

// Deployment-wide. The navigation hides these from members, but that is
// presentation only — the server independently returns 403 on the routes
// behind them (users, model mutations, shared providers), so hiding the entry
// is a courtesy, never the access control.
const ADMIN: Item[] = [
  ['users', 'Users'],
  ['models', 'Models & routing'],
  ['status', 'Service status'],
];

const ICONS: Record<string, string> = {
  profile: 'user', users: 'user', appearance: 'sun', usage: 'grid',
  models: 'settings', status: 'settings', providers: 'settings',
  diary: 'folder', general: 'settings', planned: 'grid',
};

// What used to be one navigation row each. Kept visible as a roadmap, but in
// one place, so an empty section never looks like a broken one.
const PLANNED: { group: string; items: string[] }[] = [
  { group: 'Personalization', items: ['Response style', 'Custom instructions', 'Memory preferences', 'Notifications', 'Keyboard shortcuts'] },
  { group: 'Data', items: ['Export conversations', 'Data retention', 'Import chats and projects', 'Archived conversations'] },
  { group: 'Extensibility', items: ['Capabilities', 'Plugins', 'Skills', 'Connectors'] },
  { group: 'Coding workspace', items: ['Coding preferences', 'Git', 'Environments', 'Worktrees', 'Hooks'] },
];

export function SettingsShell(props: SettingsViewProps & {onClose:()=>void; theme:'light'|'dark'; onTheme:(theme:'light'|'dark')=>void}) {
  const [section, setSection] = useState('general');
  const [query, setQuery] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    let live = true;
    fetchProfile()
      .then((p) => { if (live) setIsAdmin(p.user.role === 'admin'); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const groups: Group[] = useMemo(
    () => [
      { name: 'Personal', items: PERSONAL },
      ...(isAdmin ? [{ name: 'Administration', items: ADMIN, admin: true }] : []),
    ],
    [isAdmin],
  );

  // A member who was viewing an admin section (or a stale saved section) must
  // not be left staring at an empty pane.
  useEffect(() => {
    if (!groups.some((g) => g.items.some(([id]) => id === section))) setSection('general');
  }, [groups, section]);

  const title = groups.flatMap(g => g.items).find(([id]) => id === section)?.[1] || 'Settings';
  const filtered = groups.map(g => ({ ...g, items: g.items.filter(([, label]) => label.toLowerCase().includes(query.toLowerCase())) }));

  return <dialog ref={dialog} className="settings-shell" aria-label="Settings" onCancel={e => { e.preventDefault(); props.onClose(); }}>
    <aside className="settings-navigation">
      <button className="settings-back" onClick={props.onClose}><ShellIcon name="arrow"/>Back to app</button>
      <div className="settings-search"><ShellIcon name="search" size={16}/><input aria-label="Search settings" placeholder="Search settings…" value={query} onChange={e => setQuery(e.target.value)}/></div>
      <nav aria-label="Settings categories">
        {filtered.map(g => g.items.length > 0 && <section key={g.name}>
          <h2>{g.name}</h2>
          {g.items.map(([id, label]) => <button key={id} aria-current={section === id ? 'page' : undefined} className={section === id ? 'is-active' : ''} onClick={() => setSection(id)}>
            <ShellIcon name={ICONS[id] || 'settings'} size={17}/><span>{label}</span>
          </button>)}
        </section>)}
        {filtered.every(g => !g.items.length) && <p className="preview-footnote">No matching settings.</p>}
      </nav>
    </aside>
    <section className="settings-detail">
      <header><span>{title}</span><button className="shell-icon-button" aria-label="Close settings" onClick={props.onClose}><ShellIcon name="close"/></button></header>
      <div className="settings-detail-scroll" key={section}>
        {['profile', 'users', 'diary', 'providers', 'models', 'status'].includes(section) ? (
          <SettingsView {...props} section={section}/>
        ) : section === 'general' ? (
          <>
            <div className="settings-title"><h1>General</h1><p>Make noevia feel like your space.</p></div>
            <section className="settings-appearance">
              <div><h2>Appearance</h2><p>Choose a light or dark interface.</p></div>
              <div className="theme-choice">{(['light', 'dark'] as const).map(t => <button className={props.theme === t ? 'is-active' : ''} aria-pressed={props.theme === t} key={t} onClick={() => props.onTheme(t)}>
                <span className={`theme-swatch ${t}`}><i/><i/><i/></span>{t === 'light' ? 'Polymetal Day' : 'Polymetal Night'}
              </button>)}</div>
            </section>
          </>
        ) : section === 'usage' ? (
          <UsageView/>
        ) : section === 'planned' ? (
          <>
            <div className="settings-title"><h1>Planned features</h1><p>Not built yet. Listed here so the rest of Settings only shows what noevia can actually do.</p></div>
            {PLANNED.map(p => <PreviewPanel key={p.group} title={p.group} description="" items={p.items}/>)}
          </>
        ) : null}
      </div>
    </section>
  </dialog>;
}
