import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ShellIcon } from './ShellIcon';
import { apiFetch, streamChat } from '../api';
import type { Message } from '../types';
import { formatCompact, formatNumber, formatPercent } from '../number-format';
import { appLocale } from '../user-preferences';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
type Meter = { historyCount:number; model:string; limit:number; limitSource:string; used:number; reserve:number; safety:number; threshold:number; parts:{name:string;tokens:number}[]; compactedAt:number|null; covered:number };
const CTX_LABELS:Record<string,MessageKey>={
 'Messages & summary':'chat.ctx.partMessages','Instructions, memory & sources':'chat.ctx.partInstructions','Tools':'chat.ctx.partTools',
 'Thinking & answer reserve':'chat.ctx.partReserve','Estimation safety buffer':'chat.ctx.partSafety','Free space':'chat.ctx.partFree',
 'Configured backend context':'chat.ctx.srcConfigured','Conservative fallback; backend limit unavailable':'chat.ctx.srcFallback',
 'Provider setting':'chat.ctx.srcProvider','Default for hosted providers':'chat.ctx.srcHosted',
};
const fmt=(n:number)=>formatCompact(Math.round(n),appLocale());
/** `portalTo` (#527): on a phone the meter lives in the model sheet. The component stays mounted
 *  where it is, so a compaction in progress survives the sheet closing; `null` renders nothing
 *  (the sheet is closed), an element renders the meter there, and leaving it out renders it inline. */
export function ChatContext({chatId,projectId,messages,streaming,onBusy,portalTo}:{chatId:string;projectId:string|null;messages:Message[];streaming:boolean;onBusy:(busy:boolean)=>void;portalTo?:HTMLElement|null}) {
 const t=useT();
 // The server names the parts of the meter (and where the limit came from) in English, and a
 // chat's saved meter keeps whatever it was written with, so the words are looked up here (#608).
 const label=(name:string)=>CTX_LABELS[name]?t(CTX_LABELS[name]):name;
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
 const compact=async()=>{controller.current=new AbortController();setBusy(true);onBusy(true);setFailed(false);setStatus(t('chat.ctx.statusCompacting'));try {
  for await(const event of streamChat({spaceId:projectId?'project':'free',chatId,projectId,message:'',compactOnly:true,history:messages.filter(m=>!m.error&&m.content).map(m=>({role:m.role,content:m.content}))},controller.current.signal)){if(event.type==='error')throw Error(event.text);if(event.type==='status')setStatus(event.text||t('chat.ctx.compacting'));}
  const r=await apiFetch(`/api/chats/${encodeURIComponent(chatId)}/context-window`);if(r.ok)setMeter((await r.json()).meter);setStatus(t('chat.ctx.statusDone'));
 }catch(e){setFailed(true);setStatus(e instanceof Error?e.message:t('chat.ctx.statusFailed'));}finally{setBusy(false);onBusy(false);}};
 const last=messages.at(-1),live=streaming&&last?.role==='assistant'?Math.ceil((last.reasoning?.length||0)/3):0,extra=messages.filter(m=>!m.error&&m.content).slice(meter?.historyCount??messages.length).reduce((n,m)=>n+Math.ceil(new TextEncoder().encode(m.content).length/3)+12,0),used=(meter?.used||0)+live+extra,percent=meter?Math.min(100,Math.round(100*used/meter.limit)):0;
 // Shown when there is a measurement, or when the chat is long enough that compacting it is a
 // real option. A short, unmeasured chat shows nothing: "Calculated when you send" used to take
 // a whole row above the composer to say that, which on a phone is a tenth of the screen.
 const compactable=messages.length>=6;
 if(!meter && !compactable)return null;
 const meterView = <details className={`chat-context-meter${percent>=80?' is-full':''}`}><summary><span>{t('chat.ctx.title')}</span><span>{meter?`~${fmt(used)} / ${fmt(meter.limit)} (${formatPercent(percent,appLocale(),0)})`:t('chat.ctx.notMeasured')}<ShellIcon name="down" size={14}/></span></summary>
 {meter&&<><div className="context-stacked-bar" role="meter" aria-label={t('chat.ctx.meterAria')} aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={Math.min(used,meter.limit)}>{meter.parts.map((p,i)=><span key={p.name} className={`context-color-${i}`} style={{width:`${p.tokens/meter.limit*100}%`}}/>)}<span className="context-color-3" style={{width:`${(meter.reserve+meter.safety)/meter.limit*100}%`}}/></div>
 <dl>{[...meter.parts,{name:'Thinking & answer reserve',tokens:meter.reserve},{name:'Estimation safety buffer',tokens:meter.safety},{name:'Free space',tokens:Math.max(0,meter.limit-used-meter.reserve-meter.safety)}].map(p=><div key={p.name}><dt>{label(p.name)}</dt><dd>~{fmt(p.tokens)}</dd></div>)}</dl><p>{meter.model} · {label(meter.limitSource)}. {t('chat.ctx.estimates')}{live>0?` ${t('chat.ctx.liveNote')}`:''}</p><p>{t('chat.ctx.compaction',{percent:formatPercent(Math.round(meter.threshold/meter.limit*100),appLocale(),0)})}</p>{meter.compactedAt&&<p>{t.plural('chat.ctx.summarised',meter.covered,{count:formatNumber(meter.covered,appLocale(),0)})}</p>}</>}
 {!meter&&<p>{t('chat.ctx.notMeasuredHint')}</p>}
 <button className="btn btn-secondary btn-sm" disabled={busy||streaming||!compactable} onClick={()=>void compact()}>{busy?t('chat.ctx.compacting'):t('chat.ctx.compact')}</button>{status&&(portalTo===undefined?<p role="status">{status}</p>:<p>{status}</p>)}</details>;
 if(portalTo===undefined)return meterView;
 // #527, phone: the meter is in the model sheet, but a compaction disables the composer, so why
 // is said beside it while it runs (and if it fails). The one live region stays here, mounted
 // whether or not the sheet is open, so each status is announced exactly once.
 return <>
  <p className={`chat-context-live${busy||failed?' is-visible':''}`} role="status" aria-live="polite">{status}</p>
  {portalTo&&createPortal(meterView,portalTo)}
 </>;
}
