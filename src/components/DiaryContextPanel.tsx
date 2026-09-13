import type { ReactNode } from 'react';
import type { FileEntry } from '../diary-workspace';
import { ShellIcon } from './ShellIcon';
type Props = {
  recovery?: ReactNode;
  busy: boolean; files: FileEntry[]; filePath: string; setFilePath: (path: string) => void;
  openFile: (path: string) => void; newFile: () => void; chooseStorage: () => void;
  pendingCount: number; pendingLocal: boolean; folderName?: string; savedLabel: string;
  corpusRoot?: string; sync: boolean; setSync: (sync: boolean) => void; disconnect: () => void;
};
export function DiaryContextPanel({ recovery, busy, files, filePath, setFilePath, openFile, newFile, chooseStorage,
  pendingCount, pendingLocal, folderName, savedLabel, corpusRoot, sync, setSync, disconnect }: Props) {
  return <aside className="diary-context">
    <section>
      <div className="diary-panel-heading"><h2>Memory & context</h2><button className="popup-tab" disabled={busy} onClick={newFile}>New</button></div>
      <p className="diary-intro">Open a Markdown file to read or edit it.</p>
      <div className="diary-file-breadcrumb">
        <button className="popup-tab" disabled={busy} onClick={() => setFilePath('')}>Diary folder</button>
        {filePath && <><span>/ {filePath}</span><button className="popup-tab" disabled={busy} onClick={() => setFilePath(filePath.split('/').slice(0,-1).join('/'))}>Up</button></>}
      </div>
      <div className="diary-file-list">
        {files.map(file => <button key={file.path} disabled={busy} title={file.path} onClick={() => file.isDir ? setFilePath(file.path) : openFile(file.path)}>
          <ShellIcon name={file.isDir ? 'folder' : 'book'} size={16}/>{file.name}
        </button>)}
        {!files.length && <p className="diary-intro">No Markdown files here yet.</p>}
      </div>
      <p className="diary-context-note">MEMORY.md and files in AI Memory/, memory/ or context/ are included as diary reference material.</p>
    </section>
    <section>
      <div className="diary-panel-heading"><h2>Storage location</h2><button className="popup-tab" disabled={busy || pendingCount > 0} onClick={chooseStorage}>Edit</button></div>
      <strong>{folderName ?? savedLabel}</strong>
      <p className="diary-storage-path">{folderName !== undefined ? 'This computer · current session' : corpusRoot || 'Diary folder'}</p>
      {folderName !== undefined ? <>
        <label className="diary-sync-toggle"><input type="checkbox" checked={sync} disabled={busy} onChange={e => setSync(e.target.checked)} />Also sync to {savedLabel}</label>
        <p className="diary-context-note">Applies to new changes. Pending sync remains available to retry. Reopening noevia restores {savedLabel}.</p>
        <button className="popup-tab" disabled={busy || pendingLocal} onClick={disconnect}>Return to {savedLabel}</button>
      </> : <p className="diary-context-note">Your saved connection is used when you reopen noevia.</p>}
    </section>
    {recovery}
  </aside>;
}
