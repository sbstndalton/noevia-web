import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { browseStorage } from '../api';
import type { StorageEntry } from '../api';

/** Pick a folder from connected storage to attach to a project. The existing
 *  StorageFileBrowser picks individual files and copies their contents; this
 *  picks the directory itself, so the project keeps a live reference that a
 *  sync can re-read. */
export function FolderPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (path: string) => void;
}): JSX.Element {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setBusy(true);
    setError('');
    browseStorage(path)
      .then((r) => setEntries(r.entries.filter((e) => e.isDir)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not list that folder'))
      .finally(() => setBusy(false));
  }, [path]);

  const up = () => setPath(path.split('/').slice(0, -1).join('/'));

  return (
    <div className="folder-picker" role="dialog" aria-label="Choose a folder">
      <header>
        <button className="btn btn-ghost btn-sm" onClick={up} disabled={!path}>↑ Up</button>
        <code>{path || '/'}</code>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </header>
      {error && <p className="modal-err">{error}</p>}
      {busy && <p className="insp-empty">Loading…</p>}
      {!busy && !error && entries.length === 0 && (
        <p className="insp-empty">No sub-folders here. Attach this folder, or go up.</p>
      )}
      <ul className="folder-list">
        {entries.map((e) => (
          <li key={e.path}>
            <button className="folder-open" onClick={() => setPath(e.path)}>📁 {e.name}</button>
          </li>
        ))}
      </ul>
      <footer>
        <button className="btn btn-primary btn-sm" onClick={() => onPick(path)} disabled={!path}>
          Attach {path ? `“${path.split('/').pop()}”` : 'this folder'}
        </button>
      </footer>
    </div>
  );
}
