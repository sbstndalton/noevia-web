import { useEffect, useRef, useState } from 'react';
import { ShellIcon } from './ShellIcon';
import type { JSX } from 'react';
import { browseStorage, createStorageFolder } from '../api';
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
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const saving = useRef(false);
  const [savingFolder, setSavingFolder] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let stale = false;
    setBusy(true);
    setError('');
    setLoadedPath(null);
    browseStorage(path)
      .then((r) => { if (!stale) { setEntries(r.entries.filter((e) => e.isDir)); setLoadedPath(path); } })
      .catch((e: unknown) => { if (!stale) setError(e instanceof Error ? e.message : 'Could not list that folder'); })
      .finally(() => { if (!stale) setBusy(false); });
    return () => { stale = true; };
  }, [path, reload]);

  const makeFolder = async () => {
    const name = newName.trim();
    if (!name || busy || saving.current) return;
    saving.current = true;
    setSavingFolder(true);
    setBusy(true);
    setError('');
    try {
      const made = await createStorageFolder(path ? `${path}/${name}` : name);
      setNewName('');
      setCreating(false);
      setReload((n) => n + 1);
      if (made.existed) setError(`"${name}" already existed here.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that folder');
      setBusy(false);
    } finally { saving.current = false; setSavingFolder(false); }
  };

  const up = () => setPath(path.split('/').slice(0, -1).join('/'));

  return (
    <dialog ref={dialog} className="folder-picker aero dialog-sheet" aria-label="Choose a folder" onCancel={e=>{e.preventDefault();onClose();}}>
      <header>
        <button className="btn btn-ghost btn-sm" onClick={up} disabled={!path || savingFolder}><ShellIcon name="arrow-up" size={16}/>Up</button>
        <code>{path ? `/${path}` : '/ (all files)'}</code>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </header>
      {error && <p className="modal-err" role="alert">{error} <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setReload(n => n + 1)}>Retry</button></p>}
      {busy && <p className="insp-empty" role="status">Loading…</p>}
      {!busy && loadedPath === path && entries.length === 0 && (
        <p className="insp-empty">No sub-folders here. Link this folder, create one, or go up.</p>
      )}
      <ul className="folder-list">
        {(loadedPath === path && !busy ? entries : []).map((e) => (
          <li key={e.path}>
            <button className="folder-open" disabled={savingFolder} onClick={() => setPath(e.path)}>📁 {e.name}</button>
          </li>
        ))}
      </ul>
      <footer>
        {creating ? (
          <>
            <input
              className="modal-input folder-new-name"
              autoFocus
              placeholder="New folder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void makeFolder();
                if (e.key === 'Escape') { setCreating(false); setNewName(''); }
              }}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setNewName(''); }}>Cancel</button>
            <button className="btn btn-secondary btn-sm" onClick={() => void makeFolder()} disabled={!newName.trim() || busy}>Create</button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary btn-sm" disabled={busy || loadedPath !== path} onClick={() => setCreating(true)}>New folder</button>
            <button className="btn btn-primary btn-sm" onClick={() => onPick(path)} disabled={!path || busy || loadedPath !== path}>
              Link {path ? `“${path.split('/').pop()}”` : 'this folder'}
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}
