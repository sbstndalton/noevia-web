import { useEffect, useState, useRef } from 'react';
import { apiFetch, streamChat } from '../api';
import type { Message } from '../types';
type Meter = { historyCount:number; model:string; limit:number; limitSource:string; used:number; reserve:number; safety:number; threshold:number; parts:{name:string;tokens:number}[]; compactedAt:number|null; covered:number };
const fmt=(n:number)=>n>=1000?`${(n/1000).toFixed(1)}k`:String(Math.round(n));
export function ChatContext({chatId,projectId,messages,streaming,onBusy}:{chatId:string;projectId:string|null;messages:Message[];streaming:boolean;onBusy:(busy:boolean)=>void}) {
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const [meter,setMeter]=useState<Meter|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 useEffect(()=>{let active=true;setMeter(null);setStatus('');const refresh=async()=>{try{const r=await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/context-window`);if(r.ok){const data=await r.json();if(active)setMeter(data.meter);}}catch{/* keep observation */}};void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{active=false;clearInterval(timer);};},[chatId]);
 const compact=async()=>{controller.current=new AbortController();setBusy(true);onBusy(true);setStatus('Compacting older messages…');try {
  for await(const event of streamChat({spaceId:projectId?'project':'free',chatId,projectId,message:'',compactOnly:true,history:messages.filter(m=>!m.error&&m.content).map(m=>({role:m.role,content:m.content}))},controller.current.signal)){if(event.type==='error')throw Error(event.text);if(event.type==='status')setStatus(event.text||'Compacting…');}
  const r=await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/context-window`);if(r.ok)setMeter((await r.json()).meter);setStatus('Compacted. Full transcript retained. Summaries may omit details; original messages remain available.');
 }catch(e){setStatus(e instanceof Error?e.message:'Compaction failed');}finally{setBusy(false);onBusy(false);}};
 const last=messages.at(-1),live=streaming&&last?.role==='assistant'?Math.ceil((last.reasoning?.length||0)/3):0,extra=messages.filter(m=>!m.error&&m.content).slice(meter?.historyCount??messages.length).reduce((n,m)=>n+Math.ceil(new TextEncoder().encode(m.content).length/3)+12,0),used=(meter?.used||0)+live+extra,percent=meter?Math.min(100,Math.round(100*used/meter.limit)):0;
 return <details className="chat-context-meter"><summary><span>Context window</span><span>{meter?`~${fmt(used)} / ${fmt(meter.limit)} (${percent}%)`:'Calculated when you send'} ▾</span></summary>
 {meter&&<><div className="context-stacked-bar" role="meter" aria-label="Estimated chat context used" aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={Math.min(used,meter.limit)}>{meter.parts.map((p,i)=><span key={p.name} className={`context-color-${i}`} style={{width:`${p.tokens/meter.limit*100}%`}}/>)}<span className="context-color-3" style={{width:`${(meter.reserve+meter.safety)/meter.limit*100}%`}}/></div>
 <dl>{[...meter.parts,{name:'Thinking & answer reserve',tokens:meter.reserve},{name:'Estimation safety buffer',tokens:meter.safety},{name:'Free space',tokens:Math.max(0,meter.limit-used-meter.reserve-meter.safety)}].map(p=><div key={p.name}><dt>{p.name}</dt><dd>~{fmt(p.tokens)}</dd></div>)}</dl><p>{meter.model} · {meter.limitSource}. Estimates of the prepared request, not account totals.{live>0?' Live output estimated separately.':''}</p><p>Automatic compaction above ~{Math.round(meter.threshold/meter.limit*100)}% input usage; remaining space is reserved for generation and estimation error.</p>{meter.compactedAt&&<p>{meter.covered} older messages summarized. Full transcript retained.</p>}</>}
 {!meter&&<p>Includes messages, instructions, sources and tools. The configured model limit is checked before each request.</p>}
 <button className="btn btn-secondary btn-sm" disabled={busy||streaming||messages.length<6} onClick={()=>void compact()}>{busy?'Compacting…':'Compact chat'}</button>{status&&<p role="status">{status}</p>}</details>;
}
