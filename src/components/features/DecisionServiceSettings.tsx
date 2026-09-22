import { useEffect, useRef, useState } from 'react';
import { fetchDecisionSettings, saveDecisionSettings, testDecisionSettings } from './api';
import type { DecisionSettings } from './api';

export function DecisionServiceSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<DecisionSettings>({url:'',timeoutMs:1500});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { let live=true; fetchDecisionSettings().then(value=>{if(live){setDraft(value);setLoaded(true);}}).catch(e=>{if(live)setError(e.message);});return ()=>{live=false;}; }, []);
  const act = async (action: 'save' | 'test') => {
    setBusy(action); setError('');setStatus('');
    try {
      if(action==='save') { const value=await saveDecisionSettings(draft);setDraft(value);await onSaved();setStatus('Saved. Both experiments use this service for their next decision.'); }
      else setStatus((await testDecisionSettings(draft)).message+' Save to apply any changes.');
    } catch(e) {setError((e as Error).message);requestAnimationFrame(()=>errorRef.current?.focus());}
    finally {setBusy('');}
  };
  return <section aria-labelledby="decision-setup-title" className="decision-service-settings">
    <h2 id="decision-setup-title">Decision service setup</h2>
    <p className="preview-footnote">System-One routing and Step supervision share this service. Your answering models and OpenRouter or OpenAI-compatible providers stay in AI providers and Models &amp; routing.</p>
    {error && <p ref={errorRef} tabIndex={-1} className="route-note" role="alert">{error}</p>}
    <form className="set-rows" onSubmit={e=>{e.preventDefault();void act('save');}}>
      <div className="set-row"><div className="set-row-text"><label className="set-row-label" htmlFor="decision-url">Decision endpoint</label><p className="set-row-desc" id="decision-url-help">A private Laya-compatible decision API. This is separate from a chat-completions URL. Saving applies immediately; it does not download or load a model.</p></div>
        <div className="set-row-control"><input id="decision-url" className="modal-input" type="url" required value={draft.url} aria-describedby="decision-url-help" placeholder="http://laya:8040" disabled={!loaded||!!busy} onChange={e=>{setDraft({...draft,url:e.target.value});setStatus('');}} /></div></div>
      <div className="set-row"><div className="set-row-text"><label className="set-row-label" htmlFor="decision-deadline">Decision deadline (ms)</label><p className="set-row-desc">If the service cannot answer in time, Noevia keeps its existing behavior. Range: 100–1500 ms.</p></div>
        <div className="set-row-control"><input id="decision-deadline" className="modal-input" type="number" min={100} max={1500} required value={draft.timeoutMs} disabled={!loaded||!!busy} onChange={e=>{setDraft({...draft,timeoutMs:Number(e.target.value)});setStatus('');}} /></div></div>
      <div className="set-row"><div className="set-row-control decision-service-actions">
        <button type="button" className="modal-btn secondary" disabled={!loaded||!!busy} onClick={()=>{setDraft({...draft,url:'http://laya:8040'});setStatus('Installed Laya selected. Test the connection, then save.');}}>Use installed Laya</button>
        <button type="button" className="modal-btn secondary" disabled={!loaded||!!busy} onClick={()=>void act('test')}>{busy==='test'?'Testing…':'Test connection'}</button>
        <button type="submit" className="modal-btn primary" disabled={!loaded||!!busy}>{busy==='save'?'Saving…':'Save decision service'}</button>
      </div></div>
    </form>
    {status && <p className="preview-footnote" role="status">{status}</p>}
  </section>;
}
