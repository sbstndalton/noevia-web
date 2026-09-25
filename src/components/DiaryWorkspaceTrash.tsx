import { useEffect, useRef, useState } from 'react';
import { diaryRequest, type DiaryFile } from '../diary-workspace';
import { useT } from '../i18n';

type Record = {id:string;path:string;version:string;state:'trashed'|'restored';trashedAt:number};
type Page = {records:Record[];next:string|null};
async function request<T>(path:string,body:unknown,timeoutMessage:string):Promise<T> {
  const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),65000);
  try{return await diaryRequest<T>(path,body,'POST',controller.signal);}
  catch(e){if(controller.signal.aborted)throw Error(timeoutMessage);throw e;}
  finally{window.clearTimeout(timer);}
}
export function DiaryWorkspaceTrash({enabled,busy,file,dirty,onWorking,onChanged}:{enabled:boolean;busy:boolean;file:DiaryFile;dirty:boolean;onWorking:(value:boolean)=>void;onChanged:()=>void}) {
  const t=useT();
  const [records,setRecords]=useState<Record[]>([]),[next,setNext]=useState<string|null>(null);
  const [loaded,setLoaded]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const operation=useRef<{path:string;version:string|null;id:string}|null>(null);
  const errorRef=useRef<HTMLParagraphElement>(null),statusRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(status)statusRef.current?.focus({preventScroll:true});},[status]);
  const run=async(action:()=>Promise<void>)=>{
    onWorking(true);setError('');setStatus('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:t('diary.trash.recoveryRequestFailed'));requestAnimationFrame(()=>errorRef.current?.focus());}
    finally{onWorking(false);}
  };
  const load=async(after='')=>{
    const page=await request<Page>('workspace-trash'+(after?'?after='+encodeURIComponent(after):''),undefined,t('diary.trash.responseTimedOutList'));
    if(!page || !Array.isArray(page.records) || page.records.some(r=>!r || typeof r.id!=='string' || typeof r.path!=='string' || !['trashed','restored'].includes(r.state)))throw Error(t('diary.trash.invalidList'));
    setRecords(old=>after?[...old,...page.records]:page.records);setNext(page.next);setLoaded(true);
  };
  const change=async(action:'trash'|'restore',id?:string)=>{
    if(action==='trash'){
      if(!window.confirm(t('diary.trash.confirmMove', { path: file.path })))return;
      if(operation.current?.path!==file.path || operation.current?.version!==file.version)operation.current={path:file.path,version:file.version,id:crypto.randomUUID()};
      id=operation.current.id;
    }
    await run(async()=>{
      const result=await request<Record>('workspace-trash',{action,id,...(action==='trash'?{path:file.path,version:file.version}:{})},t('diary.trash.responseTimedOutAction'));
      if(!result || result.id!==id || !['trashed','restored'].includes(result.state))throw Error(t('diary.trash.invalidResponse'));
      setStatus(result.state==='trashed'?t('diary.trash.movedToTrash'):t('diary.trash.restoredToOriginal'));
      if(result.state==='restored')operation.current=null;
      onChanged();await load();
    });
  };
  return <details className="diary-workspace-export diary-workspace-trash"><summary>{t('diary.trash.title')}</summary>
    <p>{enabled?t('diary.trash.enabledHint'):t('diary.trash.disabledHint')}</p>
    {enabled && <>
      <button className="modal-btn secondary" disabled={busy || dirty || !file.version} onClick={()=>void change('trash')}>{t('diary.trash.moveToTrash')}</button>
      {dirty && <p>{t('diary.trash.saveOrDiscardFirst')}</p>}
      <button className="modal-btn secondary" disabled={busy} onClick={()=>void run(()=>load())}>{loaded?t('diary.trash.refresh'):t('diary.trash.load')}</button>
      {error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}{busy && <p role="status">{t('diary.workspace.working')}</p>}{status && <p role="status" tabIndex={-1} ref={statusRef}>{status}</p>}
      {loaded && !records.some(r=>r.state==='trashed') && <p>{t('diary.trash.noTrashedFiles')}</p>}
      <ul>{records.filter(r=>r.state==='trashed').map(record=><li key={record.id}><span>{record.path}</span><button className="modal-btn secondary" disabled={busy} onClick={()=>void change('restore',record.id)}>{t('diary.trash.restorePath', { path: record.path })}</button></li>)}</ul>
      {next && <button className="modal-btn secondary" disabled={busy} onClick={()=>void run(()=>load(next))}>{t('diary.trash.loadMore')}</button>}
    </>}
  </details>;
}
