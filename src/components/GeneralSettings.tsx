import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { SegmentedControl } from './SegmentedControl';
import { LayoutModeChoice, layoutModeDescription } from './LayoutMode';
import { fetchHealth, fetchProfile, fetchToolboxes, updateProfile } from '../api';
import type { AuthUser } from '../api';
import type { HealthState } from '../types';
import { readPreference, writePreference } from '../preferences';
import type { PreferenceName } from '../preferences';
import { applyPalette, currentPalette, palettes } from '../appearance';
import type { Palette } from '../appearance';

/** The accent palettes, restored at the user's request (2026-09-18). Each name says what
 *  it looks like rather than what it is called internally. */
const PALETTE_LABELS: Record<Palette, string> = {
  iris: 'Iris', warm: 'Warm', cool: 'Cool', neutral: 'Neutral', sage: 'Sage',
};

/** A live preview: the tiles carry the palette attribute themselves, so each swatch is
 *  drawn by the same tokens the app would use — never a hard-coded approximation. The
 *  mode has to travel with it, because the generated dark block is written as
 *  `:not([data-theme='light'])` and would otherwise match a tile that names no mode. */
function AccentChoice({ mode }: { mode: 'light' | 'dark' }): JSX.Element {
  const [chosen, setChosen] = useState<Palette>(() => currentPalette());
  useEffect(() => {
    const sync = () => setChosen(currentPalette());
    window.addEventListener('cowork:appearance', sync);
    return () => window.removeEventListener('cowork:appearance', sync);
  }, []);
  return <div className="accent-choice" role="radiogroup" aria-label="Accent">
    {palettes.map((name) => <button
      key={name}
      role="radio"
      aria-checked={chosen === name}
      className={`accent-tile${chosen === name ? ' is-active' : ''}`}
      onClick={() => { applyPalette(name); setChosen(name); }}
    >
      <span className="accent-swatch" data-palette={name} data-theme={mode} aria-hidden="true"><i /><i /><i /></span>
      {PALETTE_LABELS[name]}
    </button>)}
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

function Choice<N extends PreferenceName>({ name, options, onChange, segmented }: {
  name: N; options: [string, string][]; onChange: () => void; segmented?: string;
}): JSX.Element {
  const [value, setValue] = useState(() => readPreference(name));
  if (segmented) return <SegmentedControl label={segmented} value={value as string} options={options}
    onChange={(next) => { setValue(next as typeof value); writePreference(name, next as typeof value); onChange(); }} />;
  return <select aria-label={name} value={value} onChange={(e) => {
    const next = e.target.value as typeof value;
    setValue(next); writePreference(name, next); onChange();
  }}>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>;
}

export function ProfileSettings(): JSX.Element {
  return <>
    <div className="settings-title"><h1>Account</h1><p>Who you are here.</p></div>
    <ProfileCard />
  </>;
}

export function CapabilitiesSettings(): JSX.Element {
  return <>
    <div className="settings-title"><h1>Capabilities</h1><p>What this deployment can do for you right now.</p></div>
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

  return <>
    <div className="settings-title"><h1>General</h1><p>How noevia looks and moves on this device. Theme and material follow you to your other devices.</p></div>

    <section className="settings-section">
      <h2>Theme</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="theme-choice" role="group" aria-label="Mode">{(['system', 'light', 'dark'] as const).map((t) => {
            const chosen = (preference ?? theme) === t;
            const swatch = t === 'system' ? theme : t;
            return <button className={chosen ? 'is-active' : ''} aria-pressed={chosen} key={t} onClick={() => (onPreference ? onPreference(t) : t !== 'system' && onTheme(t))}>
              <span className={`theme-swatch ${swatch}${t === 'system' ? ' is-system' : ''}`} data-theme={swatch}><i /><i /><i /></span>{t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
            </button>;
          })}</div>
        </div>
      </div>
      <h2>Accent</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">Accent</span><span className="set-row-desc">The colour noevia uses for selection, links and the send button. Each one is checked for contrast in both light and dark.</span></div>
        </div>
        <div className="set-row"><AccentChoice mode={theme} /></div>
      </div>
      <h2>Material</h2>
      <div className="set-rows">
        <Row label="Material" description="Liquid glass bends what is behind it (Chrome and Edge; elsewhere it is frosted). Glassmorphism is frosted without bending. Soft shapes everything with light and shadow instead of glass. Material 3 is flat and tonal.">
          <Choice name="material" segmented="Material" onChange={bump} options={[['soft', 'Soft'], ['liquid', 'Liquid glass'], ['glass', 'Glassmorphism'], ['material', 'Material 3']]} />
        </Row>
      </div>
      <h2>Reading and motion</h2>
      <div className="set-rows">
        <Row label="Chat font" description="The typeface for messages. The rest of the interface keeps the system font.">
          <Choice name="chatFont" onChange={bump} options={[['sans', 'Sans (default)'], ['serif', 'Serif'], ['mono', 'Monospace']]} />
        </Row>
        <Row label="Density" description="Compact tightens spacing without shrinking anything you tap.">
          <Choice name="density" segmented="Density" onChange={bump} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} />
        </Row>
        <Row label="Motion" description="Reduced keeps state changes and drops movement, in streaming replies too.">
          <Choice name="motion" segmented="Motion" onChange={bump} options={[['system', 'System'], ['reduced', 'Reduced']]} />
        </Row>
        <Row label="Layout" description={layoutModeDescription()}>
          <LayoutModeChoice />
        </Row>
      </div>
      <p className="route-note">
        Chat font, density, motion and layout are saved on this device only — how dense you want a screen depends on the screen.
        {' '}Appearance follows your account.
      </p>
      <p role={appearanceError ? 'alert' : 'status'} className="route-note">{appearanceStatus}</p>
      {appearanceError && <button className="modal-btn secondary" onClick={retryAppearance}>Retry appearance</button>}
    </section>
  </>;
}

function ProfileCard(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [name, setName] = useState('');
  const [state, setState] = useState<{ busy: boolean; message: string; error: boolean }>({ busy: false, message: '', error: false });

  useEffect(() => {
    let live = true;
    fetchProfile().then((p) => { if (live) { setUser(p.user); setName(p.user.displayName); } })
      .catch(() => { if (live) setState({ busy: false, message: 'Your profile could not be loaded.', error: true }); });
    return () => { live = false; };
  }, []);

  const save = async () => {
    const next = name.trim();
    if (!next || !user || next === user.displayName) return;
    setState({ busy: true, message: '', error: false });
    try {
      await updateProfile(next);
      setUser({ ...user, displayName: next });
      setState({ busy: false, message: 'Saved.', error: false });
    } catch { setState({ busy: false, message: 'That change could not be saved.', error: true }); }
  };

  const initials = (user?.displayName || user?.username || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

  return <section className="settings-section">
    <div className="set-rows">
      <Row label="Avatar" description="Taken from your name. Uploading a picture is not built yet.">
        <span className="set-avatar" aria-hidden="true">{initials || '?'}</span>
      </Row>
      <Row label="Display name" description="What noevia calls you, and what other people on this server see.">
        <span className="set-name-field">
          <input aria-label="Display name" value={name} disabled={!user || state.busy} maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
          <button className="modal-btn secondary" disabled={!user || state.busy || !name.trim() || name.trim() === user?.displayName}
            onClick={() => void save()}>{state.busy ? 'Saving…' : 'Save'}</button>
        </span>
      </Row>
      <Row label="Username" description="Used to sign in. It cannot be changed after the account is created.">
        <span className="set-static">{user?.username || '—'}</span>
      </Row>
      <Row label="Role" description="Administrators can manage users, models and deployment-wide settings.">
        <span className="set-static">{user ? (user.role === 'admin' ? 'Administrator' : 'Member') : '—'}</span>
      </Row>
    </div>
    {state.message && <p className={state.error ? 'modal-err' : 'route-note'} role={state.error ? 'alert' : 'status'}>{state.message}</p>}
    <p className="route-note">Passwords, passkeys, sessions and app passwords are under Security and login.</p>
  </section>;
}

// What this deployment can actually do, with the real state of each. These are
// reported rather than toggled: every one of them is either configured by the
// operator (tools, retrieval) or has its own screen (the Diary), and a second
// switch here would be a second source of truth for the same thing.
function CapabilitiesCard(): JSX.Element {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [tools, setTools] = useState<{ configured: boolean; count: number; error: string | null } | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let live = true;
    fetchHealth().then((h) => { if (live) setHealth(h); }).catch(() => undefined);
    fetchProfile().then((p) => { if (live) setUser(p.user); }).catch(() => undefined);
    fetchToolboxes().then((r) => { if (live) setTools({ configured: !!r.mcp?.configured, count: (r.toolboxes || []).length, error: r.mcp?.error || null }); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const badge = (on: boolean | null, onText: string, offText: string) =>
    <span className={`set-badge${on ? ' is-on' : ''}`}>{on === null ? 'Checking…' : on ? onText : offText}</span>;

  return <section className="settings-section">
    <div className="set-rows">
      <Row label="Diary" description="Private journaling with its own storage and retrieval. Turn it on in Diary & storage.">
        {badge(user ? user.diaryEnabled : null, 'On', 'Off')}
      </Row>
      <Row label="Connected tools" description="Curated MCP toolboxes a project can enable. Configured by the administrator.">
        {badge(tools ? tools.configured && !tools.error : null, tools ? `${tools.count} ${tools.count === 1 ? 'toolbox' : 'toolboxes'}` : 'On', tools?.error ? 'Unavailable' : 'Not configured')}
      </Row>
      <Row label="Project retrieval" description="Searches a project's files for the parts relevant to your message.">
        {badge(health ? health.ragAvailable ?? false : null, 'Available', 'No index on this deployment')}
      </Row>
      <Row label="Inference" description="The engine that answers. Models and routing have their own screen.">
        {badge(health ? health.inferenceUp : null, 'Reachable', 'Unreachable')}
      </Row>
    </div>
    <p className="route-note">
      Write approvals cannot be turned off: every tool that changes something stops for a human, with its arguments shown in full.
      That is the protection against a search result talking a model into deleting a file, so there is no setting for it.
    </p>
  </section>;
}
