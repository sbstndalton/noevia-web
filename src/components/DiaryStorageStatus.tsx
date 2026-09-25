import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { shouldPoll } from '../diary-storage-poll';
import { useT } from '../i18n';

type Status = { mode: 'managed' | 'legacy'; backup: 'not_configured' | 'pending' | 'failed' | 'complete'; lastBackedUp: number | null; error?: string };
type Preview = { fingerprint: string; fileCount: number; bytes: number; files: { path: string; bytes: number; sha256: string }[] };
export function DiaryStorageStatus({ busy, revision, onMode, onImported, onBusyChange }: { busy: boolean; revision: number; onMode: (mode: 'managed' | 'legacy') => void; onImported: () => void; onBusyChange: (busy: boolean) => void }) {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let stopped = false, running = false, timer: ReturnType<typeof setInterval> | null = null;
    let current: Status | null = null;
    async function poll() {
      if (running) return;
      running = true;
      try {
        const r = await apiFetch('/api/diary/storage-status');
        if (!r.ok) throw Error(t('diary.storageStatus.unavailableCheck'));
        const value: Status = await r.json();
        if (value.mode !== 'managed' && value.mode !== 'legacy') throw Error(t('diary.storageStatus.unavailable'));
        if (!stopped) { current = value; setStatus(value); onMode(value.mode); if(value.mode === 'managed')setPreview(null); setStatusError(''); }
      } catch (e) { if (!stopped) { current = null; setStatus(null); setStatusError(String(e instanceof Error ? e.message : e)); } }
      finally { running = false; if (!stopped) reschedule(); }
    }
    function reschedule() {
      if (timer) { clearInterval(timer); timer = null; }
      if (shouldPoll(current, document.visibilityState === 'visible')) {
        timer = setInterval(() => void poll(), 3000);
      }
    }
    function onFocusOrVisibility() {
      if (stopped) return;
      if (document.visibilityState === 'visible') void poll();
      else reschedule();
    }
    void poll();
    window.addEventListener('focus', onFocusOrVisibility);
    document.addEventListener('visibilitychange', onFocusOrVisibility);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      window.removeEventListener('focus', onFocusOrVisibility);
      document.removeEventListener('visibilitychange', onFocusOrVisibility);
    };
  }, [revision, onMode]);
  async function importDiary(commit: boolean) {
    setWorking(true); onBusyChange(true); setError('');
    try {
      const r = await apiFetch('/api/diary/storage-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commit ? { fingerprint: preview?.fingerprint } : {}) });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || t('diary.storageStatus.importFailed'));
      if (commit) { setPreview(null); onImported(); }
      else setPreview(data);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); onBusyChange(false); }
  }
  return <div className="diary-backup-status">
    {status?.mode === 'managed' ? <>
      <p>{t('diary.storageStatus.savedInNoevia')}</p>
      <p role="status">{status.backup === 'pending' ? t('diary.storageStatus.backupPending') : status.backup === 'failed' ? t('diary.storageStatus.backupFailed') : status.backup === 'complete' ? t('diary.storageStatus.backupComplete') : t('diary.storageStatus.webdavNotConnected')}</p>
      {status.lastBackedUp && <p className="diary-context-note">{t('diary.storageStatus.lastBackedUp', { date: new Date(status.lastBackedUp * 1000).toLocaleString() })}</p>}
      {status.error && <p className="diary-context-note">{status.error}</p>}
      <p className="diary-context-note">{t('diary.storageStatus.webdavVersionedNote')}</p>
    </> : status?.mode === 'legacy' ? <>
      <p>{t('diary.storageStatus.existingDiaryLegacy')}</p>
      <p className="diary-context-note">{t('diary.storageStatus.copyIntoNoeviaNote')}</p>
      <button className="popup-tab" disabled={busy || working} onClick={() => void importDiary(false)}>{working ? t('diary.storageStatus.checkingFiles') : t('diary.storageStatus.previewImport')}</button>
    </> : !statusError && <p role="status">{t('diary.storageStatus.checkingStorage')}</p>}
    {preview && <div>
      <p>{t('diary.storageStatus.readyToCopy', { files: t.plural('diary.storageStatus.fileCount', preview.fileCount), kib: (preview.bytes / 1024).toFixed(1) })}</p>
      <details><summary>{t('diary.storageStatus.reviewFileList')}</summary><ul>{preview.files.map(file => <li key={file.path}>{t('diary.storageStatus.fileBytes', { path: file.path, bytes: file.bytes })}</li>)}</ul></details>
      <p className="diary-context-note">{t('diary.storageStatus.checkedAgainNote')}</p>
      <button className="modal-btn primary" disabled={busy || working} onClick={() => void importDiary(true)}>{t('diary.storageStatus.copyAndUseApp')}</button>
      <button className="popup-tab" disabled={working} onClick={() => setPreview(null)}>{t('diary.storageStatus.cancel')}</button>
    </div>}
    {statusError && <p role="alert">{statusError}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
