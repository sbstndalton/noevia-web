import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cancelNextcloud, fetchStorage, pollNextcloud, saveStorage, startNextcloud, testStorage } from '../api';
import type { NextcloudError, StorageConnection, StorageSaveResult } from '../api';
import { useT } from '../i18n';

export interface StoragePickerProps {
  /** Called after storage is saved. Receives the saved connection. */
  onSaved?: (connection: StorageConnection) => void;
  /** Skip path — shown in the wizard, hidden in Settings. */
  onSkip?: () => void;
  onlineOnly?: boolean;
  backupOnly?: boolean;
}

const FLOW_KEY = 'cowork-nextcloud-flow';
const POLL_MS = 2000;

/** #1427: the address a person opens Nextcloud with, from a saved WebDAV URL or a Files-app URL.
 *  Only https is offered for sign-in; anything else gives '' so the field starts empty. */
export function nextcloudSignInAddress(raw: string): string {
  let url: URL;
  try { url = new URL(String(raw || '').trim()); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  const path = url.pathname.replace(/\/(?:remote\.php|index\.php|apps|ocs|login|status\.php)(?:\/.*)?$/i, '').replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** #1427: a WebDAV URL that is really a Nextcloud server, so the sign-in can be offered instead. */
export const looksLikeNextcloud = (raw: string) => /\/remote\.php\/(?:dav|webdav)(?:\/|$)/i.test(String(raw || ''));

interface PendingFlow { flowId: string; loginUrl: string; expiresAt: number }
function storedFlow(): PendingFlow | null {
  try {
    const raw = sessionStorage.getItem(FLOW_KEY);
    if (!raw) return null;
    const flow = JSON.parse(raw) as PendingFlow;
    return flow && typeof flow.flowId === 'string' && typeof flow.loginUrl === 'string' && flow.expiresAt > Date.now() ? flow : null;
  } catch { return null; }
}
function rememberFlow(flow: PendingFlow | null) {
  try { if (flow) sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow)); else sessionStorage.removeItem(FLOW_KEY); } catch { /* private mode: the flow still runs */ }
}

/** Diary storage backend picker (local / Nextcloud / generic WebDAV), shared by
 *  the setup wizard (step 3) and Settings → Diary storage. The same connection serves
 *  project sources, so signing in here fixes both. */
