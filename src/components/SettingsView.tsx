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
import { afterLayoutSettles, pickFocusable } from '../focus-utils';
import { StoragePicker } from './StoragePicker';
import { useT } from '../i18n';
import type { Translate } from '../i18n';

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
  const t = useT();
  return <div className="settings-live-content">
    {section === 'security' && <SecurityCard />}
    {section === 'users' && <UsersCard />}
    {section === 'diary' && <><div className="settings-title"><h1>{t('settings.section.diary')}</h1><p>{t('diarySettings.lede')}</p></div><DiaryAddonCard enabled={diaryEnabled} onChange={onDiaryEnabledChange}/>{diaryEnabled && <StorageCard />}</>}
    {section === 'providers' && <ProvidersCard health={health} />}
    {section === 'models' && <ModelsSummary models={models} modelsError={modelsError} health={health} stats={stats} onOpen={onOpenModelManager}/>}
    {/* #414: the "Connected" list moves onto .set-rows, the same grouped surface Appearance/Data
        already use, instead of the bare .card-list (see noevia.css's .set-rows .model-row rules). */}
    {section === 'status' && <><div className="settings-title"><h1>{t('settings.section.status')}</h1></div><McpStatus /><h2>{t('serviceStatus.connected')}</h2><div className="set-rows">{([['inference', t('serviceStatus.inference'), health.inferenceUp], ['diary', t('serviceStatus.diary'), diaryEnabled ? health.diaryUp : null]] as const).map(([id, label, up])=><div className="model-row" key={id}><span className={`model-dot${up?'':' down'}`}/><span className="model-name">{label}</span><span className="model-role">{up===true?t('models.available'):up===false?t('models.unavailable'):t('serviceStatus.notAvailable')}</span></div>)}
      {/* #340: tri-state — 'degraded' means the index is installed but the embedding endpoint
          could not be reached; ragAvailable() alone (native deps only) cannot tell the two apart.
          Older/mixed deployments that only send ragAvailable fall back to the boolean. */}
      {(() => {
        const retrieval = health.retrieval ?? (health.ragAvailable == null ? null : health.ragAvailable ? 'available' : 'unavailable');
        const dotClass = retrieval === 'available' ? '' : retrieval === 'degraded' ? ' warn' : ' down';
        const roleText = retrieval === 'available' ? t('models.available') : retrieval === 'degraded' ? t('serviceStatus.retrieval.degraded') : retrieval === 'unavailable' ? t('models.unavailable') : t('serviceStatus.notAvailable');
        return <>
          <div className="model-row" key="retrieval"><span className={`model-dot${dotClass}`}/><span className="model-name">{t('serviceStatus.retrieval')}</span><span className="model-role">{roleText}</span></div>
          {retrieval === 'degraded' && <p className="route-note">{t('serviceStatus.retrieval.degradedNote')}</p>}
        </>;
      })()}
      </div><h2>{t('serviceStatus.liveEngine')}</h2><div className="settings-stat-row"><div><span title={t('serviceStatus.rateTitle')}>{t('serviceStatus.rate')}</span><strong>{stats?.tokensPerSecond?.toFixed(1) ?? '—'}</strong></div><div><span>{t('serviceStatus.requests')}</span><strong>{stats?.requestCount ?? '—'}</strong></div><div><span>VRAM</span><strong>{stats?.vramGb != null ? `${stats.vramGb.toFixed(1)} GB`:'—'}</strong></div></div></>}
  </div>;
}

