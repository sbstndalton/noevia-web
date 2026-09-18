import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';

interface Status {
  enabled: boolean; ready: boolean; reason: string | null; busy: string | null; schedule: string; retention: string; destination: string | null; paths: number;
  lastBackup: { at: number; id: string; files: number; uploadedBytes: number } | null;
  lastVerify: { at?: number; verifiedAt: number; id: string; files: number } | null;
  lastError: { at: number; during: string; message: string } | null; snapshots: number | null;
  /** The host's copy to Google Drive, as its sync script last reported it. Null for S3 targets. */
  mirror: { state: 'ok' | 'not-connected' | 'waiting' | 'refused' | 'failed' | 'stale' | 'unknown'; at: number | null; message: string } | null;
}

/** Plain words for the mirror, and whether it needs someone's attention. */
function mirrorText(m: NonNullable<Status['mirror']>): { value: string; tone?: 'error' } {
  switch (m.state) {
    case 'ok': return { value: `Connected · last copied ${when(m.at)}` };
    case 'not-connected': return { value: 'Not connected. Finish the one-time Google sign-in in a terminal on the server (deploy/offsite/README.md). Until then, backups stay on this server only.', tone: 'error' };
    case 'waiting': return { value: 'Connected · waiting for the first backup before copying.' };
    case 'unknown': return { value: 'Not checked yet · the copy runs nightly at 02:45.' };
    default: return { value: `${m.message}${m.at ? ` (${when(m.at)})` : ''}`, tone: 'error' };
  }
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
  const load = () => call<Status>('/api/admin/offsite-backup').then(setStatus).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const act = async (label: string, url: string) => {
    setBusy(label); setError('');
    try { await call(url, 'POST'); } catch (e) { setError((e as Error).message); } finally { setBusy(''); load(); }
  };
  return <>
    <div className="settings-title"><h1>Off-site backups</h1><p>Encrypted snapshots of this server's data to storage you choose. Files are encrypted here before upload, so the provider never sees their contents. Keep the key somewhere safe: without it nothing can be restored.</p></div>
    {error && <p className="route-note" role="alert">{error}</p>}
    {!status ? <p className="preview-footnote">Loading…</p> : <>
      {status.reason && <p className="route-note" role="status">{status.reason}</p>}
      <div className="set-rows">
        <Row label="Destination" value={status.destination || 'Not configured'}/>
        {status.mirror && <Row label="Google Drive" {...mirrorText(status.mirror)}/>}
        <Row label="Schedule" value={status.schedule}/>
        <Row label="Retention" value={status.retention}/>
        <Row label="Snapshots kept" value={status.snapshots === null ? 'Unknown until the first run' : String(status.snapshots)}/>
        <Row label="Last backup" value={status.lastBackup ? `${when(status.lastBackup.at)} · ${status.lastBackup.files} files · ${size(status.lastBackup.uploadedBytes)} uploaded` : 'Never'}/>
        <Row label="Last restore test" value={status.lastVerify ? `${when(status.lastVerify.verifiedAt)} · ${status.lastVerify.files} files verified` : 'Never'}/>
        {status.lastError && <Row label="Last problem" value={`${when(status.lastError.at)} during ${status.lastError.during}: ${status.lastError.message}`} tone="error"/>}
      </div>
      <div className="settings-actions">
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
