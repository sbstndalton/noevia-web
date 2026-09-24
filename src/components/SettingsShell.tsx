import { AppearanceSettings, CapabilitiesSettings, ProfileSettings } from './GeneralSettings';
import { SettingsPanelBoundary } from './SettingsPanelBoundary';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsView } from './SettingsView';
import type { SettingsViewProps } from './SettingsView';
import { fetchProfile } from '../api';
import { UsageView } from './UsageView';
import { ShellIcon } from './ShellIcon';
import { CloseButton } from './CloseButton';
import { DataSettings } from './data/DataSettings';
import { PersonalizationSettings } from './personalization/PersonalizationSettings';
import { FeatureSettings } from './features/FeatureSettings';
import { OffsiteBackupSettings } from './offsite-backup/OffsiteBackupSettings';
import { WebAddressSettings } from './web-address/WebAddressSettings';
import { ConnectorsSettings } from './connectors/ConnectorsSettings';

type Item = [id: string, label: string];
type Group = { name: string; items: Item[]; admin?: boolean };

// Preserve section IDs for saved places. Personal preferences come first;
// connections and deployment controls have their own visible groups.
const PERSONAL: Group[] = [
  { name: '', items: [
    ['appearance', 'General'],
    ['personalization', 'Personalization'],
    ['capabilities', 'Capabilities'],
    ['usage', 'Usage'],
    ['data', 'Data controls'],
    ['diary', 'Diary & storage'],
    ['security', 'Security and login'],
    ['profile', 'Account'],
  ] },
];

// Deployment-wide. The navigation hides these from members, but that is
// presentation only — the server independently returns 403 on the routes
// behind them (users, model mutations, shared providers), so hiding the entry
// is a courtesy, never the access control.
const ADMIN: Group = { name: 'Server', admin: true, items: [
  ['users', 'Users'],
  ['address', 'Web address'],
  ['models', 'Models & routing'],
  ['features', 'Features'],
  ['experimental', 'Experimental'],
  ['backups', 'Backups'],
  ['status', 'Service status'],
] };

const CONNECTIONS: Group = { name: 'Connections', items: [['connectors', 'Connectors'], ['providers', 'AI providers']] };

// Each section has its own symbol; names resolve through ShellIcon's Lucide map.
const ICONS: Record<string, string> = Object.fromEntries(['profile','security','appearance','personalization','capabilities','diary','providers','usage','data','planned','users','models','status','features','backups','address','connectors'].map(id => [id, id]));

