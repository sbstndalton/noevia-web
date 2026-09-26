import { useEffect, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { SegmentedControl } from './SegmentedControl';
import { LayoutModeChoice, layoutModeDescription } from './LayoutMode';
import { fetchHealth, fetchProfile, fetchToolboxes, updateProfile } from '../api';
import type { AuthUser } from '../api';
import type { HealthState } from '../types';
import { readPreference, writePreference } from '../preferences';
import type { PreferenceName } from '../preferences';
import { applyPalette, currentPalette, palettes } from '../appearance';
import type { Palette } from '../appearance';
import { FAMILIES, FAMILY_SPECS } from '../theme-family';
import type { Family } from '../theme-family';
import { Logo } from './Icons';
import { useT } from '../i18n';
import type { MessageKey, Translate } from '../i18n';

/** The accent palettes, restored at the user's request (2026-09-18). Each name says what
 *  it looks like rather than what it is called internally. */
const PALETTE_LABELS: Record<Palette, MessageKey> = {
  iris: 'appearance.palette.iris', warm: 'appearance.palette.warm', cool: 'appearance.palette.cool', neutral: 'appearance.palette.neutral', sage: 'appearance.palette.sage',
};

/** useAppearance reports its sync state in English; shown here in the interface language. */
const APPEARANCE_STATUS: Record<string, MessageKey> = {
  'Saving appearance…': 'appearance.status.saving',
  'Saved to your profile': 'appearance.status.saved',
  'Appearance could not be saved to your profile. Your choices are still applied here. Retry to save.': 'appearance.status.saveError',
  'Loading profile appearance…': 'appearance.status.loading',
  'Profile appearance could not be loaded. Changes stay in this browser until you retry.': 'appearance.status.loadError',
};

/** A live preview: the tiles carry the palette attribute themselves, so each swatch is
 *  drawn by the same tokens the app would use — never a hard-coded approximation. The
 *  mode has to travel with it, because the generated dark block is written as
 *  `:not([data-theme='light'])` and would otherwise match a tile that names no mode. */
function AccentChoice({ mode }: { mode: 'light' | 'dark' }): JSX.Element {
  const t = useT();
  const [chosen, setChosen] = useState<Palette>(() => currentPalette());
  useEffect(() => {
    const sync = () => setChosen(currentPalette());
    window.addEventListener('cowork:appearance', sync);
    return () => window.removeEventListener('cowork:appearance', sync);
  }, []);
  return <div className="accent-choice" role="radiogroup" aria-label={t('appearance.accent')}>
    {palettes.map((name) => <button
      key={name}
      role="radio"
      aria-checked={chosen === name}
      className={`accent-tile${chosen === name ? ' is-active' : ''}`}
      onClick={() => { applyPalette(name); setChosen(name); }}
    >
      <span className="accent-swatch" data-palette={name} data-theme={mode} aria-hidden="true"><i /><i /><i /></span>
      {t(PALETTE_LABELS[name])}
    </button>)}
  </div>;
}

/** Theme families (#249) as live previews. Each sample carries data-family, data-theme and
 *  data-palette and the `theme-scope` class, so tokens.css and themes.css resolve it exactly
 *  as they resolve the app: the preview is the real family, in light and in dark, with the
 *  current accent — never a screenshot. Choosing one writes the per-device preference, which
 *  sets data-family on <html> and restyles the whole interface at once. */
function FamilyPreview({ family, mode, palette }: { family: Family; mode: 'light' | 'dark'; palette: Palette }): JSX.Element {
  const t = useT();
  return <span className="family-preview theme-scope" data-family={family} data-theme={mode} data-palette={palette} aria-hidden="true">
    <span className="family-preview-mark"><Logo/><span>noevia</span></span>
    <span className="family-preview-heading">{t('appearance.preview.greeting')}</span>
    <span className="family-preview-message">{t('appearance.preview.message')}</span>
    <span className="family-preview-row">
      <span className="family-preview-composer">{t('composer.placeholder')}<i className="family-preview-send" /></span>
      <span className="family-preview-menu"><span>Chat</span><span>Cowork</span></span>
    </span>
    <span className="family-preview-controls"><span className="family-preview-button is-primary">{t('common.save')}</span><span className="family-preview-button">{t('common.cancel')}</span></span>
  </span>;
}

export function FamilyChoice({ onChange }: { onChange?: () => void }): JSX.Element {
  const t = useT();
  const [chosen, setChosen] = useState<Family>(() => readPreference('family'));
  const [palette, setPalette] = useState<Palette>(() => currentPalette());
  useEffect(() => {
    // The previews use every family's typeface; load them now rather than on first switch.
    window.dispatchEvent(new Event('noevia:preview-fonts'));
    const sync = () => setPalette(currentPalette());
    window.addEventListener('cowork:appearance', sync);
    return () => window.removeEventListener('cowork:appearance', sync);
  }, []);
  const choose = (next: Family) => { setChosen(next); writePreference('family', next); onChange?.(); };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = FAMILIES[(FAMILIES.indexOf(chosen) + step + FAMILIES.length) % FAMILIES.length];
    choose(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-choice="${next}"]`)?.focus();
  };
  return <div className="family-choice" role="radiogroup" aria-label={t('appearance.family')} onKeyDown={onKey}>
    {FAMILIES.map((name) => {
      const spec = FAMILY_SPECS[name];
      return <button key={name} type="button" role="radio" data-choice={name} aria-checked={chosen === name} tabIndex={chosen === name ? 0 : -1}
        className="family-tile" onClick={() => choose(name)}>
        <span className="family-tile-previews">
          <FamilyPreview family={name} mode="light" palette={palette} />
          <FamilyPreview family={name} mode="dark" palette={palette} />
        </span>
        <span className="family-tile-name">{spec.label}</span>
        <span className="family-tile-desc">{t(`appearance.family.${name}` as MessageKey)} {spec.display === spec.ui ? t('appearance.family.setIn', { font: spec.ui }) : t('appearance.family.pair', { display: spec.display, ui: spec.ui })}</span>
      </button>;
    })}
  </div>;
}

// One row: the label and description above the control at every width. Used for
// every preference and capability here so the page reads as a list of
// decisions rather than a pile of unrelated widgets.
function Row({ label, description, children }: { label: string; description: string; children: JSX.Element }): JSX.Element {
  return <div className="set-row">
    <div className="set-row-text"><span className="set-row-label">{label}</span><span className="set-row-desc">{description}</span></div>
    <div className="set-row-control">{children}</div>
  </div>;
}

function Choice<N extends PreferenceName>({ name, options, onChange, segmented, label }: {
  name: N; options: [string, string][]; onChange: () => void; segmented?: string; label?: string;
}): JSX.Element {
  const [value, setValue] = useState(() => readPreference(name));
  if (segmented) return <SegmentedControl label={segmented} value={value as string} options={options}
    onChange={(next) => { setValue(next as typeof value); writePreference(name, next as typeof value); onChange(); }} />;
  return <select aria-label={label || name} value={value} onChange={(e) => {
    const next = e.target.value as typeof value;
    setValue(next); writePreference(name, next); onChange();
  }}>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>;
}

export function ProfileSettings(): JSX.Element {
  const t = useT();
  return <>
    <div className="settings-title"><h1>{t('settings.section.profile')}</h1><p>{t('profile.intro')}</p></div>
    <ProfileCard />
  </>;
}

export function CapabilitiesSettings(): JSX.Element {
  const t = useT();
  return <>
    <div className="settings-title"><h1>{t('capabilities.title')}</h1><p>{t('capabilities.intro')}</p></div>
    <CapabilitiesCard />
  </>;
}

export function AppearanceSettings({ theme, onTheme, preference, onPreference, appearanceStatus, appearanceError, retryAppearance }: {
  theme: 'light' | 'dark';
  onTheme: (theme: 'light' | 'dark') => void;
  preference?: 'light' | 'dark' | 'system';
  onPreference?: (preference: 'light' | 'dark' | 'system') => void;
  appearanceStatus?: string;
  appearanceError?: boolean;
  retryAppearance?: () => void;
}): JSX.Element {
  // Bumped whenever a preference changes, so anything measuring the page
  // re-reads it rather than showing a stale value.
  const [, setRevision] = useState(0);
  const bump = () => setRevision((n) => n + 1);
  const t = useT();

  return <>
    <div className="settings-title"><h1>{t('settings.section.appearance')}</h1><p>{t('appearance.intro')}</p></div>

    <section className="settings-section appearance-section">
      <h2>{t('appearance.heading')}</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{t('appearance.theme')}</span><span className="set-row-desc">{t('appearance.themeDesc')}</span></div>
          <div className="theme-choice" role="group" aria-label={t('appearance.mode')}>{(['system', 'light', 'dark'] as const).map((mode) => {
            const chosen = (preference ?? theme) === mode;
            const swatch = mode === 'system' ? theme : mode;
            return <button className={chosen ? 'is-active' : ''} aria-pressed={chosen} key={mode} onClick={() => (onPreference ? onPreference(mode) : mode !== 'system' && onTheme(mode))}>
              <span className={`theme-swatch ${swatch}${mode === 'system' ? ' is-system' : ''}`} data-theme={swatch}><i /><i /><i /></span>{mode === 'system' ? t('common.system') : mode === 'light' ? t('appearance.light') : t('appearance.dark')}
            </button>;
          })}</div>
        </div>

        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{t('appearance.accent')}</span><span className="set-row-desc">{t('appearance.accentDesc')}</span></div>
          <AccentChoice mode={theme} />
        </div>
        <Row label={t('appearance.family')} description={t('appearance.familyDesc')}>
          <FamilyChoice onChange={bump} />
        </Row>
      </div>
      <h2>{t('appearance.reading')}</h2>
      <div className="set-rows">
        <Row label={t('appearance.chatFont')} description={t('appearance.chatFontDesc')}>
          <Choice name="chatFont" label={t('appearance.chatFont')} onChange={bump} options={[['sans', t('appearance.font.sans')], ['serif', t('appearance.font.serif')], ['mono', t('appearance.font.mono')]]} />
        </Row>
        <Row label={t('appearance.density')} description={t('appearance.densityDesc')}>
          <Choice name="density" segmented={t('appearance.density')} onChange={bump} options={[['comfortable', t('appearance.density.comfortable')], ['compact', t('appearance.density.compact')]]} />
        </Row>
        <Row label={t('appearance.motion')} description={t('appearance.motionDesc')}>
          <Choice name="motion" segmented={t('appearance.motion')} onChange={bump} options={[['system', t('common.system')], ['reduced', t('appearance.motion.reduced')]]} />
        </Row>
        <Row label={t('appearance.layout')} description={layoutModeDescription(t)}>
          <LayoutModeChoice />
        </Row>
      </div>
      <p className="route-note">
        {t('appearance.deviceNote')}
        {' '}{t('appearance.accountNote')}
      </p>
      <p role={appearanceError ? 'alert' : 'status'} className="route-note">{appearanceStatus && APPEARANCE_STATUS[appearanceStatus] ? t(APPEARANCE_STATUS[appearanceStatus]) : appearanceStatus}</p>
      {appearanceError && <button className="modal-btn secondary" onClick={retryAppearance}>{t('appearance.retry')}</button>}
    </section>
  </>;
}

function ProfileCard(): JSX.Element {
  const t = useT();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [name, setName] = useState('');
  const [state, setState] = useState<{ busy: boolean; message: string; error: boolean }>({ busy: false, message: '', error: false });

  useEffect(() => {
    let live = true;
    fetchProfile().then((p) => { if (live) { setUser(p.user); setName(p.user.displayName); } })
      .catch(() => { if (live) setState({ busy: false, message: t('profile.loadError'), error: true }); });
    return () => { live = false; };
  }, []);

  const save = async () => {
    const next = name.trim();
    if (!next || !user || next === user.displayName) return;
    setState({ busy: true, message: '', error: false });
    try {
      await updateProfile(next);
      setUser({ ...user, displayName: next });
      setState({ busy: false, message: t('common.saved'), error: false });
    } catch { setState({ busy: false, message: t('profile.saveError'), error: true }); }
  };

  const initials = (user?.displayName || user?.username || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

  return <section className="settings-section">
    <div className="set-rows">
      <Row label={t('profile.avatar')} description={t('profile.avatarDesc')}>
        <span className="set-avatar" aria-hidden="true">{initials || '?'}</span>
      </Row>
      <Row label={t('profile.displayName')} description={t('profile.displayNameDesc')}>
        <span className="set-name-field">
          <input aria-label={t('profile.displayName')} value={name} disabled={!user || state.busy} maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
          <button className="modal-btn secondary" disabled={!user || state.busy || !name.trim() || name.trim() === user?.displayName}
            onClick={() => void save()}>{state.busy ? t('common.saving') : t('common.save')}</button>
        </span>
      </Row>
      <Row label={t('profile.username')} description={t('profile.usernameDesc')}>
        <span className="set-static">{user?.username || '—'}</span>
      </Row>
      <Row label={t('profile.role')} description={t('profile.roleDesc')}>
        <span className="set-static">{user ? (user.role === 'admin' ? t('profile.admin') : t('profile.member')) : '—'}</span>
      </Row>
    </div>
    {state.message && <p className={state.error ? 'modal-err' : 'route-note'} role={state.error ? 'alert' : 'status'}>{state.message}</p>}
    <p className="route-note">{t('profile.securityNote')}</p>
  </section>;
}

// #340: ragAvailable() alone only ever meant "native index deps installed" — a restarting or
// unreachable embedding service left it true while semantic search returned nothing. `retrieval`
// is the tri-state that distinguishes that from a real outage; a deployment that only sends the
// older boolean (mixed-version rollout) still gets a truthful available/unavailable read.
export function retrievalState(health: HealthState | null): 'available' | 'degraded' | 'unavailable' | null {
  if (!health) return null;
  if (health.retrieval) return health.retrieval;
  if (health.ragAvailable == null) return null;
  return health.ragAvailable ? 'available' : 'unavailable';
}

export function retrievalDescription(health: HealthState | null, t: Translate): string {
  return retrievalState(health) === 'degraded' ? t('capabilities.retrievalDegradedNote') : t('capabilities.retrievalDesc');
}

export function retrievalBadge(health: HealthState | null, t: Translate, badge: (on: boolean | null, onText: string, offText: string) => JSX.Element): JSX.Element {
  const state = retrievalState(health);
  if (state === 'degraded') return <span className="set-badge is-warn">{t('capabilities.retrievalDegraded')}</span>;
  return badge(state === null ? null : state === 'available', t('capabilities.available'), t('capabilities.noIndex'));
}

// What this deployment can actually do, with the real state of each. These are
// reported rather than toggled: every one of them is either configured by the
// operator (tools, retrieval) or has its own screen (the Diary), and a second
// switch here would be a second source of truth for the same thing.
function CapabilitiesCard(): JSX.Element {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [tools, setTools] = useState<{ configured: boolean; count: number; error: string | null } | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const t = useT();

  useEffect(() => {
    let live = true;
    fetchHealth().then((h) => { if (live) setHealth(h); }).catch(() => undefined);
    fetchProfile().then((p) => { if (live) setUser(p.user); }).catch(() => undefined);
    fetchToolboxes().then((r) => { if (live) setTools({ configured: !!r.mcp?.configured, count: (r.toolboxes || []).length, error: r.mcp?.error || null }); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const badge = (on: boolean | null, onText: string, offText: string) =>
    <span className={`set-badge${on ? ' is-on' : ''}`}>{on === null ? t('common.checking') : on ? onText : offText}</span>;

  return <section className="settings-section">
    <div className="set-rows">
      <Row label={t('sidebar.diary')} description={t('capabilities.diaryDesc')}>
        {badge(user ? user.diaryEnabled : null, t('common.on'), t('common.off'))}
      </Row>
      <Row label={t('capabilities.tools')} description={t('capabilities.toolsDesc')}>
        {badge(tools ? tools.configured && !tools.error : null, tools ? t.plural('capabilities.toolboxes', tools.count) : t('common.on'), tools?.error ? t('capabilities.unavailable') : t('capabilities.notConfigured'))}
      </Row>
      <Row label={t('capabilities.retrieval')} description={retrievalDescription(health, t)}>
        {retrievalBadge(health, t, badge)}
      </Row>
      <Row label={t('capabilities.inference')} description={t('capabilities.inferenceDesc')}>
        {badge(health ? health.inferenceUp : null, t('capabilities.reachable'), t('capabilities.unreachable'))}
      </Row>
    </div>
    <p className="route-note">
      {t('capabilities.approvalNote')}
    </p>
  </section>;
}
