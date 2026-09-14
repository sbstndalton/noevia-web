import { useState } from 'react';
import { apiFetch } from '../api';
import { NativeCalibration } from './NativeCalibration';
type Profile = {model:string;revision:string;options:Record<string,string>;defaults:Record<string,string>;fields:string[]};
type Suggestion = {values?:Record<string,string>;rows?:{ctx:number;totalGib:number;fits:boolean}[];budgetGib?:number;estimateGib?:number;notes?:string[];error?:string;source?:string};
const labels: Record<string,string> = {'ctx-size':'Total context allocation (tokens)',parallel:'Parallel slots','n-gpu-layers':'GPU layers','cache-type-k':'Key cache type','cache-type-v':'Value cache type','flash-attn':'Flash attention','batch-size':'Batch size','ubatch-size':'Micro batch size','cache-ram':'Prompt cache RAM (MiB)','image-max-tokens':'Maximum image tokens','spec-type':'Speculative decoding'};
const choices: Record<string,string[]> = {'cache-type-k':['f32','f16','bf16','q8_0','q4_0','q4_1','iq4_nl','q5_0','q5_1'],'cache-type-v':['f32','f16','bf16','q8_0','q4_0','q4_1','iq4_nl','q5_0','q5_1'],'flash-attn':['on','off','auto'],'spec-type':['none','draft-mtp']};
export function NativeModelProfile({model,enabled,onChanged,focusCalibration=false}:{model:string;enabled:boolean;onChanged:()=>void;focusCalibration?:boolean}) {
  const [profile,setProfile]=useState<Profile|null>(null),[draft,setDraft]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [suggestion,setSuggestion]=useState<Suggestion|null>(null);
  const load=async(keepDraft=false)=>{
    setBusy(true);setError('');
    try {const r=await apiFetch('/api/models/preset?model='+encodeURIComponent(model)),v=await r.json();if(!r.ok)throw Error(v.error||'Profile unavailable');setProfile(v);if(!keepDraft)setDraft(v.options);setMessage(keepDraft?'Latest revision loaded. Review your retained draft against the current values before applying.':'');}
    catch(e){setError(e instanceof Error?e.message:'Profile unavailable');}finally{setBusy(false);}
  };
  const apply=async()=>{
    if(!profile)return;setBusy(true);setError('');setMessage('');
    try {const r=await apiFetch('/api/models/preset',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,baseRevision:profile.revision,options:Object.fromEntries(profile.fields.map(key=>[key,draft[key]||''])),confirmReload:confirmed})}),v=await r.json();if(!r.ok)throw Error(v.error||'Profile could not be applied');setProfile(v);setDraft(v.options);setConfirmed(false);setMessage('Profile applied. Model remains unloaded. Load and test it before relying on this allocation.');onChanged();}
    catch(e){setError(e instanceof Error?e.message:'Profile could not be applied');}finally{setBusy(false);}
  };
  const suggest=async()=>{
    if(!profile)return;setBusy(true);setError('');setMessage('');
    try {
      const r=await apiFetch('/api/models/preset/suggest?model='+encodeURIComponent(model)),v:Suggestion=await r.json();
      if(!r.ok&&!v.rows)throw Error(v.error||'Suggestion unavailable');
      setSuggestion(v);
      if(v.values){const next={...draft};for(const [key,value] of Object.entries(v.values))if(profile.fields.includes(key))next[key]=value;setDraft(next);setMessage('Suggested values filled in below. Review them, then apply to save.');}
    } catch(e){setError(e instanceof Error?e.message:'Suggestion unavailable');}finally{setBusy(false);}
  };
  const fmt=(n:number)=>n>=1024?`${Math.round(n/1024)}k`:String(n);
  return <details className="native-model-profile" open={focusCalibration||undefined}><summary>Settings and calibration</summary>
    {!enabled ? <p>An administrator must configure shared preset storage to edit this profile.</p> : <>
      <NativeCalibration model={model} onChanged={()=>{onChanged();if(profile)void load();}} autoFocus={focusCalibration}/>
      <h4 className="native-profile-heading">Edit settings</h4>
      <p>These settings affect every user of this model. Router command-line settings take precedence.</p>
      {!profile && <button className="popup-tab" disabled={busy} onClick={()=>void load()}>{busy?'Reading…':'Read profile'}</button>}
      {profile && <>
        <div className="native-profile-suggest">
          <button className="popup-tab" disabled={busy} onClick={()=>void suggest()}>{busy?'Working…':'Suggest settings from model file'}</button>
          {suggestion && <>
            {suggestion.error && <p role="alert">{suggestion.error}</p>}
            {suggestion.estimateGib!==undefined && <p>Estimated memory at the suggested context: <strong>{suggestion.estimateGib} GiB</strong> of a {suggestion.budgetGib} GiB budget.</p>}
            {suggestion.notes && <ul>{suggestion.notes.map(note=><li key={note}>{note}</li>)}</ul>}
            {suggestion.rows && <div className="native-profile-estimates" role="region" aria-label="Memory estimate by context"><table><thead><tr><th scope="col">Context</th><th scope="col">Estimate</th><th scope="col">Fits</th></tr></thead>
              <tbody>{suggestion.rows.filter((row,i,all)=>row.ctx%32768===0||row.ctx===all.at(-1)?.ctx||i===0).map(row=><tr key={row.ctx}><td>{fmt(row.ctx)}</td><td>{row.totalGib} GiB</td><td>{row.fits?'Yes':'No'}</td></tr>)}</tbody></table></div>}
            {suggestion.source && <small>{suggestion.source}</small>}
          </>}
        </div>
        <div className="native-profile-fields">{profile.fields.map(key=><label key={key}>{labels[key]||key}
          {choices[key] ? <select disabled={busy} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})}><option value="">Inherit / default</option>{choices[key].map(value=><option key={value}>{value}</option>)}</select> : <input disabled={busy} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})} placeholder="Inherit / default"/>}
          <small>Current: {profile.options[key]||'inherit'} · Global: {profile.defaults[key]||'backend default'}</small>
        </label>)}</div>
        <p>Blank fields inherit defaults. MTP requires an actual draft head and compatible runtime; choosing it does not establish support. Larger context and more slots can exhaust shared memory.</p>
        <label className="native-profile-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I have stopped other clients and Diary background inference, and unloaded all router models. Reloading may interrupt requests.</label>
        <div className="native-profile-actions"><button className="popup-tab" disabled={busy||!confirmed} onClick={()=>void apply()}>{busy?'Applying…':'Apply profile and reload presets'}</button><button className="popup-tab" disabled={busy} onClick={()=>void load(true)}>Read latest; retain draft</button></div>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </details>;
}