function DiaryAddonCard({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = useT();
  const toggle = async () => {
    const next = !enabled;
    setBusy(true);
    setError('');
    try {
      const result = await updateFeatures(next);
      onChange(result.diaryEnabled);
    } catch {
      setError(t('diarySettings.toggleError'));
    } finally {
      setBusy(false);
    }
  };
  return <div><div className="rail-label" style={{ marginBottom: 12 }}>{t('diarySettings.optionalApps')}</div><div className="set-rows">
    <div className="model-row"><span className={`model-dot${enabled ? '' : ' down'}`} /><div className="model-name-group"><span className="model-name">{t('serviceStatus.diary')}</span><span className="model-quant">{t('diarySettings.diaryDesc')}</span></div><button className="popup-tab" disabled={busy} onClick={() => void toggle()}>{busy ? t('diarySettings.saving') : enabled ? t('diarySettings.disable') : t('diarySettings.enable')}</button></div>
  </div>{error && <p className="modal-err" role="alert">{error}</p>}<p className="route-note">{t('diarySettings.savedNote')}</p></div>;
}

function StorageCard(): JSX.Element {
  const t = useT();
  return <div>
    <div className="rail-label" style={{ marginBottom: 12 }}>{t('diarySettings.storage')}</div>
    <StoragePicker />
    <DiarySharing />
    <DiaryConnectors />
  </div>;
}

/** Short device label from a session's User-Agent (browser-focused). */
function sessionLabel(t: Translate, ua?: string | null): string {
  if (!ua) return t('security.unknownDevice');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : t('security.browser');
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` · ${os}` : ''}`;
}

// Account security only; identity (name, username, role) is the Profile page.
function SecurityCard(): JSX.Element {
  const t = useT();
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
    catch { setError(t('security.loadError')); }
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
      catch { setError(t('security.refreshError')); }
    } catch (e) {
      // A browser refusal (cancelled, wrong address, unsupported) is not a connection problem.
      const name = (e as Error)?.name;
      if (name === 'NotAllowedError' || name === 'AbortError') setError(t('security.cancelled', { action: label }));
      else if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotSupportedError') setError(t('security.refused', { action: label, message: (e as Error).message }));
      else setError(t('security.unconfirmed', { action: label }));
    }
    finally { setBusy(''); }
  };
  const addKey = async () => {
    const c = await passkeyRegistrationOptions();
    const response = await startRegistration({ optionsJSON: c.options });
    await passkeyRegistrationVerify(c.challengeToken, response, t('security.passkeyName', { number: passkeys.length + 1 }));
  };
  if (!user) return <div><h2>{t('security.heading')}</h2>{loading ? <p role="status">{t('security.loadingProfile')}</p> : <><p className="modal-err" role="alert">{error}</p><button className="modal-btn secondary" onClick={() => void load()}>{t('security.retryProfile')}</button></>}</div>;
  return <div>
    <div className="settings-title"><h1>{t('settings.section.security')}</h1><p>{t('security.intro', { username: user.username })}</p></div>
    <fieldset className="settings-action-group" disabled={!!busy || loading}><div className="card-list">
      {/* #404: a passkey has no online/offline state to show — it is a registered credential, not
          a live connection — so, per PRODUCT.md's "nothing fake", it gets no status dot at all
          (the same no-dot pattern Users' account rows already use) rather than a decorative one. */}
      {passkeys.map(k => <div className="model-row" key={k.id}><div className="model-name-group"><span className="model-name">{k.name}</span><span className="model-quant">{k.backedUp ? t('security.syncedPasskey') : k.deviceType}</span></div><button className="recents-del" aria-label={t('security.removePasskeyNamed', { name: k.name })} onClick={() => void act(t('security.removePasskey'), () => removePasskey(k.id), t('security.passkeyRemoved'))}><ShellIcon name="close" size={16}/></button></div>)}
      <button className="modal-btn secondary" onClick={() => void act(t('security.passkeySetup'), addKey, t('security.passkeyAdded'))}><ShellIcon name="plus" size={16}/>{t('security.addPasskey')}</button>
      {/* #404: the dot was hard-coded green for every row regardless of which session the browser
          is actually using. `s.current` (GET /api/profile marks the calling request's own
          session) is real state — this device vs. every other one — so it drives the same
          model-dot classes the rest of the app uses for good/off, and the text spells out what
          the colour means instead of leaving it to guesswork. */}
      {sessions.length > 0 && sessions.map(s => (
        <div className="model-row" key={s.id}>
          <span className={`model-dot${s.current ? '' : ' down'}`} />
          <div className="model-name-group">
            <span className="model-name">{sessionLabel(t, s.userAgent)}</span>
            <span className="model-quant">
              {s.ip || t('security.unknownIp')} · {t('security.lastSeen', { date: new Date(s.lastSeenAt).toLocaleString(appLocale()) })}{s.current ? ` · ${t('security.thisDevice')}` : ''}
            </span>
          </div>
          <button className="recents-del" title={t('security.revokeSession')} aria-label={t('security.revokeSessionNamed', { device: sessionLabel(t, s.userAgent) })} onClick={() => void act(t('security.revokeSession'), () => revokeSession(s.id), t('security.sessionRevoked'))}><ShellIcon name="close" size={16}/></button>
        </div>
      ))}
      <button className="modal-btn secondary" onClick={() => void act(t('security.signOut'), async () => { await logout(); window.location.reload(); }, t('security.signedOut'))}>{t('security.signOut')}</button>
    </div>
    </fieldset>
    {busy && <p role="status">{busy}…</p>}
    {notice && <p className="route-note" role="status">{notice}</p>}
    {error && <><p className="modal-err" role="alert">{error}</p><button className="modal-btn secondary" disabled={!!busy || loading} onClick={() => void load()}>{loading ? t('settings.loading') : t('security.reloadProfile')}</button></>}
    <AppPasswords />
  </div>;
}

/** Administration → Users. Split out of ProfileCard so personal security and
 *  managing other people's accounts are no longer the same page: one is
 *  something every member does, the other is an operator task. The server is
 *  the real gate — /api/users returns 403 to non-admins regardless of what the
 *  navigation shows — so this only decides what is worth rendering. */
function UsersCard(): JSX.Element {
  const t = useT();
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
      setError(t('users.loadError'));
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
        catch { setError(t('users.refreshError')); }
      }
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : t('users.unconfirmed', { action: label });
      setFeedback(prev => ({ ...prev, [key]: { error: message } }));
    } finally {
      pending.current.delete(key);
      setBusy(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
  };
  const copyLink = async (key: string, link: string, label: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setFeedback(prev => ({ ...prev, [key]: { notice: t('users.copied', { link: label }), link } }));
    } catch {
      setFeedback(prev => ({ ...prev, [key]: { error: t('users.copyFailed', { link: label }), link } }));
    }
  };
  const createLink = (key: string, recoveryId?: string) => act(key, recoveryId ? t('users.createRecovery') : t('users.createInvitation'), async () => {
    const result = recoveryId ? await createRecovery(recoveryId) : await createInvitation();
    const link = `${window.location.origin}/?${recoveryId ? 'recovery' : 'invite'}=${encodeURIComponent(result.token)}`;
    await copyLink(key, link, recoveryId ? t('users.recoveryLink') : t('users.singleUseInvitation'));
  }, '', false);
  const actionFeedback = (key: string) => {
    const value = feedback[key];
    return <>
      {busy[key] && <p className="route-note" role="status">{busy[key]}…</p>}
      {value?.error && <p className="modal-err" role="alert">{value.error}</p>}
      {value?.notice && <p className="route-note" role="status">{value.notice}</p>}
      {value?.link && <div>
        <label className="field">{t('users.createdLink')}<input className="modal-input" readOnly value={value.link} onFocus={e => e.currentTarget.select()} /></label>
        <button className="popup-tab" disabled={!!busy[key]} onClick={() => void copyLink(key, value.link!, key === 'invitation' ? t('users.invitationLink') : t('users.recoveryLink'))}>{t('users.copyAgain')}</button>
      </div>}
    </>;
  };
  const title = <div className="settings-title"><h1>{t('settings.section.users')}</h1></div>;
  if (!user) return <div>{title}{loading ? <p role="status">{t('users.loading')}</p> : <><p className="route-note" role="alert">{error}</p><button className="btn btn-secondary" onClick={() => void load()}>{t('users.retry')}</button></>}</div>;
  if (denied) return <div>{title}<p className="route-note">{t('users.adminRequired')}</p></div>;
  return <div className="settings-users">
    {title}
    {notice && <p className="route-note" role="status">{notice}</p>}
    {/* #414: the account list moves onto .set-rows (the same grouped surface Appearance/Data use)
        instead of a borderless .card-list; "Copy invitation link" sits below it, as every other
        .set-rows' own "add" action already does (MemorySettings.tsx's .memory-add). */}
    <div className="set-rows">
      {users.length === 0 && !loading && <p className="route-note">{t('users.empty')}</p>}
      {users.map(u => <div key={u.id}>
        <div className="model-row"><div className="model-name-group"><span className="model-name">{u.displayName}</span><span className="model-quant">@{u.username} · {u.role}{u.disabled ? ` · ${t('users.disabled')}` : ''}</span></div>{u.id !== user.id && <>
          <button className="popup-tab" disabled={!!busy[u.id] || loading} onClick={() => void act(u.id, u.disabled ? t('users.enableAccount') : t('users.disableAccount'), () => setUserDisabled(u.id, !u.disabled), t('users.accountUpdated'))}>{u.disabled ? t('users.enable') : t('users.disable')}</button>
          <button className="popup-tab" disabled={!!busy[u.id] || loading} onClick={() => void createLink(u.id, u.id)}>{t('users.recovery')}</button>
          <button className="recents-del" title={t('users.deleteUser')} aria-label={t('users.deleteUserNamed', { username: u.username })} disabled={!!busy[u.id] || loading} onClick={() => { const typed = window.prompt(t('users.deletePrompt', { username: u.username })); if (typed === u.username) void act(u.id, t('users.deleteAccount'), () => deleteUser(u.id, typed), t('users.accountDeleted'), true, true); }}><ShellIcon name="close" size={16}/></button>
        </>}</div>{actionFeedback(u.id)}
      </div>)}
    </div>
    <div className="users-add">
      <button className="modal-btn secondary" disabled={!!busy.invitation || loading} onClick={() => void createLink('invitation')}><ShellIcon name="plus" size={16}/>{t('users.copyInvitation')}</button>
      {actionFeedback('invitation')}
    </div>
    {error && <p className="modal-err" role="alert">{error}</p>}
    <button className="popup-tab" disabled={loading || Object.keys(busy).length > 0} onClick={() => void load()}>{loading ? t('settings.loading') : t('users.reload')}</button>
  </div>;
}

/** Connect-a-provider flow (step 9): list connected OpenAI-compatible
 *  endpoints, add one via the shared ProviderForm, and remove non-default ones.
 *  Keys live server-side only — the list shows masked hints, never plaintext. */
function ProvidersCard({ health }: { health: HealthState }): JSX.Element {
  const t = useT();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  // #446: neither Cancel nor a successful add moved focus anywhere, so when the form (or the
  // Cancel button inside it) unmounted, focus fell through to <body>. `connectButtonRef` is the
  // "Connect a provider" button Cancel should return to; `rowRefs` lets a successful add land on
  // the new (always non-default, so it always has a remove button) row instead, once `refresh()`
  // has actually re-rendered it — `afterLayoutSettles` waits for that render to commit rather
  // than querying the DOM the instant the promise resolves.
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const refresh = async () => {
    setLoading(true); setErr(null);
    try { const r = await fetchProviders(); setProviders(r.providers); }
    catch { setErr(t('providers.loadError')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const remove = async (id: string) => {
    setRemoving(id); setErr(null);
    try {
      await deleteProvider(id);
      await refresh();
    } catch {
      setErr(t('providers.removeError'));
    } finally { setRemoving(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="settings-title"><h1>{t('settings.section.providers')}</h1><p>{t('providers.intro')}</p></div>
      {loading && <p role="status">{t('providers.loading')}</p>}
      {!loading && !err && providers.length === 0 && <p className="route-note">{t('providers.empty')}</p>}
      {err && <><p className="modal-err" role="alert">{err}</p><button className="modal-btn secondary" disabled={loading || !!removing} onClick={() => void refresh()}>{t('providers.retry')}</button></>}
      <div className="card-list">
        {providers.map((p) => (
          <div key={p.id} className="model-row">
            {/* #404: the dot was hard-coded green for every provider, connected or not. The
                default provider is the one `/api/health` actually probes (the same signal
                Service status and the model picker already show as `model-dot`/`down`), so it
                gets a real state; an added provider has no passive reachability signal (only an
                on-demand "Test connection" during setup), so — per PRODUCT.md's "nothing fake" —
                it gets no dot rather than a fabricated one. */}
            {p.isDefault && <span className={`model-dot${health.inferenceUp ? '' : ' down'}`} />}
            <div className="model-name-group">
              <span className="model-name">{p.label}</span>
              <span className="model-quant">{p.baseUrl}</span>
            </div>
            {p.isDefault ? (
              <span className="model-role">{t('providers.defaultAlwaysOn')} · {health.inferenceUp === true ? t('models.available') : health.inferenceUp === false ? t('models.unavailable') : t('serviceStatus.notAvailable')}</span>
            ) : (
              <>
                {p.apiKeyMasked && <span className="model-quant">{t('providers.keyHint', { key: p.apiKeyMasked })}</span>}
                <button ref={(el) => { if (el) rowRefs.current.set(p.id, el); else rowRefs.current.delete(p.id); }} className="recents-del" title={t('providers.remove')} aria-label={t('providers.removeNamed', { name: p.label })} disabled={loading || !!removing} onClick={() => void remove(p.id)}>
                  {removing === p.id ? t('providers.removing') : <ShellIcon name="close" size={16}/>}
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
          cancelLabel={t('common.cancel')}
          onCancel={() => {
            setAdding(false);
            // The unmounting Cancel button is not a usable focus target (#446) — the button that
            // opened the form is, and it is guaranteed to exist once `adding` is false again.
            afterLayoutSettles(() => connectButtonRef.current?.focus({ preventScroll: true }));
          }}
          onConnected={(created) => {
            setAdding(false);
            void refresh().then(() => {
              afterLayoutSettles(() => {
                pickFocusable<HTMLElement>(rowRefs.current.get(created.id) ?? null, connectButtonRef.current)?.focus({ preventScroll: true });
              });
            });
          }}
        />
      ) : (
        <>
          <button ref={connectButtonRef} className="modal-btn secondary" style={{ width: 'fit-content' }} onClick={() => setAdding(true)}>
            <ShellIcon name="plus" size={16}/>{t('providers.connect')}
          </button>
          <p className="route-note">
            {t('providers.note')}
          </p>
        </>
      )}
    </div>
  );
}
