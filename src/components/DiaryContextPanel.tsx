import type { ReactNode } from 'react';
import type { FileEntry } from '../diary-workspace';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';
type Props = {
  recovery?: ReactNode; storageStatus?: ReactNode; managed?: boolean;
  filesLoading?: boolean; filesError?: string; retryFiles?: () => void;
  busy: boolean; files: FileEntry[]; filePath: string; setFilePath: (path: string) => void;
  openFile: (path: string) => void; newFile: () => void; chooseStorage: () => void;
  pendingCount: number; pendingLocal: boolean; folderName?: string; savedLabel: string;
  corpusRoot?: string; sync: boolean; setSync: (sync: boolean) => void; disconnect: () => void;
};
export function DiaryContextPanel({ recovery, storageStatus, managed, filesLoading, filesError, retryFiles, busy, files, filePath, setFilePath, openFile, newFile, chooseStorage,
  pendingCount, pendingLocal, folderName, savedLabel, corpusRoot, sync, setSync, disconnect }: Props) {
  const t = useT();
  return <aside className="diary-context">
    <section>
      <div className="diary-panel-heading"><h2>{t('diary.context.memoryAndContext')}</h2><button className="popup-tab" disabled={busy} onClick={newFile}>{t('diary.context.new')}</button></div>
      <p className="diary-intro">{t('diary.context.openMarkdownHint')}</p>
      <div className="diary-file-breadcrumb">
        <button className="popup-tab" disabled={busy} onClick={() => setFilePath('')}>{t('diary.context.diaryFolder')}</button>
        {filePath && <><span>/ {filePath}</span><button className="popup-tab" disabled={busy} onClick={() => setFilePath(filePath.split('/').slice(0,-1).join('/'))}>{t('diary.context.up')}</button></>}
      </div>
      <div className="diary-file-list">
        {filesLoading && <p role="status">{t('diary.context.loadingFiles')}</p>}
        {filesError && <div role="alert"><p>{filesError}</p><button className="popup-tab" disabled={busy} onClick={retryFiles}>{t('diary.context.retryFileList')}</button></div>}
        {!filesLoading && !filesError && files.map(file => <button key={file.path} disabled={busy} title={file.path} onClick={() => file.isDir ? setFilePath(file.path) : openFile(file.path)}>
          <ShellIcon name={file.isDir ? 'folder' : 'book'} size={16}/>{file.name}
        </button>)}
        {!filesLoading && !filesError && !files.length && <p className="diary-intro">{t('diary.context.noMarkdownFiles')}</p>}
      </div>
      <p className="diary-context-note">{t('diary.context.memoryFilesNote')}</p>
    </section>
    <section>
      <div className="diary-panel-heading"><h2>{t('diary.context.diaryStorage')}</h2><button className="popup-tab" disabled={busy || pendingCount > 0} onClick={chooseStorage}>{t('diary.context.edit')}</button></div>
      <strong>{folderName ?? (managed ? t('diary.storage.appStorage') : savedLabel)}</strong>
      <p className="diary-storage-path">{folderName !== undefined ? t('diary.context.thisComputer') : managed ? t('diary.context.savedOnServer') : corpusRoot || t('diary.context.diaryFolderPlain')}</p>
      {folderName !== undefined ? <>
        <label className="diary-sync-toggle"><input type="checkbox" checked={sync} disabled={busy} onChange={e => setSync(e.target.checked)} />{t('diary.wizard.alsoSyncTo', { label: savedLabel })}</label>
        <p className="diary-context-note">{t('diary.context.appliesToNewChanges', { label: savedLabel })}</p>
        <button className="popup-tab" disabled={busy || pendingLocal} onClick={disconnect}>{t('diary.context.returnTo', { label: savedLabel })}</button>
      </> : null}
      <div hidden={folderName !== undefined}>{storageStatus}</div>
    </section>
    {recovery}
  </aside>;
}
