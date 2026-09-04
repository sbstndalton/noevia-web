import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { HealthState, InstalledModel, LiveStats, Project, Provider, RouteRule } from '../types';
import { createInvitation, createProvider, createRecovery, deleteProvider, deleteUser, fetchProfile, fetchProviders, fetchStorage, fetchUsers, logout, passkeyRegistrationOptions, passkeyRegistrationVerify, pollNextcloud, removePasskey, saveStorage, setUserDisabled, startNextcloud, testProvider, testStorage, updateFeatures, updateProfile } from '../api';
import type { AuthUser, PasskeyInfo, StorageConnection } from '../api';
import { startRegistration } from '@simplewebauthn/browser';

interface SettingsViewProps {
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

export function SettingsView({
  models,
  routes,
  modelsError,
  projects,
  health,
  stats,
  onOpenModels,
  diaryEnabled,
  onDiaryEnabledChange,
}: SettingsViewProps): JSX.Element {
  return (
    <div className="main">
      <div className="settings-scroll">
        <div className="settings-head">
          <h1>Settings</h1>
          <p>
            The proxy routes each project to its configured OpenAI-compatible provider —
            instructions, files, and memories are applied per project, server-side.
          </p>
        </div>

        <div className="settings-body">
          <ProfileCard />
          <DiaryAddonCard enabled={diaryEnabled} onChange={onDiaryEnabledChange} />
          {diaryEnabled && <StorageCard />}
          <div>
            <div className="rail-label" style={{ marginBottom: 12 }}>Connected services</div>
            <div className="card-list">
              <div className="model-row">
                <span className={`model-dot${health.inferenceUp ? '' : ' down'}`} />
                <div className="model-name-group">
                  <span className="model-name">Default inference</span>
                  <span className="model-quant">chat · embeddings · optional model management</span>
                </div>
                <span className="model-role">
                  {health.inferenceUp ? 'online' : health.inferenceUp === false ? 'unreachable' : 'checking…'}
                </span>
              </div>
              {diaryEnabled && <div className="model-row">
                <span className={`model-dot${health.diaryUp ? '' : ' down'}`} />
                <div className="model-name-group">
                  <span className="model-name">Diary sidecar</span>
                  <span className="model-quant">pipeline · configurable corpus storage</span>
                </div>
                <span className="model-role">
                  {health.diaryUp ? 'online' : health.diaryUp === false ? 'unreachable' : 'checking…'}
                </span>
              </div>}
            </div>
          </div>

          <div>
            <div className="rail-label" style={{ marginBottom: 12 }}>Live engine stats</div>
            <div className="card-list">
              <div className="model-row">
                <span className={`model-dot${stats?.up ? '' : ' down'}`} />
                <div className="model-name-group">
                  <span className="model-name">
                    {stats?.tokensPerSecond != null ? `${stats.tokensPerSecond.toFixed(1)} tok/s` : '— tok/s'}
                  </span>
                  <span className="model-quant">
                    {stats?.timeToFirstToken != null ? `TTFT ${stats.timeToFirstToken.toFixed(2)}s · ` : ''}
                    {stats?.requestCount != null ? `${stats.requestCount} requests · ` : ''}
                    {stats?.vramGb != null ? `${stats.vramGb.toFixed(1)} GB VRAM` : ''}
                  </span>
                </div>
                <span className="model-role">{stats?.up ? 'live' : 'unavailable'}</span>
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="rail-label" style={{ marginBottom: 0 }}>Models</span>
              <button className="popup-tab" style={{ border: '1px solid var(--border)' }} onClick={onOpenModels}>
                open model manager
              </button>
            </div>
            <div className="card-list">
              {modelsError && (
                <div className="model-row">
                  <span className="model-dot down" />
                  <div className="model-name-group">
                    <span className="model-name" style={{ color: 'var(--accent)' }}>{modelsError}</span>
                  </div>
                </div>
              )}
              {models.map((m) => (
                <div key={m.name} className="model-row">
                  <span className={`model-dot${m.loaded ? '' : ' down'}`} title={m.loaded ? 'loaded' : 'not loaded'} />
                  <div className="model-name-group">
                    <span className="model-name">{m.name}</span>
                    <span className="model-quant">
                      {m.sizeGB != null ? `${m.sizeGB} GB` : ''}
                      {m.maxContext ? ` · ${m.maxContext.toLocaleString()} ctx` : ''}
                    </span>
                  </div>
                  <span className="model-role">{m.labels.join(' · ')}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="rail-label" style={{ marginBottom: 12 }}>Projects ({projects.length})</div>
            <div className="card-list">
              {projects.length === 0 && <p className="rail-empty">No projects yet — create one from the Projects page.</p>}
              {projects.map((p) => (
                <div key={p.id} className="model-row">
                  <span className="model-dot" />
                  <div className="model-name-group">
                    <span className="model-name">{p.name}</span>
                    <span className="model-quant">{p.model}</span>
                  </div>
                  <span className="model-role">
                    {p.chats.length} {p.chats.length === 1 ? 'chat' : 'chats'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="rail-label" style={{ marginBottom: 12 }}>Routing</div>
            <div className="route-table">
              {routes.map((r) => (
                <div key={r.task} className="route-row">
                  <span className="route-task">{r.task}</span>
                  <span className="route-arrow">→</span>
                  <span className="route-model">{r.model}</span>
                </div>
              ))}
            </div>
            <p className="route-note">Each project pins its own model (change it from the model button).
              {diaryEnabled && ' The optional Diary app always routes through its sidecar pipeline, called exactly once per exchange.'}
            </p>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span className="rail-label" style={{ marginBottom: 0 }}>Chat providers</span>
            </div>
            <ProvidersCard />
          </div>
        </div>
      </div>
    </div>
  );
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
  const [value, setValue] = useState<StorageConnection>({ kind: 'local', baseUrl: '', username: '', corpusRoot: '' });
  const [secret, setSecret] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { void fetchStorage().then(setValue); }, []);
  const patch = (next: Partial<StorageConnection>) => setValue(v => ({ ...v, ...next }));
  const connectNextcloud = async () => {
    const flow = await startNextcloud(value.baseUrl); window.open(flow.loginUrl, '_blank', 'noopener,noreferrer'); setMessage('Grant access in Nextcloud, then click Finish connection.'); sessionStorage.setItem('cowork-nextcloud-flow', flow.flowId);
  };
  const finishNextcloud = async () => { const id = sessionStorage.getItem('cowork-nextcloud-flow') || ''; const result = await pollNextcloud(id, value.corpusRoot || 'Cowork/Diary'); if (result.pending) setMessage('Still waiting for Nextcloud approval.'); else { setValue(result); setMessage('Nextcloud connected.'); sessionStorage.removeItem('cowork-nextcloud-flow'); } };
  return <div><div className="rail-label" style={{ marginBottom: 12 }}>Diary storage</div><div className="card-list" style={{ padding: 12, gap: 8 }}>
    <select className="modal-input" value={value.kind} onChange={e => patch({ kind: e.target.value as StorageConnection['kind'] })}><option value="local">Local storage</option><option value="nextcloud">Nextcloud</option><option value="webdav">Generic WebDAV</option></select>
    {value.kind !== 'local' && <><input className="modal-input" placeholder={value.kind === 'nextcloud' ? 'https://cloud.example.com' : 'WebDAV base URL'} value={value.baseUrl} onChange={e => patch({ baseUrl: e.target.value })}/><input className="modal-input" placeholder="Corpus folder" value={value.corpusRoot} onChange={e => patch({ corpusRoot: e.target.value })}/></>}
    {value.kind === 'webdav' && <><input className="modal-input" placeholder="Username" value={value.username} onChange={e => patch({ username: e.target.value })}/><input className="modal-input" type="password" placeholder={value.secretConfigured ? 'App password configured' : 'App password'} value={secret} onChange={e => setSecret(e.target.value)}/></>}
    <div style={{ display: 'flex', gap: 8 }}>{value.kind === 'nextcloud' ? <><button className="modal-btn primary" onClick={() => void connectNextcloud().catch(e => setMessage(String(e)))}>Grant Nextcloud access</button><button className="modal-btn secondary" onClick={() => void finishNextcloud().catch(e => setMessage(String(e)))}>Finish connection</button></> : <><button className="modal-btn primary" onClick={() => void saveStorage({ ...value, secret }).then(v => { setValue(v); setSecret(''); setMessage('Storage saved.'); })}>Save</button><button className="modal-btn secondary" onClick={() => void testStorage(value.secretConfigured && !secret ? { useSaved: true } : { ...value, secret }).then(() => setMessage('Connection successful.')).catch(e => setMessage(String(e)))}>Test</button></>}</div>
    {message && <p className="route-note">{message}</p>}
  </div></div>;
}

function ProfileCard(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [name, setName] = useState('');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => fetchProfile().then(p => { setUser(p.user); setName(p.user.displayName); setPasskeys(p.passkeys); if (p.user.role === 'admin') fetchUsers().then(r => setUsers(r.users)); });
  useEffect(() => { void refresh(); }, []);
  const addKey = async () => { const c = await passkeyRegistrationOptions(); const response = await startRegistration({ optionsJSON: c.options }); await passkeyRegistrationVerify(c.challengeToken, response, `Passkey ${passkeys.length + 1}`); refresh(); };
  const invite = async () => { const x = await createInvitation(); const link = `${window.location.origin}/?invite=${encodeURIComponent(x.token)}`; await navigator.clipboard.writeText(link); setNotice('Single-use invitation copied. It expires in 24 hours.'); };
  if (!user) return <div><div className="rail-label">Profile</div><p className="route-note">Loading…</p></div>;
  return <div>
    <div className="rail-label" style={{ marginBottom: 12 }}>Profile and security</div>
    <div className="card-list">
      <div className="model-row"><div className="auth-mark" aria-hidden="true">{user.displayName.slice(0,1).toUpperCase()}</div><div className="model-name-group"><span className="model-name">{user.username}</span><span className="model-quant">{user.role}</span></div></div>
      <div className="model-row"><input className="modal-input" value={name} onChange={e => setName(e.target.value)} /><button className="popup-tab" onClick={() => void updateProfile(name).then(refresh)}>Save name</button></div>
      {passkeys.map(k => <div className="model-row" key={k.id}><span className="model-dot"/><div className="model-name-group"><span className="model-name">{k.name}</span><span className="model-quant">{k.backedUp ? 'synced passkey' : k.deviceType}</span></div><button className="recents-del" onClick={() => void removePasskey(k.id).then(refresh)}>✕</button></div>)}
      <button className="modal-btn secondary" onClick={() => void addKey().catch(() => setNotice('Passkey setup was cancelled.'))}>+ Add passkey</button>
      <button className="modal-btn secondary" onClick={() => void logout().then(() => window.location.reload())}>Sign out</button>
    </div>
    {user.role === 'admin' && <div style={{ marginTop: 24 }}><div className="rail-label" style={{ marginBottom: 12 }}>Users</div><div className="card-list">
      {users.map(u => <div className="model-row" key={u.id}><div className="model-name-group"><span className="model-name">{u.displayName}</span><span className="model-quant">@{u.username} · {u.role}{u.disabled ? ' · disabled' : ''}</span></div>{u.id !== user.id && <><button className="popup-tab" onClick={() => void setUserDisabled(u.id, !u.disabled).then(refresh)}>{u.disabled ? 'Enable' : 'Disable'}</button><button className="popup-tab" onClick={() => void createRecovery(u.id).then(async r => { await navigator.clipboard.writeText(`${window.location.origin}/?recovery=${r.token}`); setNotice('Recovery link copied.'); })}>Recovery</button><button className="recents-del" title="Delete user" onClick={() => { const typed = window.prompt(`Type ${u.username} to permanently delete this Cowork account. Remote corpus files will be preserved.`); if (typed === u.username) void deleteUser(u.id, typed).then(refresh); }}>✕</button></>}</div>)}
      <button className="modal-btn secondary" onClick={() => void invite()}>+ Copy invitation link</button>
    </div></div>}
    {notice && <p className="route-note">{notice}</p>}
  </div>;
}

/** Connect-a-provider flow (step 9): list connected OpenAI-compatible
 *  endpoints, add one (label / base URL / API key), and remove non-default ones.
 *  Keys live server-side only — the list shows masked hints, never plaintext. */
function ProvidersCard(): JSX.Element {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [shared, setShared] = useState(false);
  const presets: Record<string, { label: string; url: string }> = {
    custom: { label: '', url: '' }, openai: { label: 'OpenAI', url: 'https://api.openai.com/v1' },
    openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' }, ollama: { label: 'Ollama', url: 'http://host.docker.internal:11434/v1' },
    lmstudio: { label: 'LM Studio', url: 'http://host.docker.internal:1234/v1' }, lemonade: { label: 'Lemonade', url: 'http://host.docker.internal:13305/v1' },
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    fetchProviders().then((r) => setProviders(r.providers || [])).catch(() => setErr('Could not load providers'));
  };
  useEffect(refresh, []);

  const submit = async () => {
    if (!label.trim() || !baseUrl.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await testProvider({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined });
      await createProvider({ label: label.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined, defaultModel: defaultModel.trim() || undefined, shared });
      setLabel('');
      setBaseUrl('');
      setApiKey('');
      setDefaultModel('');
      setShared(false);
      setAdding(false);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'connect failed');
    } finally {
      setBusy(false);
    }
  };

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <select className="modal-input" defaultValue="custom" onChange={e => { const p = presets[e.target.value]; setLabel(p.label); setBaseUrl(p.url); }}><option value="custom">Custom OpenAI-compatible</option><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="lemonade">Lemonade</option></select>
          <input
            className="modal-input"
            placeholder="Name (e.g. OpenRouter)"
            value={label}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            className="modal-input"
            placeholder="Base URL (e.g. https://openrouter.ai/api/v1)"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <input
            className="modal-input"
            type="password"
            placeholder="API key (stored server-side only)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <input className="modal-input" placeholder="Default model (optional)" value={defaultModel} onChange={e => setDefaultModel(e.target.value)} />
          <label className="route-note"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} /> Share as an administrator-managed default</label>
          {err && <p className="modal-err">{err}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="modal-btn secondary" onClick={() => setAdding(false)}>Cancel</button>
            <button className="modal-btn primary" disabled={!label.trim() || !baseUrl.trim() || busy} onClick={() => void submit()}>
              {busy ? 'Connecting…' : 'Connect provider'}
            </button>
          </div>
        </div>
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
