import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { copyText, GoogleDriveConnect, RecoveryKeyLink } from './GoogleDriveSetup';
import type { GoogleState } from './GoogleDriveSetup';

interface Status {
  enabled: boolean; ready: boolean; reason: string | null; busy: string | null; schedule: string; retention: string; destination: string | null; paths: number;
  lastBackup: { at: number; id: string; files: number; uploadedBytes: number } | null;
  lastVerify: { at?: number; verifiedAt: number; id: string; files: number } | null;
  lastError: { at: number; during: string; message: string } | null; snapshots: number | null;
  /** Google Drive, which noevia's backend copies the folder store to. Null for S3 targets. */
  google: GoogleState | null;
}

const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : 'Never');
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

async function call<T>(url: string, method = 'GET'): Promise<T> {
  const r = await apiFetch(url, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body as T;
}

export function OffsiteBackupSettings(): JSX.Element {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => call<Status>('/api/admin/offsite-backup').then(setStatus).catch(e => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const act = async (label: string, url: string) => {
    setBusy(label); setError('');
    try { await call(url, 'POST'); } catch (e) { setError((e as Error).message); } finally { setBusy(''); load(); }
  };
  return <>
    <div className="settings-title"><h1>Backups</h1><p>Nightly encrypted copies of everything on this server — accounts, projects, chats, settings and the Diary. Files are encrypted here before they leave, so Google never sees their contents. Keep the key somewhere safe: without it nothing can be restored.</p></div>
    {error && <p className="route-note" role="alert">{error}</p>}
    {!status ? <p className="preview-footnote">Loading…</p> : <>
      {status.reason && <p className="route-note" role="status">{status.reason}</p>}
      <div className="set-rows">
        <Row label="Destination" value={status.destination || 'Not configured'}/>
        {status.google?.state === 'connected' && <Row label="Google Drive" {...copyText(status.google)}/>}
        {status.google?.state === 'connected' && status.google.email && <Row label="Google account" value={status.google.email}/>}
        <Row label="Schedule" value={status.schedule}/>
        <Row label="Retention" value={status.retention}/>
        <Row label="Snapshots kept" value={status.snapshots === null ? 'Unknown until the first run' : String(status.snapshots)}/>
        <Row label="Last backup" value={status.lastBackup ? `${when(status.lastBackup.at)} · ${status.lastBackup.files} files · ${size(status.lastBackup.uploadedBytes)} uploaded` : 'Never'}/>
        <Row label="Last restore test" value={status.lastVerify ? `${when(status.lastVerify.verifiedAt)} · ${status.lastVerify.files} files verified` : 'Never'}/>
        {status.lastError && <Row label="Last problem" value={`${when(status.lastError.at)} during ${status.lastError.during}: ${status.lastError.message}`} tone="error"/>}
      </div>
      {status.google && status.google.state !== 'connected' && <section className="settings-section gdrive-connect"><h2>Copy to Google Drive</h2>
        <p className="gdrive-note">Until Google Drive is connected, backups stay on this server only.</p>
        <GoogleDriveConnect google={status.google} onChange={load}/></section>}
      {status.google?.state === 'connected' && <GoogleDriveConnect google={status.google} onChange={load}/>}
      <div className="settings-actions">
        {status.ready && <RecoveryKeyLink/>}
        <button type="button" className="btn btn-secondary" disabled={!status.ready || !!busy || !!status.busy} onClick={() => act('verify', '/api/admin/offsite-backup/verify')}>{busy === 'verify' ? 'Testing restore…' : 'Test restore'}</button>
        <button type="button" className="btn btn-primary" disabled={!status.ready || !!busy || !!status.busy} onClick={() => act('run', '/api/admin/offsite-backup/run')}>{busy === 'run' ? 'Backing up…' : 'Back up now'}</button>
      </div>
    </>}
  </>;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'error' }): JSX.Element {
  return <div className="set-row set-row-inline"><div className="set-row-text"><span className="set-row-label">{label}</span></div>
    <div className={`set-row-value${tone ? ` is-${tone}` : ''}`}>{value}</div></div>;
}
