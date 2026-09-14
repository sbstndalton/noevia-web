import { useEffect, useState } from 'react';
import type { InstalledModel } from '../types';
import { apiFetch, fetchInstalledModels } from '../api';
import { matchesModelUse, memoryAssessment } from '../model-guidance';
import type { MemoryPlan, ModelUse } from '../model-guidance';

type Hardware = {source:string;cpu:string;systemGB:number|null;gpus:{id:string;name:string;capacityGB:number|null;sharedGB:number|null}[]};
export function MemoryPlanner({plan,onChange}:{plan:MemoryPlan;onChange:(plan:MemoryPlan)=>void}) {
  const [hardwareSupported,setHardwareSupported]=useState<boolean|null>(null);
  useEffect(()=>{void apiFetch('/api/models/capabilities').then(r=>r.json()).then(v=>{if(typeof v.hardware==='boolean')setHardwareSupported(v.hardware);}).catch(()=>{});},[]);
  const [hardware,setHardware]=useState<Hardware|null>(null),[reading,setReading]=useState(false),[error,setError]=useState('');
  const readHardware=async()=>{
    setReading(true);setError('');
    try {
      const response=await apiFetch('/api/models/hardware');
      if(!response.ok)throw Error('Inference hardware is unavailable. Enter values manually or retry.');
      const value=await response.json();
      if(!value || value.source!=='model-manager' || typeof value.cpu!=='string' || (value.systemGB!==null && (typeof value.systemGB!=='number' || !Number.isFinite(value.systemGB))) || !Array.isArray(value.gpus) || value.gpus.some((g:Hardware['gpus'][number])=>!g || typeof g.id!=='string' || typeof g.name!=='string' || (g.capacityGB!==null && (typeof g.capacityGB!=='number' || !Number.isFinite(g.capacityGB))) || (g.sharedGB!==null && (typeof g.sharedGB!=='number' || !Number.isFinite(g.sharedGB)))))throw Error('Hardware response was invalid.');
      setHardware(value);
    }catch(e){setError(e instanceof Error?e.message:'Could not read hardware');}
    finally{setReading(false);}
  };
  return <fieldset className="model-memory-planner"><legend>Inference machine memory</legend>
    <p>Use the machine running your models. Values are kept only while this model window is open.</p>
    <button className="popup-tab" disabled={reading || hardwareSupported===false} onClick={()=>void readHardware()}>{reading?'Reading inference hardware…':'Read inference hardware'}</button>
    {hardwareSupported===false && <p>This backend does not report host memory. Enter the inference machine’s capacity and reserve manually.</p>}
    {error && <p role="alert">{error}</p>}
    {hardware && <div className="model-hardware-report"><p>{hardware.cpu || 'Inference server'}{hardware.systemGB!=null?` · ${hardware.systemGB} GB system memory reported`:''}</p>
      {hardware.systemGB!=null && <button className="popup-tab" onClick={()=>onChange({...plan,kind:'cpu',capacityGB:String(hardware.systemGB)})}>Use reported system capacity</button>}
      {hardware.gpus.map(gpu=><div key={gpu.id}><p>{gpu.name} · {gpu.capacityGB!=null?`${gpu.capacityGB} GB GPU memory reported`:'GPU capacity unavailable'}{gpu.sharedGB!=null?` · ${gpu.sharedGB} GB shared memory reported separately`:''}</p>{gpu.capacityGB!=null && <button className="popup-tab" onClick={()=>onChange({...plan,kind:'gpu',capacityGB:String(gpu.capacityGB)})}>Use {gpu.name} capacity</button>}</div>)}
      <p>Reported totals are not free memory. Shared GPU memory overlaps system RAM; choose one pool and reserve room for current workloads. Reading hardware does not change your plan until you choose a capacity.</p>
    </div>}
    <div className="model-memory-fields"><label>Memory pool<select value={plan.kind} onChange={e=>onChange({...plan,kind:e.target.value as MemoryPlan['kind']})}><option value="gpu">Single GPU VRAM</option><option value="unified">Unified memory</option><option value="cpu">CPU system RAM</option></select></label>
    <label>Capacity (GB)<input type="number" min="1" max="4096" step="0.5" placeholder="Enter capacity" value={plan.capacityGB} onChange={e=>onChange({...plan,capacityGB:e.target.value})}/></label>
    <label>Reserve (GB)<input type="number" min="0" max="4096" step="0.5" value={plan.reserveGB} onChange={e=>onChange({...plan,reserveGB:e.target.value})}/></label></div>
    <p>Reserve covers other applications, runtime buffers, context cache and any vision projector. The initial 4 GB is a planning placeholder; adjust for your workload. Unified memory is counted once. GPU memory is not added to system RAM.</p>
  </fieldset>;
}
export function ModelMemoryEstimate({sizeGB,plan}:{sizeGB:number|null|undefined;plan:MemoryPlan}) {
  const result=memoryAssessment(sizeGB,plan);
  return <p className="model-fit" data-fit={result.state}><strong>{result.label}</strong><span>{result.detail}</span></p>;
}
export function ModelGuidance({plan,onChange}:{plan:MemoryPlan;onChange:(plan:MemoryPlan)=>void}) {
  const [models,setModels]=useState<InstalledModel[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [use,setUse]=useState<ModelUse>('all');
  useEffect(()=>{
    let stale=false;setLoading(true);setError('');
    void fetchInstalledModels().then(rows=>{
      if(!Array.isArray(rows) || rows.some(row=>!row || typeof row.name!=='string' || !Array.isArray(row.labels) || row.labels.some(label=>typeof label!=='string')))throw Error('Model list was invalid.');
      if(!stale)setModels(rows);
    }).catch(e=>{if(!stale)setError(e instanceof Error?e.message:'Could not load models');}).finally(()=>{if(!stale)setLoading(false);});
    return()=>{stale=true;};
  },[retry]);
  const order={room:0,tight:1,unknown:2,over:3};
  const rows=models.filter(model=>matchesModelUse(model.labels,use)).sort((a,b)=>order[memoryAssessment(a.sizeGB,plan).state]-order[memoryAssessment(b.sizeGB,plan).state] || Number(b.loaded)-Number(a.loaded) || a.name.localeCompare(b.name));
  return <section className="model-guidance" aria-label="Model guidance"><h2>Find a model to try</h2><p>Review available models by reported capabilities and a memory budget. These are candidates for testing, not quality rankings or measured speed predictions.</p>
    <MemoryPlanner plan={plan} onChange={onChange}/>
    <label className="model-guidance-filter">Required capability<select value={use} onChange={e=>setUse(e.target.value as ModelUse)}><option value="all">General use</option><option value="vision">Vision</option><option value="reasoning">Reasoning</option><option value="tools">Tool use</option></select></label>
    <p>Capabilities come from model-manager labels. Missing labels mean unverified support. Test a synthetic prompt before relying on tool use or vision; hardware fit alone does not establish either.</p>
    {loading ? <p role="status">Loading available models…</p> : error ? <div role="alert"><p>{error}</p><button className="popup-tab" onClick={()=>setRetry(n=>n+1)}>Retry models</button></div> : !rows.length ? <p role="status">No available models report this capability. Use Download to search for another model.</p> : <div className="model-guidance-results" aria-live="polite">{rows.map(model=><article key={model.name}><h3>{model.name}</h3><p>{model.loaded?'Currently loaded':'Available in the model manager'}{model.sizeGB!=null?` · ${model.sizeGB} GB reported size`:''}</p><ModelMemoryEstimate sizeGB={model.sizeGB} plan={plan}/>{model.maxContext!=null && <p>Reported context ceiling: {model.maxContext.toLocaleString()} tokens. The usable context depends on load settings and memory.</p>}</article>)}</div>}
    <p>Choose explicitly in Switch model or Manage. Guidance never downloads, loads, benchmarks or changes routing. More model ideas: <a href="https://canirun.ai" target="_blank" rel="noopener noreferrer">CanIRun.ai</a> (its detection describes the device opening that site).</p>
  </section>;
}
