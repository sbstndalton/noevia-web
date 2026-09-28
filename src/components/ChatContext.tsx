import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ShellIcon } from './ShellIcon';
import { apiFetch, streamChat } from '../api';
import type { Message } from '../types';
type Meter = { historyCount:number; model:string; limit:number; limitSource:string; used:number; reserve:number; safety:number; threshold:number; parts:{name:string;tokens:number}[]; compactedAt:number|null; covered:number };
const fmt=(n:number)=>n>=1000?`${(n/1000).toFixed(1)}k`:String(Math.round(n));
/** `portalTo` (#527): on a phone the meter lives in the model sheet. The component stays mounted
 *  where it is, so a compaction in progress survives the sheet closing; `null` renders nothing
 *  (the sheet is closed), an element renders the meter there, and leaving it out renders it inline. */
export function ChatContext({chatId,projectId,messages,streaming,onBusy,portalTo}:{chatId:string;projectId:string|null;messages:Message[];streaming:boolean;onBusy:(busy:boolean)=>void;portalTo?:HTMLElement|null}) {
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const [meter,setMeter]=useState<Meter|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[failed,setFailed]=useState(false);
 // The server's figure only changes when a request is prepared, so it is read when the chat
 // opens and again when a reply finishes -- not every three seconds for every open chat, which
 // is what this used to do.
 //
 // #457: this used to also depend on `messages.length`, meaning "refetch when a reply finishes" --
 // but on a fresh navigation to an existing chat, `messages` starts empty and is then populated a
 // moment later once the separate history fetch resolves, so that 0-to-N transition re-ran this
 // effect a second time for the *same* chatId while still not streaming, doubling the initial
 // read. `streaming` alone already carries the intended signal: it goes true right when a send
 // starts and back to false right when a reply finishes, for every send (streamed or not), so its
 // falling edge is the one and only "a reply just finished" trigger this effect needs.
 useEffect(()=>{setMeter(null);setStatus('');setFailed(false);},[chatId]);
 useEffect(()=>{
  if(streaming)return;
  let active=true;
  void apiFetch(`/api/chats/${encodeURIComponent(chatId)}/context-window`)
   .then(async r=>{if(r.ok){const data=await r.json();if(active)setMeter(data.meter);}})
   .catch(()=>{/* keep the last observation */});
  return()=>{active=false;};
 },[chatId,streaming]);
 const compact=async()=>{controller.current=new AbortController();setBusy(true);onBusy(true);setFailed(false);setStatus('Compacting older messages…');try {
  for await(const event of streamChat({spaceId:projectId?'project':'free',chatId,projectId,message:'',compactOnly:true,history:messages.filter(m=>!m.error&&m.content).map(m=>({role:m.role,content:m.content}))},controller.current.signal)){if(event.type==='error')throw Error(event.text);if(event.type==='status')setStatus(event.text||'Compacting…');}
  const r=await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/context-window`);if(r.ok)setMeter((await r.json()).meter);setStatus('Compacted. Full transcript retained. Summaries may omit details; original messages remain available.');
 }catch(e){setFailed(true);setStatus(e instanceof Error?e.message:'Compaction failed');}finally{setBusy(false);onBusy(false);}};
 const last=messages.at(-1),live=streaming&&last?.role==='assistant'?Math.ceil((last.reasoning?.length||0)/3):0,extra=messages.filter(m=>!m.error&&m.content).slice(meter?.historyCount??messages.length).reduce((n,m)=>n+Math.ceil(new TextEncoder().encode(m.content).length/3)+12,0),used=(meter?.used||0)+live+extra,percent=meter?Math.min(100,Math.round(100*used/meter.limit)):0;
 // Shown when there is a measurement, or when the chat is long enough that compacting it is a
 // real option. A short, unmeasured chat shows nothing: "Calculated when you send" used to take
 // a whole row above the composer to say that, which on a phone is a tenth of the screen.
 const compactable=messages.length>=6;
 if(!meter && !compactable)return null;
 const meterView = <details className={`chat-context-meter${percent>=80?' is-full':''}`}><summary><span>Context window</span><span>{meter?`~${fmt(used)} / ${fmt(meter.limit)} (${percent}%)`:'Not measured yet'}<ShellIcon name="down" size={14}/></span></summary>
 {meter&&<><div className="context-stacked-bar" role="meter" aria-label="Estimated chat context used" aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={Math.min(used,meter.limit)}>{meter.parts.map((p,i)=><span key={p.name} className={`context-color-${i}`} style={{width:`${p.tokens/meter.limit*100}%`}}/>)}<span className="context-color-3" style={{width:`${(meter.reserve+meter.safety)/meter.limit*100}%`}}/></div>
 <dl>{[...meter.parts,{name:'Thinking & answer reserve',tokens:meter.reserve},{name:'Estimation safety buffer',tokens:meter.safety},{name:'Free space',tokens:Math.max(0,meter.limit-used-meter.reserve-meter.safety)}].map(p=><div key={p.name}><dt>{p.name}</dt><dd>~{fmt(p.tokens)}</dd></div>)}</dl><p>{meter.model} · {meter.limitSource}. Estimates of the prepared request, not account totals.{live>0?' Live output estimated separately.':''}</p><p>Automatic compaction above ~{Math.round(meter.threshold/meter.limit*100)}% input usage; remaining space is reserved for generation and estimation error.</p>{meter.compactedAt&&<p>{meter.covered} older messages summarized. Full transcript retained.</p>}</>}
 {!meter&&<p>Measured the next time you send. You can compact a long chat now.</p>}
 <button className="btn btn-secondary btn-sm" disabled={busy||streaming||!compactable} onClick={()=>void compact()}>{busy?'Compacting…':'Compact chat'}</button>{status&&(portalTo===undefined?<p role="status">{status}</p>:<p>{status}</p>)}</details>;
 if(portalTo===undefined)return meterView;
 // #527, phone: the meter is in the model sheet, but a compaction disables the composer, so why
 // is said beside it while it runs (and if it fails). The one live region stays here, mounted
 // whether or not the sheet is open, so each status is announced exactly once.
 return <>
  <p className={`chat-context-live${busy||failed?' is-visible':''}`} role="status" aria-live="polite">{status}</p>
  {portalTo&&createPortal(meterView,portalTo)}
 </>;
}
