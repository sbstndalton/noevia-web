import { appLocale } from '../../user-preferences';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { useT } from '../../i18n';
import type { MessageKey, Translate } from '../../i18n';
import { around } from '../../text-around';

/** What the server says about Google Drive. Tokens never leave the server. */
export interface GoogleState {
  configured: boolean;
  state: 'not-configured' | 'disconnected' | 'pending' | 'connected' | 'error';
  message?: string;
  userCode?: string; verificationUrl?: string; expiresAt?: number;
  email?: string | null;
  copy?: { state: 'ok' | 'waiting' | 'refused' | 'failed' | 'stale' | 'unknown'; at: number | null; message: string; messageId?: string; messageParams?: Record<string, string | number> } | null;
}

const when = (t: Translate, ms?: number | null) => (ms ? new Date(ms).toLocaleString(appLocale()) : t('gdrive.never'));

/** A Drive message by the server's stable id (#624): the catalogue's wording with the server's numbers, or the server's English for an id this build lacks. */
export function driveMessage(t: Translate, id: string | undefined, params: Record<string, string | number> | undefined, english: string): string {
  if (!id) return english;
  const key = `gdrive.msg.${id}` as MessageKey;
  const text = t(key, params);
  return text === key ? english : text;
}

async function post<T = unknown>(url: string): Promise<T> {
  const r = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `Request failed (${r.status})`), { id: typeof body.errorId === 'string' ? body.errorId : undefined, params: body.errorParams });
  return body as T;
}

/**
 * Opens Google's sign-in page in a new tab as part of the click. The tab has to be opened
 * synchronously, before the server answers, or browsers block it as a pop-up; it is pointed at
 * Google once the server returns the address. If it was blocked anyway, the Open Google button
 * on the page still works.
 */
async function connectAndOpen(): Promise<void> {
  const tab = window.open('about:blank', '_blank');
  try {
    const started = await post<GoogleState>('/api/admin/offsite-backup/google/connect');
    if (tab && started.verificationUrl) { tab.opener = null; tab.location.href = started.verificationUrl; }
    else tab?.close();
  } catch (e) { tab?.close(); throw e; }
}

/** The copy's result in plain words, and whether it needs attention. */
export function copyText(g: GoogleState, t: Translate): { value: string; tone?: 'error' } {
  const c = g.copy;
  if (!c || c.state === 'unknown') return { value: t('gdrive.copy.first') };
  if (c.state === 'ok') return { value: t('gdrive.copy.ok', { when: when(t, c.at) }) };
  if (c.state === 'waiting') return { value: t('gdrive.copy.waiting') };
  // A refused or failed copy: the server's message by its id in the interface language (#624), or its English when the id is new, with the time in the locale.
  return { value: `${driveMessage(t, c.messageId, c.messageParams, c.message)}${c.at ? ` (${when(t, c.at)})` : ''}`, tone: 'error' };
}

/**
 * Connect Google Drive with one button. The server starts Google's device sign-in and waits for
 * approval in the background; this only shows the code and refreshes until Google says yes.
 * Shared by the setup wizard and Settings → Backups.
 */
export function GoogleDriveConnect({ google, onChange }: { google: GoogleState; onChange: () => Promise<unknown> | void }): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const act = async (label: string, url: string) => {
    setBusy(label); setError('');
    try { if (label === 'connect') await connectAndOpen(); else await post(url); } catch (e) { setError(driveMessage(t, (e as { id?: string }).id, (e as { params?: Record<string, string | number> }).params, (e as Error).message)); } finally { setBusy(''); await onChange(); }
  };
  // While Google waits for approval, check every few seconds so the page turns green by itself.
  useEffect(() => {
    if (google.state !== 'pending') return;
    const t = window.setInterval(() => { void onChange(); }, 3000);
    return () => window.clearInterval(t);
  }, [google.state, onChange]);

  if (google.state === 'not-configured') return <p className="gdrive-note">{t('gdrive.unavailable')}</p>;

  if (google.state === 'pending') return <div className="gdrive-pending" aria-live="polite">
    {error && <p className="route-note" role="alert">{error}</p>}
    <p>{around(t('gdrive.pendingIntro'), 'link')[0]}<a href={google.verificationUrl} target="_blank" rel="noreferrer">{google.verificationUrl?.replace(/^https?:\/\//, '')}</a>{around(t('gdrive.pendingIntro'), 'link')[1]}</p>
    <div className="gdrive-code">
      <output aria-label={t('gdrive.codeLabel')}>{google.userCode}</output>
      <button type="button" className="btn btn-secondary" onClick={() => { void navigator.clipboard?.writeText(google.userCode || '').then(() => setCopied(true), () => undefined); }}>{copied ? t('gdrive.copied') : t('gdrive.copyCode')}</button>
    </div>
    <p className="gdrive-note">{t('gdrive.waitingAllow')}</p>
    <div className="gdrive-actions">
      <a className="btn btn-primary" href={google.verificationUrl} target="_blank" rel="noreferrer">{t('gdrive.openGoogle')}</a>
      <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void act('cancel', '/api/admin/offsite-backup/google/disconnect')}>{t('common.cancel')}</button>
    </div>
  </div>;

  if (google.state === 'connected') return <div className="gdrive-connected">
    {error && <p className="route-note" role="alert">{error}</p>}
    <div className="gdrive-actions">
      <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void act('copy', '/api/admin/offsite-backup/copy')}>{busy === 'copy' ? t('gdrive.copying') : t('gdrive.copyNow')}</button>
      <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void act('disconnect', '/api/admin/offsite-backup/google/disconnect')}>{t('gdrive.disconnect')}</button>
    </div>
  </div>;

  return <div className="gdrive-start">
    {(google.message || error) && <p className="route-note" role="alert">{error || google.message}</p>}
    <p className="gdrive-note">{t('gdrive.scope')}</p>
    <div className="gdrive-actions">
      <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void act('connect', '/api/admin/offsite-backup/google/connect')}>{busy === 'connect' ? t('gdrive.starting') : t('gdrive.connect')}</button>
    </div>
  </div>;
}

/** The backup key as a file, for a password manager. */
export function RecoveryKeyLink(): JSX.Element {
  const t = useT();
  return <a className="btn btn-secondary" href="/api/admin/offsite-backup/recovery-key" download>{t('gdrive.downloadKey')}</a>;
}
