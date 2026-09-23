import { useEffect, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { browseStorage, fetchStorage, readStorageFile } from '../api';
import type { StorageEntry } from '../api';
import { useModalDialog } from './useModalDialog';
import { CloseButton } from './CloseButton';

export interface PickedFile { name: string; content: string }

function humanSize(size: number | null): string {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Browse the user's connected external storage and pick text files to pull
 *  into a project (knowledge intake). Read-only; imports copy content. */
export function StorageFileBrowser({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (files: PickedFile[]) => void;
}): JSX.Element {
  const dialog = useModalDialog();
  const [kind, setKind] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<string[]>([]);

  useEffect(() => {
    fetchStorage()
      .then((c) => setKind(c.kind))
      .catch(() => { setError('Could not load your storage connection. Close this dialog and try again.'); setBusy(false); });
  }, []);

  useEffect(() => {
    if (!kind) return;
    if (kind === 'local') { setBusy(false); return; }
    setBusy(true);
    setError('');
    browseStorage(path)
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [kind, path]);

  const addFile = async (entry: StorageEntry) => {
    if (added.includes(entry.path)) return;
    setBusy(true);
    setError('');
    try {
      const file = await readStorageFile(entry.path);
      setAdded((prev) => [...prev, entry.path]);
      onPick([{ name: file.name, content: file.content }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const containTab = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
  };

  const segments = path ? path.split('/') : [];
  const dirs = entries.filter((e) => e.isDir);
  const files = entries.filter((e) => !e.isDir);

  return (
    <dialog ref={dialog} className="modal-card aero dialog-sheet" aria-label="Pull from your storage"
      onCancel={(e) => { e.preventDefault(); onClose(); }} onKeyDown={containTab}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
      }}>
        <div className="modal-head">
          <h2>Pull from your storage</h2>
          <CloseButton onClick={onClose}/>
        </div>

        {kind === 'local' ? (
          <p className="route-note">
            No external storage is connected. Connect Nextcloud, WebDAV, or an
            S3-compatible bucket in Settings → Diary storage, then pull text
            files from it here.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              <button className="popup-tab" style={{ border: '1px solid var(--border)' }} onClick={() => setPath('')}>
                Root
              </button>
              {segments.map((seg, i) => (
                <button
                  key={i}
                  className="popup-tab"
                  style={{ border: '1px solid var(--border)' }}
                  onClick={() => setPath(segments.slice(0, i + 1).join('/'))}
                >
                  {seg}
                </button>
              ))}
            </div>

            {busy && <p className="route-note" role="status">Loading…</p>}
            {error && <p className="modal-err" role="alert">{error}</p>}

            <div className="modal-files" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              {dirs.map((e) => (
                <div key={e.path} className="model-row" style={{ padding: '8px 12px', marginBottom: 4 }}>
                  <button
                    className="model-name-group"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
                    onClick={() => setPath(e.path)}
                  >
                    <span className="model-name">📁 {e.name}</span>
                  </button>
                </div>
              ))}
              {files.map((e) => (
                <div key={e.path} className="model-row" style={{ padding: '8px 12px', marginBottom: 4 }}>
                  <span className="model-name-group">
                    <span className="model-name" style={{ fontWeight: 400 }}>{e.name}</span>
                    <span className="route-note">{humanSize(e.size)}</span>
                  </span>
                  <button
                    className="popup-tab"
                    style={{
                      border: added.includes(e.path) ? '1px solid var(--border)' : '1px solid var(--accent)',
                      color: added.includes(e.path) ? 'var(--text-secondary)' : 'var(--accent-text)',
                    }}
                    disabled={added.includes(e.path)}
                    onClick={() => void addFile(e)}
                  >
                    {added.includes(e.path) ? 'added' : 'add'}
                  </button>
                </div>
              ))}
              {!busy && !dirs.length && !files.length && !error && (
                <p className="route-note">This folder is empty.</p>
              )}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="modal-btn primary" onClick={onClose}>Done</button>
        </div>
    </dialog>
  );
}
