import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { HealthState, InstalledModel, LiveStats, Project, Provider, RouteRule } from '../types';
import { createInvitation, createRecovery, deleteProvider, deleteUser, fetchProfile, fetchProviders, fetchUsers, logout, passkeyRegistrationOptions, passkeyRegistrationVerify, removePasskey, revokeSession, setUserDisabled, updateFeatures, updateProfile } from '../api';
import type { AuthUser, PasskeyInfo, SessionInfo } from '../api';
import { startRegistration } from '@simplewebauthn/browser';
import { ProviderForm } from './ProviderForm';
import { StoragePicker } from './StoragePicker';

export interface SettingsViewProps {
  section?: string;
  models: InstalledModel[];
  routes: RouteRule[];
  modelsError: string | null;
  projects: Project[];
  health: HealthState;
  stats: LiveStats | null;
  onOpenModels: () => void;
  diaryEnabled: boolean;
  onDiaryEnabledChange: (enabled: boolean) => void;
}

export function SettingsView({ models, routes, modelsError, projects, health, stats, onOpenModels, diaryEnabled, onDiaryEnabledChange, section = 'profile' }: SettingsViewProps): JSX.Element {
  return <div className="settings-live-content">
    {section === 'profile' && <ProfileCard />}
    {section === 'users' && <UsersCard />}
    {section === 'diary' && <><DiaryAddonCard enabled={diaryEnabled} onChange={onDiaryEnabledChange}/>{diaryEnabled && <StorageCard />}</>}
    {section === 'providers' && <ProvidersCard />}
    {section === 'models' && <><div className="settings-section-heading"><h2>Models</h2><button className="modal-btn secondary" onClick={onOpenModels}>Open model manager</button></div>{modelsError && <p role="alert" className="modal-err">{modelsError}</p>}<div className="card-list">{models.map(m=><div className="model-row" key={m.name}><span className={`model-dot${m.loaded?'':' down'}`}/><div className="model-name-group"><span className="model-name">{m.name}</span><span className="model-quant">{m.sizeGB != null ? `${m.sizeGB} GB` : ''}{m.maxContext ? ` · ${m.maxContext.toLocaleString()} context` : ''}</span></div><span className="model-role">{m.loaded?'loaded':'not loaded'}</span></div>)}</div><h2>Project routing</h2><div className="route-table">{routes.map(r=><div className="route-row" key={r.task}><span>{r.task}</span><span>→</span><span>{r.model}</span></div>)}</div><p className="route-note">{projects.length} projects. Change a project's model from its model selector.</p></>}
    {section === 'status' && <><h2>Connected services</h2><div className="card-list">{[['Inference',health.inferenceUp],['Diary',diaryEnabled?health.diaryUp:null],['Project retrieval',health.ragAvailable]].map(([label,up])=><div className="model-row" key={String(label)}><span className={`model-dot${up?'':' down'}`}/><span className="model-name">{label}</span><span className="model-role">{up===true?'available':up===false?'unavailable':'not available'}</span></div>)}</div><h2>Live engine</h2><div className="settings-stat-row"><div><span>Tokens / second</span><strong>{stats?.tokensPerSecond?.toFixed(1) ?? '—'}</strong></div><div><span>Requests</span><strong>{stats?.requestCount ?? '—'}</strong></div><div><span>VRAM</span><strong>{stats?.vramGb != null ? `${stats.vramGb.toFixed(1)} GB`:'—'}</strong></div></div></>}
  </div>;
}

function DiaryAddonCard({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    const next = !enabled;
    setBusy(true);
    try {
      const result = await updateFeatures(next);
      onChange(result.diaryEnabled);
    } finally {
      setBusy(false);
    }
  };
  return <div><div className="rail-label" style={{ marginBottom: 12 }}>Optional apps</div><div className="card-list">
    <div className="model-row"><span className={`model-dot${enabled ? '' : ' down'}`} /><div className="model-name-group"><span className="model-name">Diary</span><span className="model-quant">Private journaling, memory, and configurable corpus storage</span></div><button className="popup-tab" disabled={busy} onClick={() => void toggle()}>{busy ? 'Saving…' : enabled ? 'Disable' : 'Enable'}</button></div>
  </div></div>;
}

function StorageCard(): JSX.Element {
  return <div>
    <div className="rail-label" style={{ marginBottom: 12 }}>Diary storage</div>
    <StoragePicker />
  </div>;
}

/** Short device label from a session's User-Agent (browser-focused). */
function sessionLabel(ua?: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` · ${os}` : ''}`;
}

function ProfileCard(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => fetchProfile().then(p => { setUser(p.user); setName(p.user.displayName); setPasskeys(p.passkeys); setSessions(p.sessions ?? []); });
  useEffect(() => { void refresh(); }, []);
  const addKey = async () => { const c = await passkeyRegistrationOptions(); const response = await startRegistration({ optionsJSON: c.options }); await passkeyRegistrationVerify(c.challengeToken, response, `Passkey ${passkeys.length + 1}`); refresh(); };
  if (!user) return <div><div className="rail-label">Profile</div><p className="route-note">Loading…</p></div>;
  return <div>
    <div className="rail-label" style={{ marginBottom: 12 }}>Profile and security</div>
    <div className="card-list">
      <div className="model-row"><div className="auth-mark" aria-hidden="true">{user.displayName.slice(0,1).toUpperCase()}</div><div className="model-name-group"><span className="model-name">{user.username}</span><span className="model-quant">{user.role}</span></div></div>
      <div className="model-row"><input className="modal-input" value={name} onChange={e => setName(e.target.value)} /><button className="popup-tab" onClick={() => void updateProfile(name).then(refresh)}>Save name</button></div>
      {passkeys.map(k => <div className="model-row" key={k.id}><span className="model-dot"/><div className="model-name-group"><span className="model-name">{k.name}</span><span className="model-quant">{k.backedUp ? 'synced passkey' : k.deviceType}</span></div><button className="recents-del" onClick={() => void removePasskey(k.id).then(refresh)}>✕</button></div>)}
      <button className="modal-btn secondary" onClick={() => void addKey().catch(() => setNotice('Passkey setup was cancelled.'))}>+ Add passkey</button>
      {sessions.length > 0 && sessions.map(s => (
        <div className="model-row" key={s.id}>
          <span className="model-dot" />
          <div className="model-name-group">
            <span className="model-name">{sessionLabel(s.userAgent)}</span>
            <span className="model-quant">
              {s.ip || 'unknown IP'} · last seen {new Date(s.lastSeenAt).toLocaleString()}
            </span>
          </div>
          <button className="recents-del" title="Revoke session" onClick={() => void revokeSession(s.id).then(refresh)}>✕</button>
        </div>
      ))}
      <button className="modal-btn secondary" onClick={() => void logout().then(() => window.location.reload())}>Sign out</button>
    </div>
    {notice && <p className="route-note">{notice}</p>}
  </div>;
}

/** Administration → Users. Split out of ProfileCard so personal security and
 *  managing other people's accounts are no longer the same page: one is
 *  something every member does, the other is an operator task. The server is
 *  the real gate — /api/users returns 403 to non-admins regardless of what the
 *  navigation shows — so this only decides what is worth rendering. */
function UsersCard(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      const profile = await fetchProfile();
      setUser(profile.user);
      if (profile.user.role !== 'admin') { setDenied(true); return; }
      const result = await fetchUsers();
      setUsers(result.users);
    } catch {
      setError('Users could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  const invite = async () => {
    const x = await createInvitation();
    await navigator.clipboard.writeText(`${window.location.origin}/?invite=${encodeURIComponent(x.token)}`);
    setNotice('Single-use invitation copied. It expires in 24 hours.');
  };
  if (error) return <div><h2>Users</h2><p className="route-note" role="alert">{error}</p><button className="btn btn-secondary" onClick={() => void refresh()}>Retry users</button></div>;
  if (loading || !user) return <div><div className="rail-label">Users</div><p className="route-note">Loading…</p></div>;
  if (denied) return <div><div className="rail-label">Users</div><p className="route-note">Administrator access is required to manage accounts.</p></div>;
  return <div>
    <div className="rail-label" style={{ marginBottom: 12 }}>Users</div>
    <div className="card-list">
      {users.length === 0 && <p className="route-note">No users returned by the server.</p>}
      {users.map(u => <div className="model-row" key={u.id}><div className="model-name-group"><span className="model-name">{u.displayName}</span><span className="model-quant">@{u.username} · {u.role}{u.disabled ? ' · disabled' : ''}</span></div>{u.id !== user.id && <><button className="popup-tab" onClick={() => void setUserDisabled(u.id, !u.disabled).then(refresh)}>{u.disabled ? 'Enable' : 'Disable'}</button><button className="popup-tab" onClick={() => void createRecovery(u.id).then(async r => { await navigator.clipboard.writeText(`${window.location.origin}/?recovery=${r.token}`); setNotice('Recovery link copied.'); })}>Recovery</button><button className="recents-del" title="Delete user" onClick={() => { const typed = window.prompt(`Type ${u.username} to permanently delete this noevia account. Remote corpus files will be preserved.`); if (typed === u.username) void deleteUser(u.id, typed).then(refresh); }}>✕</button></>}</div>)}
      <button className="modal-btn secondary" onClick={() => void invite()}>+ Copy invitation link</button>
    </div>
    {notice && <p className="route-note">{notice}</p>}
  </div>;
}

/** Connect-a-provider flow (step 9): list connected OpenAI-compatible
 *  endpoints, add one via the shared ProviderForm, and remove non-default ones.
 *  Keys live server-side only — the list shows masked hints, never plaintext. */
function ProvidersCard(): JSX.Element {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    fetchProviders().then((r) => setProviders(r.providers || [])).catch(() => setErr('Could not load providers'));
  };
  useEffect(refresh, []);

  const remove = async (id: string) => {
    try {
      await deleteProvider(id);
      refresh();
    } catch {
      setErr('delete failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="card-list">
        {providers.map((p) => (
          <div key={p.id} className="model-row">
            <span className="model-dot" />
            <div className="model-name-group">
              <span className="model-name">{p.label}</span>
              <span className="model-quant">{p.baseUrl}</span>
            </div>
            {p.isDefault ? (
              <span className="model-role">default · always on</span>
            ) : (
              <>
                {p.apiKeyMasked && <span className="model-quant">key {p.apiKeyMasked}</span>}
                <button className="recents-del" title="Remove provider" onClick={() => void remove(p.id)}>
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {adding ? (
        <ProviderForm
          autoFocus
          allowShared
          cancelLabel="Cancel"
          onCancel={() => setAdding(false)}
          onConnected={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : (
        <>
          {err && <p className="modal-err">{err}</p>}
          <button className="modal-btn secondary" style={{ width: 'fit-content' }} onClick={() => setAdding(true)}>
            + Connect a provider
          </button>
          <p className="route-note">
            Any OpenAI-compatible /chat/completions endpoint works (Anthropic, OpenAI,
            OpenRouter…). Keys are stored server-side and never returned in plaintext.
            Pick a provider per project from the model popup.
          </p>
        </>
      )}
    </div>
  );
}
