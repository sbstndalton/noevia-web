import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { InstalledModel } from '../types';
export function MtpControl({model,onChanged}:{model:InstalledModel;onChanged:()=>void}) {
  const [enabled,setEnabled]=useState(model.mtp?.enabled ?? false);
  const [admin,setAdmin]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setEnabled(model.mtp?.enabled ?? false);},[model.name,model.mtp?.enabled]);
  useEffect(()=>{void apiFetch('/api/profile').then(r=>r.json()).then(v=>setAdmin(v.user?.role==='admin')).catch(()=>{});},[]);
  const apply=async()=>{setBusy(true);setError('');try{
    const r=await apiFetch('/api/models/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:model.name,mtp:enabled})});
    const v=await r.json();if(!r.ok)throw new Error(v.error || 'MTP setting failed');onChanged();
  }catch(e){setError(e instanceof Error?e.message:'MTP setting failed');}finally{setBusy(false);}};
  return <div className="model-mtp">
    <label>Enable MTP? <select aria-label={`Enable MTP for ${model.name}`} value={enabled?'yes':'no'} disabled={busy || !admin || !model.mtp?.supported} onChange={e=>setEnabled(e.target.value==='yes')}><option value="yes">Yes</option><option value="no">No</option></select></label>
    {model.mtp?.supported && <button className="popup-tab" disabled={busy || !admin} onClick={()=>void apply()}>{busy?'Loading…':'Apply and load'}</button>}
    <small>{model.mtp?.reason || 'MTP capability unavailable.'}{!admin && ' An administrator manages shared model loading.'}</small>
    {model.mtp?.supported && <small>Loads or reloads this shared model. Speed and memory use depend on workload and GPU configuration.</small>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
