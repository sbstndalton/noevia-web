import { useEffect, useState, type JSX } from 'react';
import { apiFetch } from '../api';
import { useT } from '../i18n';
type Sharing = { available:boolean; reason?:string; scope:'off'|'lan'|'public'; endpointScope?:'lan'|'public'; cleartext:boolean; port?:number; url:string; eligible:boolean };
export default function DiarySharing(): JSX.Element {
  const t=useT();
  const [value,setValue]=useState<Sharing|null>(null),[scope,setScope]=useState('off'),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void apiFetch('/api/profile/sharing').then(async r=>{if(!r.ok)throw Error(t('sharing.loadError'));const v=await r.json();setValue(v);setScope(v.scope);}).catch(e=>setError(e.message));},[]);
  const save=async()=>{
    setBusy(true);setError('');
    try{const r=await apiFetch('/api/profile/sharing',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,acknowledgeCleartext:ack})});const v=await r.json();if(!r.ok)throw Error(v.error||t('sharing.saveError'));setValue(v);setScope(v.scope);setAck(false);}
    catch(e){setError(e instanceof Error?e.message:t('sharing.saveError'));}finally{setBusy(false);}
  };
  return <section aria-label={t('sharing.title')} style={{marginTop:24}}><div className="rail-label">{t('sharing.title')}</div>
    <p className="route-note">{t('sharing.intro')}</p>
    {value && <>
      <p className="route-note">{t('sharing.current',{access:value.scope === 'off' ? t('sharing.off') : value.scope === 'lan' ? t('sharing.lan') : t('sharing.public')})}</p>
      {!value.available && <p className="route-note">{value.reason} {t('sharing.staysOff')}</p>}
      {!value.eligible && <p className="route-note">{t('sharing.ineligible')}</p>}
      <label className="route-note">{t('sharing.access')}<select aria-label={t('sharing.accessLabel')} className="modal-input" value={scope} disabled={busy} onChange={e=>{setScope(e.target.value);setAck(false);}}><option value="off">{t('sharing.off')}</option><option value="lan" disabled={!value.available||!value.eligible||value.endpointScope!=='lan'}>{t('sharing.network')}</option><option value="public" disabled={!value.available||!value.eligible||value.endpointScope!=='public'}>{t('sharing.public')}</option></select></label>
      {scope!=='off' && <p className="route-note">{t('sharing.port',{port:value.port ?? ''})}</p>}
      {scope!=='off'&&value.cleartext&&<label className="route-note"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/> {t('sharing.cleartext')}</label>}
      <button style={{display:'block',marginTop:8}} className="modal-btn secondary" disabled={busy||scope!=='off'&&value.cleartext&&!ack} onClick={()=>void save()}>{busy?t('sharing.saving'):t('sharing.save')}</button>
      {value.scope!=='off'&&value.available&&<><p className="route-note">{t('sharing.credentials',{scope:value.endpointScope ?? ''})}</p><input className="modal-input" aria-label={t('sharing.urlLabel')} readOnly value={value.url} onFocus={e=>e.currentTarget.select()}/></>}
    </>}
    {error&&<p role="alert" className="route-note">{error}</p>}
  </section>;
}
