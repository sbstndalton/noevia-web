import { appLocale } from '../user-preferences';
import { McpStatus } from './McpStatus';
import { ShellIcon } from './ShellIcon';
import DiarySharing from './DiarySharing';
import DiaryConnectors from './DiaryConnectors';
import AppPasswords from './AppPasswords';
import { ModelsSummary } from './models/ModelsSummary';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { HealthState, InstalledModel, LiveStats, Project, Provider, RouteRule } from '../types';
import { createInvitation, createRecovery, deleteProvider, deleteUser, fetchProfile, fetchProviders, fetchUsers, logout, passkeyRegistrationOptions, passkeyRegistrationVerify, removePasskey, revokeSession, setUserDisabled, updateFeatures } from '../api';
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
  onOpenModelManager: () => void;
  diaryEnabled: boolean;
  onDiaryEnabledChange: (enabled: boolean) => void;
}

export function SettingsView({ models, modelsError, health, stats, diaryEnabled, onDiaryEnabledChange, onOpenModelManager, section = 'profile' }: SettingsViewProps): JSX.Element {
  return <div className="settings-live-content">
    {section === 'security' && <SecurityCard />}
    {section === 'users' && <UsersCard />}
    {section === 'diary' && <><div className="settings-title"><h1>Diary &amp; storage</h1><p>Enable Diary and manage where its journal and corpus data are stored.</p></div><DiaryAddonCard enabled={diaryEnabled} onChange={onDiaryEnabledChange}/>{diaryEnabled && <StorageCard />}</>}
    {section === 'providers' && <ProvidersCard />}
    {section === 'models' && <ModelsSummary models={models} modelsError={modelsError} health={health} stats={stats} onOpen={onOpenModelManager}/>}
    {section === 'status' && <><McpStatus /><h2>Connected services</h2><div className="card-list">{[['Inference',health.inferenceUp],['Diary',diaryEnabled?health.diaryUp:null],['Project retrieval',health.ragAvailable]].map(([label,up])=><div className="model-row" key={String(label)}><span className={`model-dot${up?'':' down'}`}/><span className="model-name">{label}</span><span className="model-role">{up===true?'available':up===false?'unavailable':'not available'}</span></div>)}</div><h2>Live engine</h2><div className="settings-stat-row"><div><span title="Provider-reported rate. Invalid samples and samples shorter than one estimated second are omitted.">Reported tokens / second</span><strong>{stats?.tokensPerSecond?.toFixed(1) ?? '—'}</strong></div><div><span>Requests</span><strong>{stats?.requestCount ?? '—'}</strong></div><div><span>VRAM</span><strong>{stats?.vramGb != null ? `${stats.vramGb.toFixed(1)} GB`:'—'}</strong></div></div></>}
  </div>;
}