// Kept in step with the single-pane breakpoint in shell-v2.css.
const PHONE = '(max-width: 820px)';
// layout-mode.js narrows a forced "mobile" preview by capping #root's width (noevia.css), not
// the CSS viewport a desktop browser reports — so matchMedia alone misses it and the two-pane
// desktop grid renders inside that column with the detail pane squeezed off screen. Honour the
// forced layout the same way the stylesheet does.
const phone = () => typeof window !== 'undefined' && (window.matchMedia(PHONE).matches || document.documentElement.dataset.layout === 'mobile');
const reducedMotion = () => typeof window !== 'undefined' && (document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export type SettingsSection = 'general' | 'usage' | 'models' | 'connectors';

export function SettingsShell(props: SettingsViewProps & {initialSection?:SettingsSection|string;onSection?:(id:string)=>void;appearanceStatus?:string; appearanceError?:boolean; retryAppearance?:()=>void; onClose:()=>void; onClosing?:()=>void; onStartChat?:(prompt:string)=>void; theme:'light'|'dark'; onTheme:(theme:'light'|'dark')=>void; preference?:'light'|'dark'|'system'; onPreference?:(preference:'light'|'dark'|'system')=>void}) {
  // 'general' is the historical name for the first page; it now opens Appearance. Anything that is
  // not a section name (a click event handed through by mistake) counts as no choice.
  const named = typeof props.initialSection === 'string' && props.initialSection !== 'general' ? props.initialSection : null;
  const [section, setSection] = useState<string>(named || 'appearance');
  // Phones show the list and a page as two screens; a named section opens straight on its page.
  const [view, setView] = useState<'list' | 'detail'>(() => named || !phone() ? 'detail' : 'list');
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileKnown, setProfileKnown] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const stage = useRef<HTMLElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  // Settings takes the chat's place rather than floating over it: focus moves in, and goes back
  // to whatever opened it when it leaves.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    stage.current?.querySelector<HTMLElement>('[aria-current="page"], .settings-navigation nav button')?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  // Leaving plays the entrance backwards, then hands control back.
  const closeTimer = useRef(0);
  const onClosing = useRef(props.onClosing);
  onClosing.current = props.onClosing;
  const close = useCallback(() => {
    // Forget Settings as the place to return to at once, not after the exit animation: a reload
    // in those 240ms reopened it (found by qa/google-drive, 2026-09-19).
    onClosing.current?.();
    if (reducedMotion()) { onClose.current(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => onClose.current(), 240);
  }, []);
  // Replaced by a new Settings mid-exit: this one's exit must not close its successor.
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('dialog, [role="menu"], [role="listbox"]')) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    let live = true;
    setProfileError(false);
    fetchProfile()
      .then((p) => { if (live) { setIsAdmin(p.user.role === 'admin'); setProfileKnown(true); } })
      .catch(() => { if (live) { setProfileError(true); setProfileKnown(true); } });
    return () => { live = false; };
  }, [profileAttempt]);

  const groups: Group[] = useMemo(() => [...PERSONAL, CONNECTIONS, ...(isAdmin ? [ADMIN] : [])], [isAdmin]);

  // A member who was viewing an admin section (or a stale saved section) must
  // not be left staring at an empty pane.
  useEffect(() => {
    // Wait for the profile: admin sections appear only once the role is known.
    if (profileKnown && !groups.some((g) => g.items.some(([id]) => id === section))) setSection('appearance');
  }, [groups, section, profileKnown]);

  const title = groups.flatMap(g => g.items).find(([id]) => id === section)?.[1] || 'Settings';
  const filtered = groups.map(g => ({ ...g, items: g.items.filter(([, label]) => label.toLowerCase().includes(query.trim().toLowerCase())) }));
  const open = (id: string) => { setSection(id); props.onSection?.(id); setView('detail'); };
  // On narrow screens the navigation disappears. Move focus into the new page
  // so keyboard and screen-reader users do not lose their place.
  useEffect(() => {
    if (view !== 'detail') return;
    stage.current?.querySelector('.settings-detail-scroll')?.scrollTo(0, 0);
    if (phone()) stage.current?.querySelector<HTMLElement>('.settings-detail-scroll')?.focus({ preventScroll: true });
  }, [section, view]);
  const showList = () => {
    setView('list');
    window.requestAnimationFrame(() => stage.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true }));
  };
  const clearSearch = () => { setQuery(''); stage.current?.querySelector<HTMLInputElement>('.settings-search input')?.focus(); };
  // Report the opening page too, so a reload returns to the page you were reading and not
  // to the top of the list (user review of `ab2720a`, 2026-09-18).
  const report = props.onSection;
  useEffect(() => { report?.(section); }, [report, section]);

  return <section ref={stage} className={`settings-stage${closing ? ' is-closing' : ''}`} data-view={view} role="region" aria-label="Settings">
    <aside className="settings-navigation">
      <div className="settings-nav-head">
        <button className="settings-back" onClick={close}><ShellIcon name="arrow"/>Back to app</button>
        <h1 className="settings-nav-title">Settings</h1>
      </div>
      <div className="settings-search"><ShellIcon name="search" size={16}/><input aria-label="Search settings" placeholder="Search settings" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="settings-search-clear" onClick={clearSearch} aria-label="Clear settings search"><ShellIcon name="close" size={16}/></button>}</div>
      {profileError && <p className="route-note" role="alert">Account access could not be checked. <button className="popup-tab" onClick={() => setProfileAttempt(n => n + 1)}>Retry access</button></p>}
      <nav aria-label="Settings categories">
        {filtered.map(g => g.items.length > 0 && <section key={g.name}>
          {g.name && <h2>{g.name}</h2>}
          {g.items.map(([id, label]) => <button key={id} aria-current={section === id ? 'page' : undefined} className={section === id ? 'is-active' : ''} onClick={() => open(id)}>
            <ShellIcon name={ICONS[id] || 'settings'} size={17}/><span>{label}</span><ShellIcon name="chevron-right" size={16}/>
          </button>)}
        </section>)}
        {filtered.every(g => !g.items.length) && <div className="settings-search-empty" role="status"><strong>No matching settings</strong><p>Try a different name or browse all settings.</p><button className="btn btn-secondary" onClick={clearSearch}>Clear search</button></div>}
      </nav>
    </aside>
    <section className="settings-detail" aria-label={title}>
      <header>
        <button className="shell-icon-button settings-list-back" onClick={showList} aria-label="All settings"><ShellIcon name="chevron-left"/></button>
        <span>{title}</span>
        <CloseButton onClick={close} label="Close settings"/>
      </header>
      <div className="settings-detail-scroll" key={section} tabIndex={-1} aria-label={title}>
        <SettingsPanelBoundary>
        {['security', 'users', 'diary', 'providers', 'models', 'status'].includes(section) ? (
          <SettingsView {...props} section={section}/>
        ) : section === 'profile' ? (
          <ProfileSettings />
        ) : section === 'appearance' ? (
          <AppearanceSettings theme={props.theme} onTheme={props.onTheme} preference={props.preference} onPreference={props.onPreference} appearanceStatus={props.appearanceStatus}
            appearanceError={props.appearanceError} retryAppearance={props.retryAppearance} />
        ) : (section === 'features' || section === 'experimental') && isAdmin ? (
          <FeatureSettings key={section} experimental={section === 'experimental'} />
        ) : section === 'address' && isAdmin ? (
          <WebAddressSettings/>
        ) : section === 'backups' && isAdmin ? (
          <OffsiteBackupSettings />
        ) : section === 'connectors' ? (
          <ConnectorsSettings isAdmin={isAdmin} onStartChat={props.onStartChat}/>
        ) : section === 'capabilities' ? (
          <CapabilitiesSettings />
        ) : section === 'personalization' ? (
          <PersonalizationSettings />
        ) : section === 'data' ? (
          <DataSettings />
        ) : section === 'usage' ? (
          <UsageView/>
        ) : null}
        </SettingsPanelBoundary>
      </div>
    </section>
  </section>;
}
