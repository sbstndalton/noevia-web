import { useEffect, useRef, useState } from 'react';
import { diaryRequest, type DiaryFile } from '../diary-workspace';

type Record = {id:string;path:string;version:string;state:'trashed'|'restored';trashedAt:number};
type Page = {records:Record[];next:string|null};
async function request<T>(path:string,body?:unknown):Promise<T> {
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),65000);
  try{return await diaryRequest<T>(path,body,'POST',controller.signal);}
  catch(e){if(controller.signal.aborted)throw Error('Response timed out. Retry the same action or refresh Trash to check whether it completed.');throw e;}
  finally{window.clearTimeout(timer);}
}
export function DiaryWorkspaceTrash({enabled,busy,file,dirty,onWorking,onChanged}:{enabled:boolean;busy:boolean;file:DiaryFile;dirty:boolean;onWorking:(value:boolean)=>void;onChanged:()=>void}) {
  const [records,setRecords]=useState<Record[]>([]),[next,setNext]=useState<string|null>(null);
  const [loaded,setLoaded]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const operation=useRef<{path:string;version:string|null;id:string}|null>(null);
  const errorRef=useRef<HTMLParagraphElement>(null),statusRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(status)statusRef.current?.focus({preventScroll:true});},[status]);
  const run=async(action:()=>Promise<void>)=>{
    onWorking(true);setError('');setStatus('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:'Recovery request failed. Retry or refresh Trash.');requestAnimationFrame(()=>errorRef.current?.focus());}
    finally{onWorking(false);}
  };
  const load=async(after='')=>{
    const page=await request<Page>('workspace-trash'+(after?'?after='+encodeURIComponent(after):''));
    if(!page || !Array.isArray(page.records) || page.records.some(r=>!r || typeof r.id!=='string' || typeof r.path!=='string' || !['trashed','restored'].includes(r.state)))throw Error('Invalid recovery list. Retry loading Trash.');
    setRecords(old=>after?[...old,...page.records]:page.records);setNext(page.next);setLoaded(true);
  };
  const change=async(action:'trash'|'restore',id?:string)=>{
    if(action==='trash'){
      if(!window.confirm(`Move ${file.path} to Trash? You can restore it while its original path is unoccupied. Diary capture files are protected.`))return;
      if(operation.current?.path!==file.path || operation.current?.version!==file.version)operation.current={path:file.path,version:file.version,id:crypto.randomUUID()};
      id=operation.current.id;
    }
    await run(async()=>{
      const result=await request<Record>('workspace-trash',{action,id,...(action==='trash'?{path:file.path,version:file.version}:{})});
      if(!result || result.id!==id || !['trashed','restored'].includes(result.state))throw Error('Invalid recovery response. Retry the same action or refresh Trash.');
      setStatus(result.state==='trashed'?'Moved to Trash. The editor copy is retained; compare storage before saving.':'Restored to the original path. Existing editor drafts are unchanged.');
      if(result.state==='restored')operation.current=null;
      onChanged();await load();
    });
  };
  return <details className="diary-workspace-export diary-workspace-trash"><summary>Trash &amp; recovery</summary>
    <p>{enabled?'Move a saved Markdown file to Trash, or restore it to its unoccupied original path. Capture files and the Diary index are protected. Recovery records are included in workspace ZIPs and configured backups. No automatic deletion.':'Trash is available for app-managed Diary storage. Browser folders and legacy storage are unchanged.'}</p>
    {enabled && <>
      <button className="modal-btn secondary" disabled={busy || dirty || !file.version} onClick={()=>void change('trash')}>Move current file to Trash</button>
      {dirty && <p>Save or discard your edits before moving this file to Trash.</p>}
      <button className="modal-btn secondary" disabled={busy} onClick={()=>void run(()=>load())}>{loaded?'Refresh Trash':'Load Trash'}</button>
      {error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}{busy && <p role="status">Working…</p>}{status && <p role="status" tabIndex={-1} ref={statusRef}>{status}</p>}
      {loaded && !records.some(r=>r.state==='trashed') && <p>No trashed files on this page.</p>}
      <ul>{records.filter(r=>r.state==='trashed').map(record=><li key={record.id}><span>{record.path}</span><button className="modal-btn secondary" disabled={busy} onClick={()=>void change('restore',record.id)}>Restore {record.path}</button></li>)}</ul>
      {next && <button className="modal-btn secondary" disabled={busy} onClick={()=>void run(()=>load(next))}>Load more recovery records</button>}
    </>}
  </details>;
}
