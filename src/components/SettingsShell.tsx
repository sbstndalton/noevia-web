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
import { NotificationSettings } from './notifications/NotificationSettings';
import { MemorySettings } from './personalization/MemorySettings';
import { LanguageSettings } from './personalization/LanguageSettings';
import { KeyboardSettings } from './shortcuts/KeyboardSettings';
import { useT } from '../i18n';
import { SETTINGS_SECTION_ALIASES } from '../routes';
import { closeFocusTarget } from '../settings-focus';
import '../i18n/settings';
import type { MessageKey, Translate } from '../i18n';

type Item = [id: string, label: string, keywords?: string];
type Group = { name: string; items: Item[]; admin?: boolean };

const GROUP_KEYS: Record<string, MessageKey> = { 'Personal': 'settings.group.personal', 'Account & connections': 'settings.group.account', 'Server administration': 'settings.group.admin' };

/** The groups in the interface language (#231). Search keeps the English name and keywords too,
 *  so a task word typed in either language still finds its page. */
function localiseGroups(groups: Group[], t: Translate): Group[] {
  return groups.map((g) => ({ ...g, name: GROUP_KEYS[g.name] ? t(GROUP_KEYS[g.name]) : g.name, items: g.items.map(([id, label, keywords = '']): Item => {
    const own = t(`settings.section.${id}` as MessageKey);
    const ownKeywords = t(`settings.keywords.${id}` as MessageKey);
    return [id, own.startsWith('settings.') ? label : own, [keywords, ownKeywords.startsWith('settings.') ? '' : ownKeywords, own === label ? '' : label.toLowerCase()].filter(Boolean).join(' ')];
  }) }));
}

// Settings is two areas (#226): Personal (what you do for yourself) and Server administration
// (admin-only, visually separate). Section IDs are preserved for saved places and links; new
// pages got new IDs, and SECTION_ALIASES maps the old ones that moved. Keywords make search find a
// page by the task ("export", "backups", "connected apps") rather than only by its title.
const PERSONAL: Group[] = [
  { name: 'Personal', items: [
    ['appearance', 'Appearance & language', 'theme dark light accent font density motion layout locale date number format language'],
    ['keyboard', 'Keyboard & input', 'shortcuts keys enter send newline hotkeys'],
    ['personalization', 'Assistant & style', 'personalization response style tone length emoji headings custom instructions language'],
    ['memory', 'Memory', 'remember facts forget clear project memory diary'],
    ['notifications', 'Notifications', 'alerts browser approval reply finished'],
    ['data', 'Your data & privacy', 'data controls export import delete retention archived chats'],
    ['usage', 'Usage', 'activity tokens replies statistics'],
  ] },
  { name: 'Account & connections', items: [
    ['profile', 'Account', 'profile name email'],
    ['security', 'Security and login', 'passkeys sessions sign out app passwords'],
    ['diary', 'Diary & storage', 'diary journal storage nextcloud webdav'],
    ['connectors', 'Connected apps', 'connectors google drive customise plugins skills permissions'],
    ['providers', 'AI providers', 'openai endpoint api key provider'],
  ] },
];

// Deployment-wide. The navigation hides these from members, but that is
// presentation only — the server independently returns 403 on the routes
// behind them (users, model mutations, shared providers), so hiding the entry
// is a courtesy, never the access control.
const ADMIN: Group = { name: 'Server administration', admin: true, items: [
  ['users', 'Users', 'members invite accounts'],
  ['models', 'Models & routing', 'model tuning auto routing download gguf'],
  ['address', 'Web address', 'deployment domain url https'],
  ['features', 'Features', 'deployment feature flags operator'],
  ['experimental', 'Experimental', 'deployment preview'],
  ['backups', 'Backups', 'offsite backup restore google drive s3'],
  ['status', 'Service status', 'health mcp inference status'],
  ['capabilities', 'Capabilities (status)', 'tools retrieval report'],
] };

/** Old section IDs that moved: saved places and links resolve to the new home. */
export const SECTION_ALIASES: Record<string, string> = SETTINGS_SECTION_ALIASES;
export function resolveSection(id: string | null | undefined): string | null {
  if (typeof id !== 'string' || !id) return null;
  return SECTION_ALIASES[id] ?? id;
}

/** Search matches the page name or its task keywords, case-insensitively. */
export function filterGroups<G extends { items: Item[] }>(groups: G[], query: string): G[] {
  const q = query.trim().toLowerCase();
  return groups.map((g) => ({ ...g, items: q ? g.items.filter(([, label, keywords = '']) => label.toLowerCase().includes(q) || keywords.includes(q)) : g.items }));
}

