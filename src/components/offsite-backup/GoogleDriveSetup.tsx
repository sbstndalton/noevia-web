import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

/** What the server says about Google Drive. Tokens never leave the server. */
export interface GoogleState {
  configured: boolean;
  state: 'not-configured' | 'disconnected' | 'pending' | 'connected' | 'error';
  message?: string;
  userCode?: string; verificationUrl?: string; expiresAt?: number;
  email?: string | null;
  copy?: { state: 'ok' | 'waiting' | 'refused' | 'failed' | 'stale' | 'unknown'; at: number | null; message: string } | null;
}

const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : 'never');

async function post<T = unknown>(url: string): Promise<T> {
  const r = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
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
export function copyText(g: GoogleState): { value: string; tone?: 'error' } {
  const c = g.copy;
  if (!c || c.state === 'unknown') return { value: 'Connected · the first copy is on its way.' };
  if (c.state === 'ok') return { value: `Connected · last copied ${when(c.at)}` };
  if (c.state === 'waiting') return { value: 'Connected · waiting for the first backup.' };
  return { value: `${c.message}${c.at ? ` (${when(c.at)})` : ''}`, tone: 'error' };
}

/**
 * Connect Google Drive with one button. The server starts Google's device sign-in and waits for
 * approval in the background; this only shows the code and refreshes until Google says yes.
 * Shared by the setup wizard and Settings → Backups.
 */
export function GoogleDriveConnect({ google, onChange }: { google: GoogleState; onChange: () => Promise<unknown> | void }): JSX.Element {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const act = async (label: string, url: string) => {
    setBusy(label); setError('');
    try { if (label === 'connect') await connectAndOpen(); else await post(url); } catch (e) { setError((e as Error).message); } finally { setBusy(''); await onChange(); }
  };
  // While Google waits for approval, check every few seconds so the page turns green by itself.
  useEffect(() => {
    if (google.state !== 'pending') return;
    const t = window.setInterval(() => { void onChange(); }, 3000);
    return () => window.clearInterval(t);
  }, [google.state, onChange]);

  if (google.state === 'not-configured') return <p className="gdrive-note">Google Drive isn’t available in this version of noevia.</p>;

  if (google.state === 'pending') return <div className="gdrive-pending" aria-live="polite">
    <p>Google’s sign-in page opened in a new tab. Sign in there and enter this code (or open <a href={google.verificationUrl} target="_blank" rel="noreferrer">{google.verificationUrl?.replace(/^https?:\/\//, '')}</a> on any device):</p>
    <div className="gdrive-code">
      <output aria-label="Google sign-in code">{google.userCode}</output>
      <button type="button" className="btn btn-secondary" onClick={() => { void navigator.clipboard?.writeText(google.userCode || '').then(() => setCopied(true), () => undefined); }}>{copied ? 'Copied' : 'Copy code'}</button>
    </div>
    <p className="gdrive-note">Waiting for you to click Allow… This page updates by itself.</p>
    <div className="gdrive-actions">
      <a className="btn btn-primary" href={google.verificationUrl} target="_blank" rel="noreferrer">Open Google</a>
      <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void act('cancel', '/api/admin/offsite-backup/google/disconnect')}>Cancel</button>
    </div>
  </div>;

  if (google.state === 'connected') return <div className="gdrive-connected">
    {error && <p className="route-note" role="alert">{error}</p>}
    <div className="gdrive-actions">
      <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void act('copy', '/api/admin/offsite-backup/copy')}>{busy === 'copy' ? 'Copying…' : 'Copy to Drive now'}</button>
      <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void act('disconnect', '/api/admin/offsite-backup/google/disconnect')}>Disconnect</button>
    </div>
  </div>;

  return <div className="gdrive-start">
    {(google.message || error) && <p className="route-note" role="alert">{error || google.message}</p>}
    <p className="gdrive-note">noevia only gets access to the files it creates in your Drive. Everything is encrypted before it leaves this server.</p>
    <div className="gdrive-actions">
      <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void act('connect', '/api/admin/offsite-backup/google/connect')}>{busy === 'connect' ? 'Starting…' : 'Connect Google Drive'}</button>
    </div>
  </div>;
}

/** The backup key as a file, for a password manager. */
export function RecoveryKeyLink(): JSX.Element {
  return <a className="btn btn-secondary" href="/api/admin/offsite-backup/recovery-key" download>Download recovery key</a>;
}
