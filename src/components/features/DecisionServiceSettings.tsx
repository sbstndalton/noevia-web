import { useEffect, useRef, useState } from 'react';
import { fetchDecisionSettings, saveDecisionSettings, testDecisionSettings } from './api';
import type { DecisionSettings } from './api';
import { useT } from '../../i18n';

export function DecisionServiceSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const t = useT();
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
      if(action==='save') { const value=await saveDecisionSettings(draft);setDraft(value);await onSaved();setStatus(t('decision.saved')); }
      // The server's message is English; the follow-up sentence is the interface's.
      else setStatus(`${(await testDecisionSettings(draft)).message} ${t('decision.saveToApply')}`);
    } catch(e) {setError((e as Error).message);requestAnimationFrame(()=>errorRef.current?.focus());}
    finally {setBusy('');}
  };
  return <section aria-labelledby="decision-setup-title" className="decision-service-settings">
    <h2 id="decision-setup-title">{t('decision.title')}</h2>
    <p className="preview-footnote">{t('decision.intro')}</p>
    {error && <p ref={errorRef} tabIndex={-1} className="route-note" role="alert">{error}</p>}
    <form className="set-rows" onSubmit={e=>{e.preventDefault();void act('save');}}>
      <div className="set-row"><div className="set-row-text"><label className="set-row-label" htmlFor="decision-url">{t('decision.endpointLabel')}</label><p className="set-row-desc" id="decision-url-help">{t('decision.endpointHelp')}</p></div>
        <div className="set-row-control"><input id="decision-url" className="modal-input" type="url" required value={draft.url} aria-describedby="decision-url-help" placeholder="http://laya:8040" disabled={!loaded||!!busy} onChange={e=>{setDraft({...draft,url:e.target.value});setStatus('');}} /></div></div>
      <div className="set-row"><div className="set-row-text"><label className="set-row-label" htmlFor="decision-deadline">{t('decision.deadlineLabel')}</label><p className="set-row-desc">{t('decision.deadlineHelp')}</p></div>
        <div className="set-row-control"><input id="decision-deadline" className="modal-input" type="number" min={100} max={1500} required value={draft.timeoutMs} disabled={!loaded||!!busy} onChange={e=>{setDraft({...draft,timeoutMs:Number(e.target.value)});setStatus('');}} /></div></div>
      <div className="set-row"><div className="set-row-control decision-service-actions">
        <button type="button" className="modal-btn secondary" disabled={!loaded||!!busy} onClick={()=>{setDraft({...draft,url:'http://laya:8040'});setStatus(t('decision.layaSelected'));}}>{t('decision.useLaya')}</button>
        <button type="button" className="modal-btn secondary" disabled={!loaded||!!busy} onClick={()=>void act('test')}>{busy==='test'?t('decision.testing'):t('decision.test')}</button>
        <button type="submit" className="modal-btn primary" disabled={!loaded||!!busy}>{busy==='save'?t('common.saving'):t('decision.saveButton')}</button>
      </div></div>
    </form>
    {status && <p className="preview-footnote" role="status">{status}</p>}
  </section>;
}
