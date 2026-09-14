import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

type Preview = {alreadyApplied?:boolean; fingerprint:string; destination:string; fileCount:number; bytes:number; files:string[]; directories:string[]; conflicts:string[]; duplicates:string[]};
export function DiaryWorkspaceImport({enabled, busy, onImported}:{enabled:boolean; busy:boolean; onImported:()=>void}) {
  const [file,setFile]=useState<File|null>(null),[name,setName]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[working,setWorking]=useState(false);
  const [error,setError]=useState(''),[status,setStatus]=useState('');
  const errorRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  const invalidate=()=>{setPreview(null);setError('');setStatus('');};
  const submit=async(apply=false)=>{
    if(!file)return;
    if(file.size>32*1024*1024){setError('Choose a ZIP up to 32 MiB. Larger archives need isolated operator restore.');return;}
    setWorking(true);setError('');setStatus(apply?'Importing into the new folder…':'Uploading and verifying ZIP…');
    const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),120000);
    try {
      const params=new URLSearchParams({action:apply?'apply':'preview',name});
      if(apply && preview)params.set('fingerprint',preview.fingerprint);
      const response=await apiFetch(`/api/diary/workspace-import?${params}`,{method:'POST',headers:{'Content-Type':'application/zip'},body:file,signal:controller.signal});
      const body=await response.json();
      if(!response.ok)throw Error(body.error || 'Import failed. Retry or choose a new folder.');
      if(apply){setPreview(null);setStatus(`Imported ${body.fileCount} files into ${body.destination}. Search indexing is pending.`);onImported();}
      else if(body.alreadyApplied){setPreview(null);setStatus(`This archive was already imported into ${body.destination}. Existing files have been left intact.`);onImported();}
      else{setPreview(body);setStatus('Preview ready. Review the destination and files before applying.');}
    }catch(e){setStatus('');setError(controller.signal.aborted?'Response timed out. Retry with the same file and folder to safely check whether the import completed.':e instanceof Error?e.message:'Import failed. Retry with the same file and folder.');}
    finally{window.clearTimeout(timer);setWorking(false);}
  };
  return <details className="diary-workspace-export diary-workspace-import"><summary>Import workspace</summary>
    <p>{enabled?'Import a noevia workspace ZIP into a new folder under Imports. Existing files and Diary settings stay intact. Up to 32 MiB per ZIP, 5,000 files and 256 MiB expanded. Exported Trash records stay inside the imported folder for isolated operator recovery; they do not become active notes or entries in this Diary’s Trash.':'ZIP import is available for app-managed Diary storage. Browser folders and legacy storage use isolated operator restore.'}</p>
    {enabled && <>
      {error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      <label className="diary-workspace-filter">Workspace ZIP<input type="file" accept=".zip,application/zip" disabled={busy || working} onChange={e=>{setFile(e.target.files?.[0] || null);invalidate();}}/></label>
      <label className="diary-workspace-filter">New folder name<input value={name} maxLength={100} disabled={busy || working} onChange={e=>{setName(e.target.value);invalidate();}}/></label>
      <button className="modal-btn secondary" disabled={busy || working || !file || !name.trim()} onClick={()=>void submit()}>Preview import</button>
      {status && <p role="status">{status}</p>}
      {preview && <div className="diary-import-preview">
        <p><strong>{preview.destination}</strong><br/>{preview.fileCount} files · {preview.directories.length} folders · {preview.bytes.toLocaleString()} bytes</p>
        <p>{preview.duplicates.length} files have identical content already in this Diary. They will still be copied into the new folder.</p>
        {!!preview.conflicts.length && <p role="alert">Destination conflicts: {preview.conflicts.slice(0,10).join(', ')}. Choose a new folder name.</p>}
        <details><summary>Review file and folder paths</summary><ul>{preview.directories.map(path=><li key={path+'/'}>{path}/</li>)}{preview.files.map(path=><li key={path}>{path}</li>)}</ul>{!preview.files.length && <p>No files; empty folders only.</p>}</details>
        {!!preview.duplicates.length && <details><summary>Review identical files</summary><ul>{preview.duplicates.map(path=><li key={path}>{path}</li>)}</ul></details>}
        <button className="modal-btn primary" disabled={busy || working || !!preview.conflicts.length} onClick={()=>void submit(true)}>Apply import to new folder</button>
      </div>}
    </>}
  </details>;
}