function DiaryAddonCard({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = async () => {
    const next = !enabled;
    setBusy(true);
    setError('');
    try {
      const result = await updateFeatures(next);
      onChange(result.diaryEnabled);
    } catch {
      setError('Diary preference could not be confirmed. Showing the last confirmed setting. Try again or reload.');
    } finally {
      setBusy(false);
    }
  };
  return <div><div className="rail-label" style={{ marginBottom: 12 }}>Optional apps</div><div className="card-list">
    <div className="model-row"><span className={`model-dot${enabled ? '' : ' down'}`} /><div className="model-name-group"><span className="model-name">Diary</span><span className="model-quant">Private journaling, memory, and configurable corpus storage</span></div><button className="popup-tab" disabled={busy} onClick={() => void toggle()}>{busy ? 'Saving…' : enabled ? 'Disable' : 'Enable'}</button></div>
  </div>{error && <p className="modal-err" role="alert">{error}</p>}<p className="route-note">Saved to your account. Disabling Diary does not delete journal files.</p></div>;
}

function StorageCard(): JSX.Element {
  return <div>
    <div className="rail-label" style={{ marginBottom: 12 }}>Diary storage</div>
    <StoragePicker />
    <DiarySharing />
    <DiaryConnectors />
  </div>;
}

/** Short device label from a session's User-Agent (browser-focused). */
function sessionLabel(ua?: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` · ${os}` : ''}`;
}

// Account security only; identity (name, username, role) is the Profile page.
function SecurityCard(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const refresh = async () => {
    const p = await fetchProfile();
    setUser(p.user); setPasskeys(p.passkeys); setSessions(p.sessions ?? []);
  };
  const load = async () => {
    setLoading(true); setError('');
    try { await refresh(); }
    catch { setError('Profile could not be loaded. Check your connection and retry.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const act = async (label: string, action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(label); setError(''); setNotice(null);
    try {
      await action();
      setNotice(success);
      try { await refresh(); }
      catch { setError('The change succeeded, but the updated profile could not be loaded. Retry loading before making another change.'); }
    } catch (e) {
      // A browser refusal (cancelled, wrong address, unsupported) is not a connection problem.
      const name = (e as Error)?.name;
      if (name === 'NotAllowedError' || name === 'AbortError') setError(`${label} was cancelled or timed out. Nothing was changed.`);
      else if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotSupportedError') setError(`${label} was refused by the browser: ${(e as Error).message}`);
      else setError(`${label} could not be confirmed. Check your connection, then reload to check the saved state.`);
    }
    finally { setBusy(''); }
  };
  const addKey = async () => {
    const c = await passkeyRegistrationOptions();
    const response = await startRegistration({ optionsJSON: c.options });
    await passkeyRegistrationVerify(c.challengeToken, response, `Passkey ${passkeys.length + 1}`);
  };
  if (!user) return <div><h2>Security</h2>{loading ? <p role="status">Loading profile…</p> : <><p className="modal-err" role="alert">{error}</p><button className="modal-btn secondary" onClick={() => void load()}>Retry profile</button></>}</div>;
  return <div>
    <div className="settings-title"><h1>Security and login</h1><p>Passkeys, signed-in sessions and app passwords for {user.username}.</p></div>
    <fieldset className="settings-action-group" disabled={!!busy || loading}><div className="card-list">
      {passkeys.map(k => <div className="model-row" key={k.id}><span className="model-dot"/><div className="model-name-group"><span className="model-name">{k.name}</span><span className="model-quant">{k.backedUp ? 'synced passkey' : k.deviceType}</span></div><button className="recents-del" aria-label={`Remove passkey ${k.name}`} onClick={() => void act('Remove passkey', () => removePasskey(k.id), 'Passkey removed.')}><ShellIcon name="close" size={16}/></button></div>)}
      <button className="modal-btn secondary" onClick={() => void act('Passkey setup', addKey, 'Passkey added.')}><ShellIcon name="plus" size={16}/>Add passkey</button>
      {sessions.length > 0 && sessions.map(s => (
        <div className="model-row" key={s.id}>
          <span className="model-dot" />
          <div className="model-name-group">
            <span className="model-name">{sessionLabel(s.userAgent)}</span>
            <span className="model-quant">
              {s.ip || 'unknown IP'} · last seen {new Date(s.lastSeenAt).toLocaleString(appLocale())}
            </span>
          </div>
          <button className="recents-del" title="Revoke session" aria-label={`Revoke session ${sessionLabel(s.userAgent)}`} onClick={() => void act('Revoke session', () => revokeSession(s.id), 'Session revoked.')}><ShellIcon name="close" size={16}/></button>
        </div>
      ))}
      <button className="modal-btn secondary" onClick={() => void act('Sign out', async () => { await logout(); window.location.reload(); }, 'Signed out.')}>Sign out</button>
    </div>
    </fieldset>
    {busy && <p role="status">{busy}…</p>}
    {notice && <p className="route-note" role="status">{notice}</p>}
    {error && <><p className="modal-err" role="alert">{error}</p><button className="modal-btn secondary" disabled={!!busy || loading} onClick={() => void load()}>{loading ? 'Loading…' : 'Reload profile'}</button></>}
    <AppPasswords />
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
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const pending = useRef(new Set<string>());
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, { error?: string; notice?: string; link?: string }>>({});
  const listRequest = useRef(0);
  const refreshUsers = async () => {
    const request = ++listRequest.current;
    const result = await fetchUsers();
    if (request === listRequest.current) { setUsers(result.users); setError(null); }
  };
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const profile = await fetchProfile();
      setUser(profile.user);
      setDenied(profile.user.role !== 'admin');
      if (profile.user.role === 'admin') await refreshUsers();
    } catch {
      setError('Users could not be loaded. Please try again.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const act = async (key: string, label: string, action: () => Promise<unknown>, success: string, reload = true, globalSuccess = false) => {
    // Ref closes the gap before React renders the disabled controls.
    if (pending.current.has(key)) return;
    pending.current.add(key);
    setBusy(prev => ({ ...prev, [key]: label }));
    setFeedback(prev => ({ ...prev, [key]: {} }));
    setNotice('');
    try {
      await action();
      if (reload) {
        if (globalSuccess) setNotice(success);
        else setFeedback(prev => ({ ...prev, [key]: { notice: success } }));
        try { await refreshUsers(); }
        catch { setError('The change succeeded, but the updated users could not be loaded. Reload users to confirm the saved state.'); }
      }
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : `${label} could not be confirmed. Reload users to check the saved state, then try again.`;
      setFeedback(prev => ({ ...prev, [key]: { error: message } }));
    } finally {
      pending.current.delete(key);
      setBusy(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
  };
  const copyLink = async (key: string, link: string, label: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setFeedback(prev => ({ ...prev, [key]: { notice: `${label} copied.`, link } }));
    } catch {
      setFeedback(prev => ({ ...prev, [key]: { error: `${label} was created, but copying failed. Copy the link below or try copying again.`, link } }));
    }
  };
  const createLink = (key: string, recoveryId?: string) => act(key, recoveryId ? 'Create recovery link' : 'Create invitation', async () => {
    const result = recoveryId ? await createRecovery(recoveryId) : await createInvitation();
    const link = `${window.location.origin}/?${recoveryId ? 'recovery' : 'invite'}=${encodeURIComponent(result.token)}`;
    await copyLink(key, link, recoveryId ? 'Recovery link' : 'Single-use invitation (expires in 24 hours)');
  }, '', false);
  const actionFeedback = (key: string) => {
    const value = feedback[key];
    return <>
      {busy[key] && <p className="route-note" role="status">{busy[key]}…</p>}
      {value?.error && <p className="modal-err" role="alert">{value.error}</p>}
      {value?.notice && <p className="route-note" role="status">{value.notice}</p>}
      {value?.link && <div>
        <label className="field">Created link<input className="modal-input" readOnly value={value.link} onFocus={e => e.currentTarget.select()} /></label>
        <button className="popup-tab" disabled={!!busy[key]} onClick={() => void copyLink(key, value.link!, key === 'invitation' ? 'Invitation link' : 'Recovery link')}>Copy link again</button>
      </div>}
    </>;
  };
  if (!user) return <div><h2>Users</h2>{loading ? <p role="status">Loading users…</p> : <><p className="route-note" role="alert">{error}</p><button className="btn btn-secondary" onClick={() => void load()}>Retry users</button></>}</div>;
  if (denied) return <div><div className="rail-label">Users</div><p className="route-note">Administrator access is required to manage accounts.</p></div>;
  return <div>
    <div className="rail-label" style={{ marginBottom: 12 }}>Users</div>
    {notice && <p className="route-note" role="status">{notice}</p>}
    <div className="card-list">
      {users.length === 0 && !loading && <p className="route-note">No users returned by the server.</p>}
      {users.map(u => <div key={u.id}>
        <div className="model-row"><div className="model-name-group"><span className="model-name">{u.displayName}</span><span className="model-quant">@{u.username} · {u.role}{u.disabled ? ' · disabled' : ''}</span></div>{u.id !== user.id && <>
          <button className="popup-tab" disabled={!!busy[u.id] || loading} onClick={() => void act(u.id, u.disabled ? 'Enable account' : 'Disable account', () => setUserDisabled(u.id, !u.disabled), 'Account updated.')}>{u.disabled ? 'Enable' : 'Disable'}</button>
          <button className="popup-tab" disabled={!!busy[u.id] || loading} onClick={() => void createLink(u.id, u.id)}>Recovery</button>
          <button className="recents-del" title="Delete user" aria-label={`Delete user ${u.username}`} disabled={!!busy[u.id] || loading} onClick={() => { const typed = window.prompt(`Type ${u.username} to permanently delete this noevia account. Remote corpus files will be preserved.`); if (typed === u.username) void act(u.id, 'Delete account', () => deleteUser(u.id, typed), 'Account deleted.', true, true); }}><ShellIcon name="close" size={16}/></button>
        </>}</div>{actionFeedback(u.id)}
      </div>)}
      <button className="modal-btn secondary" disabled={!!busy.invitation || loading} onClick={() => void createLink('invitation')}><ShellIcon name="plus" size={16}/>Copy invitation link</button>
      {actionFeedback('invitation')}
    </div>
    {error && <p className="modal-err" role="alert">{error}</p>}
    <button className="popup-tab" disabled={loading || Object.keys(busy).length > 0} onClick={() => void load()}>{loading ? 'Loading…' : 'Reload users'}</button>
  </div>;
}

/** Connect-a-provider flow (step 9): list connected OpenAI-compatible
 *  endpoints, add one via the shared ProviderForm, and remove non-default ones.
 *  Keys live server-side only — the list shows masked hints, never plaintext. */
function ProvidersCard(): JSX.Element {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const refresh = async () => {
    setLoading(true); setErr(null);
    try { const r = await fetchProviders(); setProviders(r.providers); }
    catch { setErr('Connections could not be loaded. Check your connection and retry.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const remove = async (id: string) => {
    setRemoving(id); setErr(null);
    try {
      await deleteProvider(id);
      await refresh();
    } catch {
      setErr('Connection could not be removed. Try again.');
    } finally { setRemoving(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="settings-title"><h1>AI providers</h1><p>Local and connected inference providers available to noevia.</p></div>
      {loading && <p role="status">Loading connections…</p>}
      {!loading && !err && providers.length === 0 && <p className="route-note">No connections saved. Connect a provider to make its models available.</p>}
      {err && <><p className="modal-err" role="alert">{err}</p><button className="modal-btn secondary" disabled={loading || !!removing} onClick={() => void refresh()}>Retry connections</button></>}
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
                <button className="recents-del" title="Remove provider" aria-label={`Remove ${p.label}`} disabled={loading || !!removing} onClick={() => void remove(p.id)}>
                  {removing === p.id ? 'Removing…' : <ShellIcon name="close" size={16}/>}
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
          <button className="modal-btn secondary" style={{ width: 'fit-content' }} onClick={() => setAdding(true)}>
            <ShellIcon name="plus" size={16}/>Connect a provider
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
