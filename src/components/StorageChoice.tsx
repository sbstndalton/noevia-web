import { useState, type JSX } from 'react';
import { saveStorage } from '../api';
import { StoragePicker } from './StoragePicker';
import DiarySharing from './DiarySharing';
export function StorageChoice({ onContinue }: { onContinue:()=>void }): JSX.Element {
  const [choice,setChoice]=useState<'hosted'|'external'|null>(null),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const host=async()=>{
    setBusy(true);setError('');
    try{await saveStorage({kind:'local',baseUrl:'',username:'',corpusRoot:'',secret:''});setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Could not save storage.');}finally{setBusy(false);}
  };
  return <div>
    <p>Choose where your diary files live. Skipping keeps the current configuration. Changing storage does not move or delete existing files.</p>
    <div style={{display:'grid',gap:8}}>
      <button type="button" className="modal-btn secondary" aria-pressed={choice==='hosted'} disabled={busy} onClick={()=>{setChoice('hosted');setSaved(false);setError('');}}>Let noevia hold my diary</button>
      <small>Files stay on this server. Optional device access needs a configured sharing endpoint; it stays off until you enable it.</small>
      <button type="button" className="modal-btn secondary" aria-pressed={choice==='external'} disabled={busy} onClick={()=>{setChoice('external');setSaved(false);setError('');}}>Connect storage I already run</button>
      <small>Use Nextcloud, WebDAV or S3. Your storage service keeps its existing access and sync options.</small>
    </div>
    {choice==='hosted' && !saved && <button type="button" disabled={busy} onClick={()=>void host()}>{busy?'Saving…':'Use server storage'}</button>}
    {choice==='hosted' && saved && <><p role="status">Server storage saved.</p><DiarySharing/><button type="button" onClick={onContinue}>Continue</button></>}
    {choice==='external' && <StoragePicker onlineOnly onSaved={onContinue}/>}
    {error&&<p role="alert" className="auth-error">{error}</p>}
    <button type="button" className="modal-btn secondary" disabled={busy} onClick={onContinue}>Skip — set up later in Settings</button>
  </div>;
}
