import { useEffect, useRef, useState } from 'react';
import { fetchDecisionChoices, fetchDecisionSettings, resetDecisionSettings, saveDecisionSettings, testDecisionSettings } from './api';
import type { DecisionSettings } from './api';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

export function DecisionServiceSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState<DecisionSettings>({url:'',timeoutMs:1500});
  const [loaded, setLoaded] = useState(false);
  // #1765: where the active address comes from: 'admin' (saved here) or 'deployment'. Only the saved one can be reset.
  const [source, setSource] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // #1666: the model saved now ('' = automatic), so a pending change can be told apart from the saved one.
  const [savedModel, setSavedModel] = useState('');
  // The choosable decision models and the deployment's own come with the administrator's Decision row (#1666).
  const [choices, setChoices] = useState<{ models: string[]; deploymentModel?: string }>({ models: [] });
  // A model's own name is not translated (Kev-0.8B); only the built-in model is described in words (#1499).
  const modelName = (id: string) => id === 'laya' ? t('decision.modelLaya') : id === 'kev-0.8b' ? 'Kev-0.8B' : id;
  const serverText = (id: string | undefined, english: string) => { if (!id) return english; const key = `decision.msg.${id}` as MessageKey; const text = t(key); return text === key ? english : text; };
  useEffect(() => { let live=true; fetchDecisionChoices().then(c=>{if(live)setChoices(c);}).catch(()=>undefined);return ()=>{live=false;}; }, []);
  useEffect(() => { let live=true; fetchDecisionSettings().then(value=>{if(live){setDraft(value);setSource(value.source);setSavedModel(value.model||'');setLoaded(true);}}).catch(e=>{if(live)setError(e.message);});return ()=>{live=false;}; }, []);
  const act = async (action: 'save' | 'test' | 'reset') => {
    setBusy(action); setError('');setStatus('');
    try {
      if(action==='save') { const value=await saveDecisionSettings(draft);setDraft(value);setSource(value.source);setSavedModel(value.model||'');await onSaved();setStatus(t('decision.saved')); }
      else if(action==='reset') { const value=await resetDecisionSettings();setDraft(value);setSource(value.source);setSavedModel(value.model||'');await onSaved();setStatus(t('decision.resetDone'));
        // The button just pressed is gone (nothing saved to reset any more): focus the section heading; the
        // status line below announces the result once (focusing that live region as it mounts could read it twice).
        requestAnimationFrame(()=>headingRef.current?.focus()); }
      // The server's message is English with a stable id (#624); the id is worded from the catalogue.
      else { const result = await testDecisionSettings(draft); setStatus(`${serverText(result.messageId, result.message)} ${t('decision.saveToApply')}`); }
    } catch(e) {setError(serverText((e as { id?: string }).id, (e as Error).message));requestAnimationFrame(()=>errorRef.current?.focus());}
    finally {setBusy('');}
  };
  return <section aria-labelledby="decision-setup-title" className="decision-service-settings">
    <h2 id="decision-setup-title" ref={headingRef} tabIndex={-1}>{t('decision.title')}</h2>
    <p className="preview-footnote">{t('decision.intro')}</p>
    {loaded && source && <p className="preview-footnote" data-testid="decision-source">{t(source==='admin'?'decision.sourceAdmin':'decision.sourceDeployment')}</p>}
    {error && <p ref={errorRef} tabIndex={-1} className="route-note" role="alert">{error}</p>}
    <form className="set-rows" onSubmit={e=>{e.preventDefault();void act('save');}}>
      <div className="set-row"><div className="set-row-text"><label className="set-row-label" htmlFor="decision-url">{t('decision.endpointLabel')}</label><p className="set-row-desc" id="decision-url-help">{t('decision.endpointHelp')}</p></div>
        <div className="set-row-control"><input id="decision-url" className="modal-input" type="url" required value={draft.url} aria-describedby="decision-url-help" placeholder="http://192.168.1.20:8040" disabled={!loaded||!!busy} onChange={e=>{setDraft({...draft,url:e.target.value});setStatus('');}} /></div></div>
      {/* #1666: the model behind the address decides how every decision is asked (decision-models.cjs). Automatic is the
          deployment's choice; a change is deliberate: it applies only when the administrator saves (the #1639 soak). */}
      <div className="set-row"><div className="set-row-text"><label className="set-row-label" htmlFor="decision-model">{t('decision.modelLabel')}</label><p className="set-row-desc" id="decision-model-help">{t('decision.modelHelp')}</p></div>
        <div className="set-row-control"><select id="decision-model" className="modal-input" value={draft.model || ''} aria-describedby="decision-model-help" disabled={!loaded||!!busy} onChange={e=>{setDraft({...draft,model:e.target.value});setStatus(e.target.value!==(savedModel||'')?t('decision.modelChanged'):'');}}>
          <option value="">{choices.deploymentModel ? t('decision.modelAutoNamed', { model: modelName(choices.deploymentModel) }) : t('decision.modelAuto')}</option>
          {choices.models.map(id=><option key={id} value={id}>{modelName(id)}</option>)}
          {draft.model && !choices.models.includes(draft.model) && <option value={draft.model}>{modelName(draft.model)}</option>}
        </select></div></div>
      <div className="set-row"><div className="set-row-text"><label className="set-row-label" htmlFor="decision-deadline">{t('decision.deadlineLabel')}</label><p className="set-row-desc">{t('decision.deadlineHelp')}</p></div>
        <div className="set-row-control"><input id="decision-deadline" className="modal-input" type="number" min={100} max={2000} required value={draft.timeoutMs} disabled={!loaded||!!busy} onChange={e=>{setDraft({...draft,timeoutMs:Number(e.target.value)});setStatus('');}} /></div></div>
      <div className="set-row"><div className="set-row-control decision-service-actions">
        <button type="button" className="modal-btn secondary" disabled={!loaded||!!busy} onClick={()=>{setDraft({...draft,url:'http://laya:8040'});setStatus(t('decision.layaSelected'));}}>{t('decision.useLaya')}</button>
        <button type="button" className="modal-btn secondary" disabled={!loaded||!!busy} onClick={()=>void act('test')}>{busy==='test'?t('decision.testing'):t('decision.test')}</button>
        {source==='admin' && <button type="button" className="modal-btn secondary" disabled={!loaded||!!busy} onClick={()=>void act('reset')}>{busy==='reset'?t('decision.resetting'):t('decision.useDeployment')}</button>}
        <button type="submit" className="modal-btn primary" disabled={!loaded||!!busy}>{busy==='save'?t('common.saving'):t('decision.saveButton')}</button>
      </div></div>
    </form>
    {status && <p className="preview-footnote" role="status">{status}</p>}
  </section>;
}
