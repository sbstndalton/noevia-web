import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { InstalledModel } from '../types';
import { useT } from '../i18n';
export function MtpControl({model,onChanged}:{model:InstalledModel;onChanged:()=>void}) {
  const [enabled,setEnabled]=useState(model.mtp?.enabled ?? false);
  const [admin,setAdmin]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const t=useT();
  useEffect(()=>{setEnabled(model.mtp?.enabled ?? false);},[model.name,model.mtp?.enabled]);
  useEffect(()=>{void apiFetch('/api/profile').then(r=>r.json()).then(v=>setAdmin(v.user?.role==='admin')).catch(()=>{});},[]);
  const apply=async()=>{setBusy(true);setError('');try{
    const r=await apiFetch('/api/models/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:model.name,mtp:enabled})});
    const v=await r.json();if(!r.ok)throw new Error(v.error || t('mm.mtp.failed'));onChanged();
  }catch(e){setError(e instanceof Error?e.message:t('mm.mtp.failed'));}finally{setBusy(false);}};
  return <div className="model-mtp">
    <label>{t('mm.mtp.enable')} <select aria-label={t('mm.mtp.enableFor', { model: model.name })} value={enabled?'yes':'no'} disabled={busy || !admin || !model.mtp?.supported} onChange={e=>setEnabled(e.target.value==='yes')}><option value="yes">{t('mm.autoconfig.yes')}</option><option value="no">{t('mm.autoconfig.no')}</option></select></label>
    {model.mtp?.supported && <button className="popup-tab" disabled={busy || !admin} onClick={()=>void apply()}>{busy?t('mm.loading'):t('mm.mtp.apply')}</button>}
    <small>{model.mtp?.reason || t('mm.mtp.unavailable')}{!admin && ` ${t('mm.mtp.adminOnly')}`}</small>
    {model.mtp?.supported && <small>{t('mm.mtp.note')}</small>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
