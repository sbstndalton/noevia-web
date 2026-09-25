import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { useT } from '../i18n';

type Preview = {alreadyApplied?:boolean; fingerprint:string; destination:string; fileCount:number; bytes:number; files:string[]; directories:string[]; conflicts:string[]; duplicates:string[]};
export function DiaryWorkspaceImport({enabled, busy, onImported}:{enabled:boolean; busy:boolean; onImported:()=>void}) {
  const t=useT();
  const [file,setFile]=useState<File|null>(null),[name,setName]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[working,setWorking]=useState(false);
  const [error,setError]=useState(''),[status,setStatus]=useState('');
  const errorRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  const invalidate=()=>{setPreview(null);setError('');setStatus('');};
  const submit=async(apply=false)=>{
    if(!file)return;
    if(file.size>32*1024*1024){setError(t('diary.import.zipTooLarge'));return;}
    setWorking(true);setError('');setStatus(apply?t('diary.import.importingIntoFolder'):t('diary.import.uploadingAndVerifying'));
    const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),120000);
    try {
      const params=new URLSearchParams({action:apply?'apply':'preview',name});
      if(apply && preview)params.set('fingerprint',preview.fingerprint);
      const response=await apiFetch(`/api/diary/workspace-import?${params}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:file,signal:controller.signal});
      const body=await response.json();
      if(!response.ok)throw Error(body.error || t('diary.import.importFailed'));
      if(apply){setPreview(null);setStatus(t('diary.import.imported', { count: body.fileCount, destination: body.destination }));onImported();}
      else if(body.alreadyApplied){setPreview(null);setStatus(t('diary.import.alreadyImported', { destination: body.destination }));onImported();}
      else{setPreview(body);setStatus(t('diary.import.previewReady'));}
    }catch(e){setStatus('');setError(controller.signal.aborted?t('diary.import.responseTimedOut'):e instanceof Error?e.message:t('diary.import.importFailedRetry'));}
    finally{window.clearTimeout(timer);setWorking(false);}
  };
  return <details className="diary-workspace-export diary-workspace-import"><summary>{t('diary.import.title')}</summary>
    <p>{enabled?t('diary.import.enabledHint'):t('diary.import.disabledHint')}</p>
    {enabled && <>
      {error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      <label className="diary-workspace-filter">{t('diary.import.workspaceZip')}<input type="file" accept=".zip,application/zip" disabled={busy || working} onChange={e=>{setFile(e.target.files?.[0] || null);invalidate();}}/></label>
      <label className="diary-workspace-filter">{t('diary.import.newFolderName')}<input value={name} maxLength={100} disabled={busy || working} onChange={e=>{setName(e.target.value);invalidate();}}/></label>
      <button className="modal-btn secondary" disabled={busy || working || !file || !name.trim()} onClick={()=>void submit()}>{t('diary.import.previewImport')}</button>
      {status && <p role="status">{status}</p>}
      {preview && <div className="diary-import-preview">
        <p><strong>{preview.destination}</strong><br/>{t('diary.import.summary', { files: preview.fileCount, folders: preview.directories.length, bytes: preview.bytes.toLocaleString() })}</p>
        <p>{t('diary.import.duplicatesNote', { count: preview.duplicates.length })}</p>
        {!!preview.conflicts.length && <p role="alert">{t('diary.import.destinationConflicts', { list: preview.conflicts.slice(0,10).join(', ') })}</p>}
        <details><summary>{t('diary.import.reviewPaths')}</summary><ul>{preview.directories.map(path=><li key={path+'/'}>{path}/</li>)}{preview.files.map(path=><li key={path}>{path}</li>)}</ul>{!preview.files.length && <p>{t('diary.import.noFilesEmptyFolders')}</p>}</details>
        {!!preview.duplicates.length && <details><summary>{t('diary.import.reviewIdenticalFiles')}</summary><ul>{preview.duplicates.map(path=><li key={path}>{path}</li>)}</ul></details>}
        <button className="modal-btn primary" disabled={busy || working || !!preview.conflicts.length} onClick={()=>void submit(true)}>{t('diary.import.applyImport')}</button>
      </div>}
    </>}
  </details>;
}
