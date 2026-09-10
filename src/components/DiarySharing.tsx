import { useEffect, useState, type JSX } from 'react';
import { apiFetch } from '../api';
type Sharing = { available:boolean; reason?:string; scope:'off'|'lan'|'public'; endpointScope?:'lan'|'public'; cleartext:boolean; port?:number; url:string; eligible:boolean };
export default function DiarySharing(): JSX.Element {
  const [value,setValue]=useState<Sharing|null>(null),[scope,setScope]=useState('off'),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void apiFetch('/api/profile/sharing').then(async r=>{if(!r.ok)throw Error('Could not load file sharing.');const v=await r.json();setValue(v);setScope(v.scope);}).catch(e=>setError(e.message));},[]);
  const save=async()=>{
    setBusy(true);setError('');
    try{const r=await apiFetch('/api/profile/sharing',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,acknowledgeCleartext:ack})});const v=await r.json();if(!r.ok)throw Error(v.error||'Could not save sharing.');setValue(v);setScope(v.scope);setAck(false);}
    catch(e){setError(e instanceof Error?e.message:'Could not save sharing.');}finally{setBusy(false);}
  };
  return <section aria-label="Diary file sharing" style={{marginTop:24}}><div className="rail-label">Diary file sharing</div>
    <p className="route-note">Share server-held Markdown files with a device app password. This initial endpoint supports listing, reading and conditional saves; file-manager mounting, folders, rename, delete and locking are not supported yet.</p>
    {value && <>
      <p className="route-note">Current access: {value.scope === 'off' ? 'Off' : value.scope === 'lan' ? 'LAN endpoint' : 'Public HTTPS'}.</p>
      {!value.available && <p className="route-note">{value.reason} Sharing stays off.</p>}
      {!value.eligible && <p className="route-note">Requires enabled Diary with server-held local storage. Remote and browser-local folders are not shared.</p>}
      <label className="route-note">Access<select aria-label="Diary sharing access" className="modal-input" value={scope} disabled={busy} onChange={e=>{setScope(e.target.value);setAck(false);}}><option value="off">Off</option><option value="lan" disabled={!value.available||!value.eligible||value.endpointScope!=='lan'}>This network (operator controlled)</option><option value="public" disabled={!value.available||!value.eligible||value.endpointScope!=='public'}>Public HTTPS</option></select></label>
      {scope!=='off' && <p className="route-note">The operator serves this on port {value.port}. noevia cannot verify who can reach that port; your proxy and network configuration determine access.</p>}
      {scope!=='off'&&value.cleartext&&<label className="route-note"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/> I understand plain HTTP sends my device password unencrypted across the network.</label>}
      <button style={{display:'block',marginTop:8}} className="modal-btn secondary" disabled={busy||scope!=='off'&&value.cleartext&&!ack} onClick={()=>void save()}>{busy?'Saving…':'Save sharing'}</button>
      {value.scope!=='off'&&value.available&&<><p className="route-note">Use your noevia username and an app password with {value.endpointScope} scope from Profile & security.</p><input className="modal-input" aria-label="Diary sharing URL" readOnly value={value.url} onFocus={e=>e.currentTarget.select()}/></>}
    </>}
    {error&&<p role="alert" className="route-note">{error}</p>}
  </section>;
}
