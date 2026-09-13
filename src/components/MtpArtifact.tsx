import { useState } from 'react';
import { apiFetch } from '../api';
type Evidence = {status:'present'|'absent'|'unknown';reason:string;revision?:string;files:string[]};
export function MtpArtifact({repo,variant}:{repo:string;variant:string}) {
  const [result,setResult]=useState<Evidence|null>(null),[busy,setBusy]=useState(false);
  const check=async()=>{if(busy)return;setBusy(true);try{
    const r=await apiFetch(`/api/models/mtp-artifact?repo=${encodeURIComponent(repo)}&variant=${encodeURIComponent(variant)}`);
    const v=await r.json();if(!r.ok)throw Error(v.error||'Check unavailable');setResult(v);
  }catch(e){setResult({status:'unknown',reason:e instanceof Error?e.message:'Check unavailable',files:[]});}finally{setBusy(false);}};
  return <div className="mtp-artifact">
    <span>MTP head: {busy?'checking selected files…':result?.status==='present'?'tensors found':result?.status==='absent'?'no recognized tensors':'unverified'}</span>
    <button className="popup-tab" aria-disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Check MTP head'}</button>
    {result && <small role="status">{result.reason}{result.revision && ` HF revision ${result.revision.slice(0,12)}. Downloading later may use a newer revision.`}</small>}
    {result?.files.length ? <small>{result.files.join(', ')}</small>:null}
  </div>;
}
