import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Status = { mode: 'managed' | 'legacy'; backup: 'not_configured' | 'pending' | 'failed' | 'complete'; lastBackedUp: number | null; error?: string };
type Preview = { fingerprint: string; fileCount: number; bytes: number; files: { path: string; bytes: number; sha256: string }[] };
export function DiaryStorageStatus({ busy, revision, onMode, onImported, onBusyChange }: { busy: boolean; revision: number; onMode: (mode: 'managed' | 'legacy') => void; onImported: () => void; onBusyChange: (busy: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let stopped = false, running = false;
    async function poll() {
      if (running) return;
      running = true;
      try {
        const r = await apiFetch('/api/diary/storage-status');
        if (!r.ok) throw Error('Storage status is unavailable. Check your saved files before retrying an entry.');
        const value: Status = await r.json();
        if (value.mode !== 'managed' && value.mode !== 'legacy') throw Error('Storage status is unavailable.');
        if (!stopped) { setStatus(value); onMode(value.mode); if(value.mode === 'managed')setPreview(null); setStatusError(''); }
      } catch (e) { if (!stopped) { setStatus(null); setStatusError(String(e instanceof Error ? e.message : e)); } }
      finally { running = false; }
    }
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [revision, onMode]);
  async function importDiary(commit: boolean) {
    setWorking(true); onBusyChange(true); setError('');
    try {
      const r = await apiFetch('/api/diary/storage-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commit ? { fingerprint: preview?.fingerprint } : {}) });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || 'Import failed. Original files are unchanged.');
      if (commit) { setPreview(null); onImported(); }
      else setPreview(data);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); onBusyChange(false); }
  }
  return <div className="diary-backup-status">
    {status?.mode === 'managed' ? <>
      <p>Saved changes are stored in noevia.</p>
      <p role="status">{status.backup === 'pending' ? 'Backup pending · starts after a few quiet seconds' : status.backup === 'failed' ? 'Backup failed · app saves are retained; retrying automatically' : status.backup === 'complete' ? 'All saved changes backed up' : 'WebDAV backup is not connected'}</p>
      {status.lastBackedUp && <p className="diary-context-note">Last backed up: {new Date(status.lastBackedUp * 1000).toLocaleString()}</p>}
      {status.error && <p className="diary-context-note">{status.error}</p>}
      <p className="diary-context-note">WebDAV keeps versioned Markdown backups. Remote edits do not change your app diary.</p>
    </> : status?.mode === 'legacy' ? <>
      <p>Your existing diary still uses its original storage.</p>
      <p className="diary-context-note">Copy it into noevia to save independently of WebDAV. Review the files first; originals stay intact. Close other diary sessions and pause external editing during import.</p>
      <button className="popup-tab" disabled={busy || working} onClick={() => void importDiary(false)}>{working ? 'Checking files…' : 'Preview import into noevia'}</button>
    </> : !statusError && <p role="status">Checking storage…</p>}
    {preview && <div>
      <p>{preview.fileCount} {preview.fileCount === 1 ? 'file' : 'files'} · {(preview.bytes / 1024).toFixed(1)} KiB ready to copy.</p>
      <details><summary>Review file list</summary><ul>{preview.files.map(file => <li key={file.path}>{file.path} · {file.bytes} bytes</li>)}</ul></details>
      <p className="diary-context-note">Files are checked again before switching. Future edits will be saved in the app, with backups in a separate noevia-backups folder. Existing WebDAV files remain unchanged.</p>
      <button className="modal-btn primary" disabled={busy || working} onClick={() => void importDiary(true)}>Copy verified files &amp; use app storage</button>
      <button className="popup-tab" disabled={working} onClick={() => setPreview(null)}>Cancel</button>
    </div>}
    {statusError && <p role="alert">{statusError}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
