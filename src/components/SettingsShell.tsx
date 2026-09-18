import { AppearanceSettings, CapabilitiesSettings, ProfileSettings } from './GeneralSettings';
import { SettingsPanelBoundary } from './SettingsPanelBoundary';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsView } from './SettingsView';
import type { SettingsViewProps } from './SettingsView';
import { fetchProfile } from '../api';
import { PreviewPanel } from './PreviewPanel';
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

// Grouped the way people look for things: who you are, how noevia behaves for you, what it
// is connected to, and — for administrators — the server itself. Sections that only ever had
// placeholder content are listed together under "Coming later" so the navigation describes
// what noevia can actually do today.
//
// Removed outright rather than deferred, because they cannot apply to a self-hosted
// single-server install: Billing (no plans or invoices to show), Browser and Computer use
// (host-application features, not this app's).
const PERSONAL: Group[] = [
  { name: 'Account', items: [['profile', 'Profile'], ['security', 'Security'], ['usage', 'Usage & activity'], ['data', 'Data']] },
  { name: 'Preferences', items: [['appearance', 'Appearance'], ['personalization', 'Personalization'], ['capabilities', 'Capabilities']] },
  { name: 'Customize', items: [['connectors', 'Connectors'], ['providers', 'AI providers'], ['diary', 'Diary & storage']] },
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
  ['backups', 'Backups'],
  ['status', 'Service status'],
] };

const LATER: Group = { name: 'Coming later', items: [['planned', 'Planned features']] };

// Each section has its own symbol; names resolve through ShellIcon's Lucide map.
const ICONS: Record<string, string> = Object.fromEntries(['profile','security','appearance','personalization','capabilities','diary','providers','usage','data','planned','users','models','status','features','backups','address','connectors'].map(id => [id, id]));

// What used to be one navigation row each. Kept visible as a roadmap, but in
// one place, so an empty section never looks like a broken one.
const PLANNED: { group: string; items: string[] }[] = [
  { group: 'Extensibility', items: ['Capability catalogue', 'Plugin management', 'Skill library', 'Nextcloud and custom MCP connectors'] },
  { group: 'Coding workspace', items: ['Coding preferences', 'Git', 'Environments', 'Worktrees', 'Hooks'] },
];

// Kept in step with the single-pane breakpoint in shell-v2.css.
const PHONE = '(max-width: 820px)';
const phone = () => typeof window !== 'undefined' && window.matchMedia(PHONE).matches;
const reducedMotion = () => typeof window !== 'undefined' && (document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export type SettingsSection = 'general' | 'usage' | 'models' | 'connectors';

export function SettingsShell(props: SettingsViewProps & {initialSection?:SettingsSection|string;onSection?:(id:string)=>void;appearanceStatus?:string; appearanceError?:boolean; retryAppearance?:()=>void; onClose:()=>void; onStartChat?:(prompt:string)=>void; theme:'light'|'dark'; onTheme:(theme:'light'|'dark')=>void; preference?:'light'|'dark'|'system'; onPreference?:(preference:'light'|'dark'|'system')=>void}) {
  // 'general' is the historical name for the first page; it now opens Profile. Anything that is
  // not a section name (a click event handed through by mistake) counts as no choice.
  const named = typeof props.initialSection === 'string' && props.initialSection !== 'general' ? props.initialSection : null;
  const [section, setSection] = useState<string>(named || 'profile');
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
  const close = useCallback(() => {
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

  const groups: Group[] = useMemo(() => [...PERSONAL, ...(isAdmin ? [ADMIN] : []), LATER], [isAdmin]);

  // A member who was viewing an admin section (or a stale saved section) must
  // not be left staring at an empty pane.
  useEffect(() => {
    // Wait for the profile: admin sections appear only once the role is known.
    if (profileKnown && !groups.some((g) => g.items.some(([id]) => id === section))) setSection('profile');
  }, [groups, section, profileKnown]);

  const title = groups.flatMap(g => g.items).find(([id]) => id === section)?.[1] || 'Settings';
  const filtered = groups.map(g => ({ ...g, items: g.items.filter(([, label]) => label.toLowerCase().includes(query.toLowerCase())) }));
  const open = (id: string) => { setSection(id); props.onSection?.(id); setView('detail'); stage.current?.querySelector('.settings-detail-scroll')?.scrollTo(0, 0); };
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
      <div className="settings-search"><ShellIcon name="search" size={16}/><input aria-label="Search settings" placeholder="Search settings" value={query} onChange={e => setQuery(e.target.value)}/></div>
      {profileError && <p className="route-note" role="alert">Account access could not be checked. <button className="popup-tab" onClick={() => setProfileAttempt(n => n + 1)}>Retry access</button></p>}
      <nav aria-label="Settings categories">
        {filtered.map(g => g.items.length > 0 && <section key={g.name}>
          <h2>{g.name}</h2>
          {g.items.map(([id, label]) => <button key={id} aria-current={section === id ? 'page' : undefined} className={section === id ? 'is-active' : ''} onClick={() => open(id)}>
            <ShellIcon name={ICONS[id] || 'settings'} size={17}/><span>{label}</span><ShellIcon name="chevron-right" size={16}/>
          </button>)}
        </section>)}
        {filtered.every(g => !g.items.length) && <p className="preview-footnote">No matching settings.</p>}
      </nav>
    </aside>
    <section className="settings-detail" aria-label={title}>
      <header>
        <button className="shell-icon-button settings-list-back" onClick={() => setView('list')} aria-label="All settings"><ShellIcon name="chevron-left"/></button>
        <span>{title}</span>
        <CloseButton onClick={close} label="Close settings"/>
      </header>
      <div className="settings-detail-scroll" key={section}>
        <SettingsPanelBoundary>
        {['security', 'users', 'diary', 'providers', 'models', 'status'].includes(section) ? (
          <SettingsView {...props} section={section}/>
        ) : section === 'profile' ? (
          <ProfileSettings />
        ) : section === 'appearance' ? (
          <AppearanceSettings theme={props.theme} onTheme={props.onTheme} preference={props.preference} onPreference={props.onPreference} appearanceStatus={props.appearanceStatus}
            appearanceError={props.appearanceError} retryAppearance={props.retryAppearance} />
        ) : section === 'features' && isAdmin ? (
          <FeatureSettings />
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
        ) : section === 'planned' ? (
          <>
            <div className="settings-title"><h1>Planned features</h1><p>These account-wide controls are not built yet. Project instructions and reviewed instruction skills already work in each project. Connections and Diary storage have their own working categories.</p></div>
            {PLANNED.map(p => <PreviewPanel key={p.group} title={p.group} description="" items={p.items}/>)}
          </>
        ) : null}
        </SettingsPanelBoundary>
      </div>
    </section>
  </section>;
}
