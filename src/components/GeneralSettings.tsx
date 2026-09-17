import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { PalettePicker } from './PalettePicker';
import { currentPalette } from '../appearance';
import { fetchHealth, fetchProfile, fetchToolboxes, updateProfile } from '../api';
import type { AuthUser } from '../api';
import type { HealthState } from '../types';
import { readPreference, writePreference } from '../preferences';
import type { PreferenceName } from '../preferences';

// One row: what the setting is on the left, the control on the right. Used for
// every preference and capability here so the page reads as a list of
// decisions rather than a pile of unrelated widgets.
function Row({ label, description, children }: { label: string; description: string; children: JSX.Element }): JSX.Element {
  return <div className="set-row">
    <div className="set-row-text"><span className="set-row-label">{label}</span><span className="set-row-desc">{description}</span></div>
    <div className="set-row-control">{children}</div>
  </div>;
}

function Choice<N extends PreferenceName>({ name, options, onChange }: {
  name: N; options: [string, string][]; onChange: () => void;
}): JSX.Element {
  const [value, setValue] = useState(() => readPreference(name));
  return <select aria-label={name} value={value} onChange={(e) => {
    const next = e.target.value as typeof value;
    setValue(next); writePreference(name, next); onChange();
  }}>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>;
}

export function ProfileSettings(): JSX.Element {
  return <>
    <div className="settings-title"><h1>Profile</h1><p>Who you are here.</p></div>
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
  const [palette, setPalette] = useState(currentPalette);
  // Bumped whenever a preference changes, so anything measuring the page
  // re-reads it rather than showing a stale value.
  const [, setRevision] = useState(0);
  const bump = () => setRevision((n) => n + 1);

  return <>
    <div className="settings-title"><h1>Appearance</h1><p>How noevia looks and moves.</p></div>

    <section className="settings-section">
      <h2>Preferences</h2>
      <div className="set-rows">
        <Row label="Mode" description="System follows your device's light or dark setting. Each mode remembers its own palette, and your choice follows you to other devices.">
          <div className="theme-choice">{(['system', 'light', 'dark'] as const).map((t) => {
            const chosen = (preference ?? theme) === t;
            const swatch = t === 'system' ? theme : t;
            return <button className={chosen ? 'is-active' : ''} aria-pressed={chosen} key={t} onClick={() => (onPreference ? onPreference(t) : t !== 'system' && onTheme(t))}>
              <span className={`theme-swatch ${swatch}${t === 'system' ? ' is-system' : ''}`} data-theme={swatch} data-palette={palette}><i /><i /><i /></span>{t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
            </button>;
          })}</div>
        </Row>
        <div className="set-row set-row-stacked">
          <div className="set-row-text"><span className="set-row-label">Palette</span><span className="set-row-desc">For {theme} mode, the one on screen now. The other mode keeps its own palette.</span></div>
          <PalettePicker theme={theme} onChange={setPalette} bare />
        </div>
        <Row label="Chat font" description="The typeface for messages. The rest of the interface is unchanged.">
          <Choice name="chatFont" onChange={bump} options={[['sans', 'Sans (default)'], ['serif', 'Serif'], ['mono', 'Monospace']]} />
        </Row>
        <Row label="Density" description="Compact tightens the spacing around things without shrinking anything you tap.">
          <Choice name="density" onChange={bump} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} />
        </Row>
        <Row label="Motion" description="System follows your operating system's reduce-motion setting. Reduced turns animation off here regardless.">
          <Choice name="motion" onChange={bump} options={[['system', 'System'], ['reduced', 'Reduced']]} />
        </Row>
      </div>
      <p className="route-note">
        Chat font, density and motion are saved on this device only — how dense you want a screen depends on the screen.
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
    <p className="route-note">Passwords, passkeys, sessions and app passwords are under Security.</p>
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