// Each section has its own symbol; names resolve through ShellIcon's Lucide map.
const ICONS: Record<string, string> = { ...Object.fromEntries(['profile','security','appearance','personalization','capabilities','diary','providers','usage','data','planned','users','models','status','features','backups','address','connectors'].map(id => [id, id])), keyboard: 'keyboard', memory: 'memory', notifications: 'bell' };

// Kept in step with the single-pane breakpoint in shell-v2.css.
const PHONE = '(max-width: 820px)';
// layout-mode.js narrows a forced "mobile" preview by capping #root's width (noevia.css), not
// the CSS viewport a desktop browser reports — so matchMedia alone misses it and the two-pane
// desktop grid renders inside that column with the detail pane squeezed off screen. Honour the
// forced layout the same way the stylesheet does.
const phone = () => typeof window !== 'undefined' && (window.matchMedia(PHONE).matches || document.documentElement.dataset.layout === 'mobile');
const reducedMotion = () => typeof window !== 'undefined' && (document.documentElement.dataset.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export type SettingsSection = 'general' | 'usage' | 'models' | 'connectors' | 'keyboard' | 'data' | 'notifications' | 'memory' | 'status';

export function SettingsShell(props: SettingsViewProps & {initialSection?:SettingsSection|string;onSection?:(id:string,opts?:{replace?:boolean})=>void;appearanceStatus?:string; appearanceError?:boolean; retryAppearance?:()=>void; onClose:()=>void; onClosing?:()=>void; onStartChat?:(prompt:string)=>void; onOpenArchived?:()=>void; onOpenDiary?:()=>void; theme:'light'|'dark'; onTheme:(theme:'light'|'dark')=>void; preference?:'light'|'dark'|'system'; onPreference?:(preference:'light'|'dark'|'system')=>void; opener?: { current: HTMLElement | null }}) {
  // 'general' is the historical name for the first page; it now opens Appearance. Anything that is
  // not a section name (a click event handed through by mistake) counts as no choice.
  const named = typeof props.initialSection === 'string' && props.initialSection !== 'general' ? resolveSection(props.initialSection) : null;
  const [section, setSection] = useState<string>(named || 'appearance');
  // Phones show the list and a page as two screens; a named section opens straight on its page.
  const [view, setView] = useState<'list' | 'detail'>(() => named || !phone() ? 'detail' : 'list');
  // Back/Forward between Settings sections (#359): App hands the section from the address bar back
  // in. The same value echoing back from our own report is a no-op.
  const requested = typeof props.initialSection === 'string' && props.initialSection ? resolveSection(props.initialSection === 'general' ? 'appearance' : props.initialSection) : null;
  const sectionNow = useRef(section);
  sectionNow.current = section;
  useEffect(() => {
    if (!requested || requested === sectionNow.current) return;
    setSection(requested);
    setView('detail');
  }, [requested]);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileKnown, setProfileKnown] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const t = useT();
  const stage = useRef<HTMLElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  // Settings takes the chat's place rather than floating over it: focus moves in, and goes back
  // to whatever opened it when it leaves.
  //
  // #401: reading `document.activeElement` here (on mount) is too late for a caller that unmounts
  // its own trigger in the same commit that opens Settings (the account menu closes its popover
  // — including the "Settings" button just clicked — via the same batched update that sets
  // Settings open, so by the time this effect runs the trigger is already gone and activeElement
  // has already reverted to <body>). The opener is captured by the caller instead, before that
  // happens, and handed down; `document.activeElement` remains the fallback for callers (the
  // `⌘,` shortcut) that never captured one. If neither is usable any more, land on the composer —
  // the one control guaranteed to exist in every view Settings can be opened from.
  const opener = props.opener;
  useEffect(() => {
    const previous = opener?.current ?? (document.activeElement as HTMLElement | null);
    stage.current?.querySelector<HTMLElement>('[aria-current="page"], .settings-navigation nav button')?.focus({ preventScroll: true });
    return () => {
      closeFocusTarget(previous, document.querySelector<HTMLElement>('.composer-input'))?.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const groups: Group[] = useMemo(() => localiseGroups([...PERSONAL, ...(isAdmin ? [ADMIN] : [])], t), [isAdmin, t]);

  // A member who was viewing an admin section (or a stale saved section) must
  // not be left staring at an empty pane.
  useEffect(() => {
    // Wait for the profile: admin sections appear only once the role is known.
    // Reported as a redirect (#359): the address bar replaces the unavailable section rather than
    // adding a history entry, or Back would land on it and bounce straight forward again.
    if (profileKnown && !groups.some((g) => g.items.some(([id]) => id === section))) { setSection('appearance'); props.onSection?.('appearance', { replace: true }); }
  }, [groups, section, profileKnown]);

  const title = groups.flatMap(g => g.items).find(([id]) => id === section)?.[1] || t('settings.title');
  const filtered = filterGroups(groups, query);
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

  return <section ref={stage} className={`settings-stage${closing ? ' is-closing' : ''}`} data-view={view} role="region" aria-label={t('settings.title')}>
    <aside className="settings-navigation">
      <div className="settings-nav-head">
        {/* #305: the old "Back to app" button here duplicated the X (both closed Settings). It
            is gone — the mobile drill-in's own back is the "All settings" chevron in the detail
            header below (.settings-list-back), which already only appears when there is a
            section to step back to; X (here in list view, in the detail header otherwise) is
            the only close. */}
        <h1 className="settings-nav-title">{t('settings.title')}</h1>
        {/* The section list (mobile only) hides the detail pane's Close button along with the
            rest of the detail pane, so it needs its own — still the same single close action. */}
        {view === 'list' && <CloseButton onClick={close} label={t('settings.close')}/>}
      </div>
      <div className="settings-search"><ShellIcon name="search" size={16}/><input aria-label={t('settings.search')} placeholder={t('settings.search')} value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="settings-search-clear" onClick={clearSearch} aria-label={t('settings.clearSearchLabel')}><ShellIcon name="close" size={16}/></button>}</div>
      {profileError && <p className="route-note" role="alert">{t('settings.accessError')} <button className="popup-tab" onClick={() => setProfileAttempt(n => n + 1)}>{t('settings.retryAccess')}</button></p>}
      <nav aria-label={t('settings.categories')}>
        {filtered.map(g => g.items.length > 0 && <section key={g.name} className={g.admin ? 'settings-nav-admin' : undefined} aria-label={g.name}>
          {g.name && <h2>{g.name}{g.admin && <small className="settings-nav-badge">{t('settings.adminsOnly')}</small>}</h2>}
          {g.items.map(([id, label]) => <button key={id} aria-current={section === id ? 'page' : undefined} className={section === id ? 'is-active' : ''} onClick={() => open(id)}>
            <ShellIcon name={ICONS[id] || 'settings'} size={17}/><span>{label}</span><ShellIcon name="chevron-right" size={16}/>
          </button>)}
        </section>)}
        {filtered.every(g => !g.items.length) && <div className="settings-search-empty" role="status"><strong>{t('settings.noMatch')}</strong><p>{t('settings.noMatchHint')}</p><button className="btn btn-secondary" onClick={clearSearch}>{t('settings.clearSearch')}</button></div>}
      </nav>
    </aside>
    <section className="settings-detail" aria-label={title}>
      <header>
        <button className="shell-icon-button settings-list-back" onClick={showList} aria-label={t('settings.allSettings')}><ShellIcon name="chevron-left"/></button>
        <span>{title}</span>
        {/* Mounted only in detail view: the list view renders its own (#305), so exactly one
            "Close settings" button ever exists — no ambiguity for queries or assistive tech. */}
        {view === 'detail' && <CloseButton onClick={close} label={t('settings.close')}/>}
      </header>
      <div className="settings-detail-scroll" key={section} tabIndex={-1} aria-label={title}>
        <SettingsPanelBoundary>
        {['security', 'users', 'diary', 'providers', 'models', 'status'].includes(section) ? (
          <SettingsView {...props} section={section}/>
        ) : section === 'profile' ? (
          <ProfileSettings />
        ) : section === 'appearance' ? (
          <><AppearanceSettings theme={props.theme} onTheme={props.onTheme} preference={props.preference} onPreference={props.onPreference} appearanceStatus={props.appearanceStatus}
            appearanceError={props.appearanceError} retryAppearance={props.retryAppearance} /><LanguageSettings onOpen={open}/></>
        ) : section === 'keyboard' ? (
          <KeyboardSettings />
        ) : section === 'memory' ? (
          <MemorySettings onOpenDiary={props.onOpenDiary} />
        ) : section === 'notifications' ? (
          <NotificationSettings />
        ) : (section === 'features' || section === 'experimental') && isAdmin ? (
          <FeatureSettings key={section} experimental={section === 'experimental'} />
        ) : section === 'address' && isAdmin ? (
          <WebAddressSettings/>
        ) : section === 'backups' && isAdmin ? (
          <OffsiteBackupSettings />
        ) : section === 'connectors' ? (
          <ConnectorsSettings isAdmin={isAdmin} onStartChat={props.onStartChat}/>
        ) : section === 'capabilities' && isAdmin ? (
          <CapabilitiesSettings />
        ) : section === 'personalization' ? (
          <PersonalizationSettings onOpen={open} />
        ) : section === 'data' ? (
          <DataSettings onManageArchived={props.onOpenArchived} />
        ) : section === 'usage' ? (
          <UsageView/>
        ) : null}
        </SettingsPanelBoundary>
      </div>
    </section>
  </section>;
}
