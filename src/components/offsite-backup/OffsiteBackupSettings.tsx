import { appLocale } from '../../user-preferences';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { copyText, GoogleDriveConnect, RecoveryKeyLink } from './GoogleDriveSetup';
import type { GoogleState } from './GoogleDriveSetup';
import { formatNumber } from '../../number-format';
import { useT } from '../../i18n';
import type { MessageKey, Translate } from '../../i18n';

interface Status {
  enabled: boolean; ready: boolean; reason: string | null; busy: string | null; schedule: string; retention: string; destination: string | null; paths: number;
  /** #618: the same facts as structured fields, which the page translates; the English strings above stay as the fallback. */
  reasonCode?: 'off' | 'notConfigured' | null; reasonGaps?: string[]; scheduleHour?: number;
  retentionPolicy?: { daily: number; weekly: number; monthly: number };
  destinationFolder?: { path: string; mirror: string | null } | null;
  lastBackup: { at: number; id: string; files: number; uploadedBytes: number } | null;
  lastVerify: { at?: number; verifiedAt: number; id: string; files: number } | null;
  lastError: { at: number; during: string; message: string } | null; snapshots: number | null;
  /** Google Drive, which noevia's backend copies the folder store to. Null for S3 targets. */
  google: GoogleState | null;
}

const when = (t: Translate, ms?: number | null) => (ms ? new Date(ms).toLocaleString(appLocale()) : t('backups.never'));
const size = (n: number) => (n < 1024 * 1024 ? `${formatNumber(Math.max(1, Math.round(n / 1024)), appLocale(), 0)} KB` : `${formatNumber(n / 1024 / 1024, appLocale(), 1)} MB`);
/** The task names the server records in `lastError.during`. */
const DURING: Record<string, MessageKey> = { backup: 'backups.during.backup', 'restore test': 'backups.during.restoreTest', 'copy to Google Drive': 'backups.during.driveCopy' };

/** The status line about why backups cannot run, in the interface language when the server sent its code. */
const reasonText = (t: Translate, s: Status): string | null => {
  if (!s.reason) return null;
  if (s.reasonCode === 'off') return t('backups.reason.off');
  if (s.reasonCode === 'notConfigured' && s.reasonGaps?.length) return t('backups.reason.notConfigured', { gaps: s.reasonGaps.join(', ') });
  return s.reason;
};

async function call<T>(url: string, failed: (status: number) => string, method = 'GET'): Promise<T> {
  const r = await apiFetch(url, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || failed(r.status));
  return body as T;
}

export function OffsiteBackupSettings(): JSX.Element {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t; // callbacks read the current translator without changing identity (no extra status request when a catalogue arrives)
  const failed = (status: number) => tRef.current('backups.requestFailed', { status });
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoadError('');
    try {
      const next = await call<Status>('/api/admin/offsite-backup', failed);
      if (current === request.current) setStatus(next);
    } catch (e) {
      if (current === request.current) setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);
  const act = async (label: string, url: string) => {
    ++request.current; // Earlier status reads cannot overwrite an action in progress.
    setBusy(label); setError(''); setLoadError('');
    try { await call(url, failed, 'POST'); } catch (e) { setError((e as Error).message); } finally { setBusy(''); void load(); }
  };
  const reason = status ? reasonText(t, status) : null;
  return <>
    <div className="settings-title"><h1>{t('settings.section.backups')}</h1><p>{t('backups.intro')}</p></div>
    {error && <p className="route-note" role="alert">{error}</p>}
    {loadError && <p className="route-note" role="alert">{loadError} <button type="button" className="btn btn-secondary" onClick={() => void load()}>{t('backups.reload')}</button></p>}
    {!status ? <p className="preview-footnote">{t('admin.loading')}</p> : <>
      {reason && <p className="route-note" role="status">{reason}</p>}
      <div className="set-rows">
        <Row label={t('backups.destination')} value={status.destinationFolder
          ? (status.destinationFolder.mirror ? t('backups.destFolderMirror', { path: status.destinationFolder.path, mirror: status.destinationFolder.mirror }) : t('backups.destFolder', { path: status.destinationFolder.path }))
          : status.destination || t('backups.notConfigured')}/>
        {status.google?.state === 'connected' && <Row label={t('backups.googleDrive')} {...copyText(status.google, t)}/>}
        {status.google?.state === 'connected' && status.google.email && <Row label={t('backups.googleAccount')} value={status.google.email}/>}
        <Row label={t('backups.schedule')} value={status.scheduleHour === undefined ? status.schedule : t('backups.scheduleDaily', { time: `${String(status.scheduleHour).padStart(2, '0')}:00` })}/>
        <Row label={t('backups.retention')} value={status.retentionPolicy ? t('backups.retentionValue', { ...status.retentionPolicy }) : status.retention}/>
        <Row label={t('backups.snapshots')} value={status.snapshots === null ? t('backups.snapshotsUnknown') : String(status.snapshots)}/>
        <Row label={t('backups.lastBackup')} value={status.lastBackup ? t.plural('backups.lastBackupValue', status.lastBackup.files, { when: when(t, status.lastBackup.at), size: size(status.lastBackup.uploadedBytes) }) : t('backups.never')}/>
        <Row label={t('backups.lastVerify')} value={status.lastVerify ? t.plural('backups.verifiedValue', status.lastVerify.files, { when: when(t, status.lastVerify.verifiedAt) }) : t('backups.never')}/>
        {status.lastError && <Row label={t('backups.lastProblem')} value={t('backups.problemValue', { when: when(t, status.lastError.at), during: DURING[status.lastError.during] ? t(DURING[status.lastError.during]) : status.lastError.during, message: status.lastError.message })} tone="error"/>}
      </div>
      {status.google && status.google.state !== 'connected' && <section className="settings-section gdrive-connect"><h2>{t('backups.copySection')}</h2>
        <p className="gdrive-note">{t('backups.localOnly')}</p>
        <GoogleDriveConnect google={status.google} onChange={load}/></section>}
      {status.google?.state === 'connected' && <GoogleDriveConnect google={status.google} onChange={load}/>}
      <div className="settings-actions">
        {status.ready && <RecoveryKeyLink/>}
        <button type="button" className="btn btn-secondary" disabled={!status.ready || !!busy || !!status.busy} onClick={() => act('verify', '/api/admin/offsite-backup/verify')}>{busy === 'verify' ? t('backups.testingRestore') : t('backups.testRestore')}</button>
        <button type="button" className="btn btn-primary" disabled={!status.ready || !!busy || !!status.busy} onClick={() => act('run', '/api/admin/offsite-backup/run')}>{busy === 'run' ? t('backups.backingUp') : t('backups.backUpNow')}</button>
      </div>
    </>}
  </>;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'error' }): JSX.Element {
  return <div className="set-row set-row-inline"><div className="set-row-text"><span className="set-row-label">{label}</span></div>
    <div className={`set-row-value${tone ? ` is-${tone}` : ''}`}>{value}</div></div>;
}