export function StoragePicker({ onSaved, onSkip, onlineOnly = false, backupOnly = false }: StoragePickerProps): JSX.Element {
  const id = useId();
  const t = useT();
  const [value, setValue] = useState<StorageConnection>({ kind: onlineOnly ? 'nextcloud' : 'local', baseUrl: '', username: '', corpusRoot: '' });
  const [loaded, setLoaded] = useState(false);
  const [loadedKind, setLoadedKind] = useState<StorageConnection['kind'] | null>(null);
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // #1427: the Nextcloud sign-in address is its own field. The saved WebDAV URL (often an internal
  // http:// address) is never what the browser signs in at, and is left untouched until sign-in succeeds.
  const [server, setServer] = useState('');
  const [flow, setFlow] = useState<PendingFlow | null>(null);
  const [starting, setStarting] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  // #1433: the poll request currently on its way, so Cancel can wait for it and see what it did.
  const pollInFlight = useRef<Promise<unknown> | null>(null);
  const corpusRef = useRef('');
  corpusRef.current = value.corpusRoot || '';
  // The fields stay locked until the saved connection is known, so an edit can't overwrite
  // settings that simply hadn't loaded yet. Say so, and don't wait forever.
  useEffect(() => {
    let live = true;
    setLoadFailed(false); setMessage('');
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 10000));
    void Promise.race([fetchStorage(), timeout])
      .then(v => {
        if (!live) return;
        const next = (onlineOnly && v.kind === 'local') || (backupOnly && v.kind === 's3')
          ? { kind: 'nextcloud', baseUrl: '', username: '', corpusRoot: 'Cowork/Diary' } as StorageConnection
          : v;
        setValue(next);
        setLoadedKind(next.kind);
        setServer(nextcloudSignInAddress(next.baseUrl));
        setLoaded(true);
        // A sign-in started before a reload carries on.
        const pending = storedFlow();
        if (pending) { setValue(cur => ({ ...cur, kind: 'nextcloud' })); setFlow(pending); }
      })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [attempt]);
  const patch = (next: Partial<StorageConnection>) => setValue((v) => ({ ...v, ...next }));
  const switchKind = (kind: StorageConnection['kind']) => {
    if (kind === 'nextcloud' && !server) setServer(nextcloudSignInAddress(value.baseUrl));
    setProblem(''); setMessage('');
    patch({ kind });
  };

  const minutes = (seconds?: number) => Math.max(1, Math.ceil((seconds || 300) / 60));
  const nextcloudProblem = (e: unknown): string => {
    const err = e as NextcloudError;
    switch (err?.code) {
      case 'nextcloudHttpsRequired': return t('storage.nc.httpsRequired');
      case 'nextcloudUnreachable': return err.reason === 'timeout' ? t('storage.nc.timeout') : err.reason === 'redirect' ? t('storage.nc.redirect') : t('storage.nc.unreachable');
      case 'nextcloudNotFound': return t('storage.nc.notFound');
      case 'nextcloudThrottled': return t('storage.nc.throttled', { minutes: minutes(err.retryAfter) });
      case 'nextcloudFlowExpired': return t('storage.nc.expired');
      case 'storageLoginRejected': return t('storage.nc.rejected');
      default: return String(err?.message || e);
    }
  };
  const savedMessage = (saved: StorageSaveResult, ok: string) => saved.warningCode === 'storageThrottled'
    ? t('storage.savedThrottled', { minutes: minutes(saved.retryAfter) })
    : saved.warningCode === 'storageUnverified'
      ? (saved.reason === 'redirect' ? t('storage.savedRedirected') : saved.reason === 'timeout' ? t('storage.savedTimedOut') : saved.status ? t('storage.savedUnchecked', { status: saved.status }) : t('storage.savedUnverified'))
      : ok;

  // #1427: the sign-in window is opened inside the click, before any await; opened after the
  // server answers, Safari and Brave treat it as an unrequested popup and block it.
  const signIn = async () => {
    setProblem(''); setMessage(''); setPopupBlocked(false);
    const popup = window.open('', '_blank');
    setStarting(true);
    try {
      const started = await startNextcloud(server.trim());
      const pending = { flowId: started.flowId, loginUrl: started.loginUrl, expiresAt: started.expiresAt };
      if (popup && !popup.closed) { popup.opener = null; popup.location.href = started.loginUrl; }
      else setPopupBlocked(true);
      rememberFlow(pending);
      setFlow(pending);
    } catch (e) {
      popup?.close();
      setProblem(nextcloudProblem(e));
    } finally { setStarting(false); }
  };
  // #1433: Cancel ends the flow on the server as well. A poll already in flight may still have
  // saved (Nextcloud handed the password over just before), so once it settles the saved
  // connection is read again and shown as it really is.
  const cancel = () => {
    const current = flow;
    rememberFlow(null); setFlow(null); setPopupBlocked(false); setMessage('');
    if (!current) return;
    const inFlight = pollInFlight.current;
    void cancelNextcloud(current.flowId).catch(() => { /* the flow expires on its own */ }).then(async () => {
      if (!inFlight) return;
      const raced = await inFlight.catch(() => null) as { pending?: boolean } | null;
      if (!raced || raced.pending) return; // nothing was saved
      const latest = await fetchStorage().catch(() => null);
      if (!latest || latest.kind !== 'nextcloud' || !latest.secretConfigured) return;
      setValue(latest); setLoadedKind(latest.kind); setServer(nextcloudSignInAddress(latest.baseUrl));
      setMessage(t('storage.nc.connected', { user: latest.username }));
      onSavedRef.current?.(latest);
    });
  };

  // While a sign-in is open, ask the server every 2 s whether Nextcloud has handed over the app
  // password. One request at a time; it stops on success, a real error or expiry.
  useEffect(() => {
    if (!flow) return;
    let live = true;
    let timer = 0;
    const tick = async () => {
      if (!live) return;
      if (flow.expiresAt <= Date.now()) { rememberFlow(null); setFlow(null); setProblem(t('storage.nc.expired')); return; }
      try {
        const request = pollNextcloud(flow.flowId, corpusRef.current);
        pollInFlight.current = request;
        const result = await request.finally(() => { if (pollInFlight.current === request) pollInFlight.current = null; });
        if (!live) return;
        if (result.pending) { timer = window.setTimeout(() => void tick(), POLL_MS); return; }
        rememberFlow(null); setFlow(null); setPopupBlocked(false);
        const { pending: _pending, warning: _warning, warningCode: _code, status: _status, reason: _reason, retryAfter: _retry, ...saved } = result;
        setValue(saved); setLoadedKind(saved.kind); setServer(nextcloudSignInAddress(saved.baseUrl)); setSecret('');
        setMessage(savedMessage(result, t('storage.nc.connected', { user: saved.username })));
        onSavedRef.current?.(saved);
      } catch (e) {
        if (!live) return;
        rememberFlow(null); setFlow(null); setPopupBlocked(false);
        setProblem(nextcloudProblem(e));
      }
    };
    timer = window.setTimeout(() => void tick(), POLL_MS);
    return () => { live = false; window.clearTimeout(timer); };
  }, [flow]);

  const save = async () => {
    setProblem(''); setMessage('');
    const saved = await saveStorage({ ...value, secret });
    setValue(saved);
    setLoadedKind(saved.kind);
    setSecret('');
    setMessage(savedMessage(saved, t('storage.saved')));
    onSaved?.(saved);
  };
  const test = async () => {
    setProblem(''); setMessage('');
    await testStorage({ ...value, secret, useSavedSecret: value.kind === loadedKind && !!value.secretConfigured && !secret });
    setMessage(t('storage.tested'));
  };
  const plainError = (e: unknown) => String((e as Error)?.message || e);

  const nextcloudConnected = value.kind === 'nextcloud' && loadedKind === 'nextcloud' && !!value.secretConfigured && !value.secretNeedsReauth;
  const waiting = !!flow;

  return (
    <div className="card-list" style={{ padding: 12, gap: 8 }}>
      {!loaded && !loadFailed && <p className="route-note" role="status">{t('storage.loading')}</p>}
      {loadFailed && <div role="alert"><p className="route-note">{t('storage.loadFailed')}</p>
        <button type="button" className="modal-btn secondary" onClick={() => setAttempt(n => n + 1)}>{t('storage.tryAgain')}</button></div>}
      {backupOnly && <p className="diary-context-note">{t('storage.backupNote')}</p>}
      <label className="modal-label" htmlFor={`${id}-kind`}>{t('storage.type')}</label>
      <select
        id={`${id}-kind`}
        className="modal-input"
        disabled={!loaded || waiting}
        value={value.kind}
        onChange={(e) => switchKind(e.target.value as StorageConnection['kind'])}
      >
        {!onlineOnly && <option value="local">{t('storage.kind.local')}</option>}
        <option value="nextcloud">Nextcloud</option>
        <option value="webdav">{t('storage.kind.webdav')}</option>
        {!backupOnly && <option value="s3">{t('storage.kind.s3')}</option>}
      </select>
      {value.kind === 'nextcloud' && (
        <>
          {nextcloudConnected && !waiting && <p className="route-note">{t('storage.nc.connectedAs', { user: value.username })}</p>}
          <label className="modal-label" htmlFor={`${id}-server`}>{t('storage.nc.address')}</label>
          <input
            id={`${id}-server`}
            disabled={!loaded || waiting}
            className="modal-input"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://cloud.example.com"
            aria-describedby={`${id}-server-help`}
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
          <p id={`${id}-server-help`} className="route-note">{t('storage.nc.addressHelp')}</p>
          <label className="modal-label" htmlFor={`${id}-corpusRoot`}>{t('storage.corpusFolder')}</label>
          <input
            id={`${id}-corpusRoot`}
            disabled={!loaded || waiting}
            className="modal-input"
            placeholder="Cowork/Diary"
            value={value.corpusRoot}
            onChange={(e) => patch({ corpusRoot: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!waiting && (
              <button type="button" className="modal-btn primary" disabled={!loaded || starting || !server.trim()} onClick={() => void signIn()}>
                {starting ? t('storage.nc.opening') : nextcloudConnected ? t('storage.nc.signInAgain') : t('storage.nc.signIn')}
              </button>
            )}
            {waiting && <button type="button" className="modal-btn secondary" onClick={cancel}>{t('storage.nc.cancel')}</button>}
            {onSkip && (
              <button type="button" className="modal-btn secondary" onClick={() => { cancel(); onSkip(); }}>
                {t('storage.skip')}
              </button>
            )}
          </div>
          {waiting && (
            <p className="route-note" role="status">
              {popupBlocked ? t('storage.nc.popupBlocked') : t('storage.nc.waiting')}{' '}
              <a href={flow.loginUrl} target="_blank" rel="noopener noreferrer">{t('storage.nc.openPage')}</a>
            </p>
          )}
          {!waiting && (
            <details>
              <summary className="route-note">{t('storage.nc.advanced')}</summary>
              <p className="route-note">{t('storage.nc.advancedHelp')}</p>
              <button type="button" className="modal-btn secondary" disabled={!loaded} onClick={() => switchKind('webdav')}>{t('storage.nc.useWebdav')}</button>
            </details>
          )}
        </>
      )}
      {value.kind !== 'local' && value.kind !== 'nextcloud' && (
        <>
          <label className="modal-label" htmlFor={`${id}-baseUrl`}>{value.kind === 's3' ? t('storage.endpointUrl') : t('storage.webdavUrl')}</label>
          <input
            id={`${id}-baseUrl`}
            disabled={!loaded}
            className="modal-input"
            placeholder={value.kind === 's3' ? t('storage.endpointPlaceholder') : t('storage.webdavUrl')}
            value={value.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
          {value.kind === 'webdav' && looksLikeNextcloud(value.baseUrl) && (
            <div>
              <p className="route-note">{t('storage.nc.detected')}</p>
              <button type="button" className="modal-btn secondary" disabled={!loaded} onClick={() => switchKind('nextcloud')}>{t('storage.nc.switch')}</button>
            </div>
          )}
          {value.kind === 's3' && (
            <>
              <label className="modal-label" htmlFor={`${id}-bucket`}>{t('storage.bucket')}</label>
              <input
                id={`${id}-bucket`}
                disabled={!loaded}
                className="modal-input"
                placeholder={t('storage.bucket')}
                value={value.bucket || ''}
                onChange={(e) => patch({ bucket: e.target.value })}
              />
              <label className="modal-label" htmlFor={`${id}-region`}>{t('storage.region')}</label>
              <input
                id={`${id}-region`}
                disabled={!loaded}
                className="modal-input"
                placeholder="us-east-1"
                value={value.region || ''}
                onChange={(e) => patch({ region: e.target.value.trim().toLowerCase() })}
              />
            </>
          )}
          <label className="modal-label" htmlFor={`${id}-corpusRoot`}>{value.kind === 's3' ? t('storage.bucketFolder') : t('storage.corpusFolder')}</label>
          <input
            id={`${id}-corpusRoot`}
            disabled={!loaded}
            className="modal-input"
            placeholder={value.kind === 's3' ? t('storage.bucketFolder') : t('storage.corpusFolder')}
            value={value.corpusRoot}
            onChange={(e) => patch({ corpusRoot: e.target.value })}
          />
          <label className="modal-label" htmlFor={`${id}-username`}>{value.kind === 's3' ? t('storage.accessKey') : t('storage.username')}</label>
          <input
            id={`${id}-username`}
            disabled={!loaded}
            className="modal-input"
            placeholder={t('storage.username')}
            value={value.username}
            onChange={(e) => patch({ username: e.target.value })}
          />
          <label className="modal-label" htmlFor={`${id}-secret`}>{value.kind === 's3' ? t('storage.secretKey') : t('storage.appPassword')}</label>
          <input
            id={`${id}-secret`}
            disabled={!loaded}
            className="modal-input"
            type="password"
            aria-describedby={value.kind === loadedKind && value.secretConfigured ? `${id}-secret-help` : undefined}
            placeholder={value.kind === 's3' ? t('storage.secretKey') : t('storage.appPassword')}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          {value.kind === loadedKind && value.secretNeedsReauth && <p className="route-note">{t('storage.reauth')}</p>}
          {value.kind === loadedKind && value.secretConfigured && <p id={`${id}-secret-help`} className="route-note">{t('storage.secretSaved')}</p>}
        </>
      )}
      {value.kind !== 'nextcloud' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={!loaded} className="modal-btn primary" onClick={() => void save().catch((e) => setProblem((e as { code?: string })?.code === 'storageLoginRejected' ? t('storage.loginRejected') : plainError(e)))}>
            {t('common.save')}
          </button>
          <button type="button" disabled={!loaded} className="modal-btn secondary" onClick={() => void test().catch((e) => setProblem(plainError(e)))}>
            {t('storage.test')}
          </button>
          {onSkip && (
            <button type="button" className="modal-btn secondary" onClick={() => { cancel(); onSkip(); }}>
              {t('storage.skip')}
            </button>
          )}
        </div>
      )}
      {problem && <p className="route-note" role="alert">{problem}</p>}
      {message && <p className="route-note" role="status">{message}</p>}
    </div>
  );
}
