// #1662: the first section of Settings → Models — what each service and chat role uses, with its
// state, changed in place where the server has a way to change it. Administrators get the
// controls; members see the same rows read-only.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { InstalledModel } from '../../types';
import { fetchAutoRoles, setAutoRoles } from '../../api';
import type { AutoRoles } from '../../api';
import { isChatGenerationModel } from '../../model-kind';
import { matchesModelUse } from '../../model-guidance';
import { notifyModelsChanged, useModelsChanged } from '../../models-changed';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { embeddingOptions, fetchAssignments, finishEmbeddingSwitch, switchEmbedding } from './assignments';
import type { Assignments, ServiceAssignment, ServiceId } from './assignments';
import { errorText } from './mm';

const SERVICE: Record<ServiceId, MessageKey> = { embedding: 'mm.assign.svc.embedding', reranker: 'mm.assign.svc.reranker', decision: 'mm.assign.svc.decision', ocr: 'mm.assign.svc.ocr', documents: 'mm.assign.svc.documents' };
const ROLES = ['fast', 'smart', 'code', 'vision'] as const;
type Role = (typeof ROLES)[number];
const ROLE: Record<Role, MessageKey> = { fast: 'mm.assign.role.fast', smart: 'mm.assign.role.smart', code: 'mm.assign.role.code', vision: 'mm.assign.role.vision' };
type Tone = 'good' | 'warn' | 'bad' | 'muted';
const STATE: Record<string, [MessageKey, Tone]> = {
  active: ['mm.assign.state.active', 'good'], switching: ['mm.assign.state.switching', 'warn'], missing: ['mm.assign.state.missing', 'bad'], notInstalled: ['mm.assign.state.notInstalled', 'bad'], off: ['mm.assign.state.off', 'muted'],
  loaded: ['mm.loaded', 'good'], unloaded: ['mm.card.unloaded', 'muted'], unset: ['mm.assign.state.unset', 'muted'],
};

export function StatePill({ state }: { state: string }): JSX.Element {
  const t = useT();
  const [key, tone] = STATE[state] || STATE.off;
  return <span className="mm-state" data-tone={tone}>{t(key)}</span>;
}

export function ServiceAssignments({ models }: { models: InstalledModel[] }): JSX.Element | null {
  const t = useT();
  const [info, setInfo] = useState<Assignments | null>(null);
  const [roles, setRoles] = useState<AutoRoles | null>(null);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState('');
  const [embedPick, setEmbedPick] = useState('');
  const live = useRef(true), request = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const load = useCallback(() => {
    const id = ++request.current;   // only the newest load may update the rows
    fetchAssignments().then((v) => { if (live.current && id === request.current) { setInfo(v); setError(''); } }).catch(() => { if (live.current && id === request.current) setError(t('mm.assign.loadError')); });
    fetchAutoRoles().then((v) => { if (live.current) setRoles(v.roles); }).catch(() => undefined);
  }, [t]);
  useEffect(() => { load(); }, [load]);
  useModelsChanged(load);

  const admin = info?.admin === true;
  const chat = models.filter((m) => !m.missingFile && isChatGenerationModel(m.name, m.labels));
  const byName = new Map(models.map((m) => [m.name, m]));
  const modelState = (name: string | null | undefined) => !name ? 'unset' : !byName.has(name) || byName.get(name)!.missingFile ? 'missing' : byName.get(name)!.loaded ? 'loaded' : 'unloaded';

  const saveRole = async (role: Role, model: string) => {
    if (!roles) return;
    const next: AutoRoles = { ...roles, [role]: model };
    if (!next.fast || !next.smart) { setError(t('mm.route.needBoth')); return; }
    setBusy(role); setError(''); setStatus('');
    try {
      await setAutoRoles({ fast: next.fast, smart: next.smart, vision: next.vision || '', code: next.code || '' });
      setRoles(next); setStatus(t('mm.assign.saved')); notifyModelsChanged();
    } catch (e) { setError(errorText(e, t('mm.saveError'))); } finally { setBusy(''); }
  };
  const runEmbedding = async (svc: ServiceAssignment, finish: boolean) => {
    const target = embeddingOptions(svc).find((o) => o.model === embedPick);
    if (!finish && !target) return;
    setBusy('embedding'); setError(''); setStatus('');
    try {
      const outcome = finish || svc.next === target!.model ? await finishEmbeddingSwitch() : await switchEmbedding(target!, svc.baseUrl);
      setStatus(outcome === 'done' ? t('mm.assign.saved') : t('mm.assign.reindexing', { model: finish ? svc.next || '' : target!.model }));
      setEmbedPick(''); notifyModelsChanged(); load();
    } catch (e) { setError(errorText(e, t('mm.saveError'))); } finally { setBusy(''); }
  };

  const serviceRow = (svc: ServiceAssignment) => {
    const options = svc.id === 'embedding' ? embeddingOptions(svc).filter((o) => o.model !== svc.model) : [];
    const name = svc.model || ((svc.id === 'ocr' || svc.id === 'documents') && svc.state === 'active' ? t('mm.assign.builtIn') : t('mm.assign.none'));
    return <li key={svc.id} className="mm-assign-row" data-service={svc.id}>
      <span className="mm-assign-label">{t(SERVICE[svc.id])}</span>
      <span className="mm-assign-model" title={svc.model || undefined}>{name}{svc.next ? <small> → {svc.next}</small> : null}</span>
      <StatePill state={svc.state === 'missing' && !svc.model ? 'notInstalled' : svc.state}/>
      <span className="mm-assign-control">
        {svc.id === 'embedding' && admin && svc.canChange && (svc.next
          ? <button className="popup-tab" disabled={busy !== ''} onClick={() => void runEmbedding(svc, true)}>{busy === 'embedding' ? t('mm.assign.switching') : t('mm.assign.finish')}</button>
          : options.length > 0
            ? <><label className="mm-select"><span className="sr-only">{t('mm.assign.switchEmbedding')}</span>
                <select aria-label={t('mm.assign.switchEmbedding')} value={embedPick} disabled={busy !== ''} onChange={(e) => setEmbedPick(e.target.value)}>
                  <option value="">{t('mm.assign.switchEmbedding')}</option>
                  {options.map((o) => <option key={o.model} value={o.model}>{o.model}</option>)}
                </select></label>
              {embedPick && <button className="popup-tab" disabled={busy !== ''} onClick={() => void runEmbedding(svc, false)}>{busy === 'embedding' ? t('mm.assign.switching') : t('mm.assign.switch')}</button>}</>
            : <span className="mm-assign-fixed">{t('mm.assign.noEmbeddingOptions')}</span>)}
        {(svc.id === 'reranker' || svc.id === 'ocr' || svc.id === 'documents' || svc.id === 'decision') && <span className="mm-assign-fixed">{t('mm.assign.fixedByServer')}</span>}
      </span>
    </li>;
  };
  const roleRow = (role: Role) => {
    const current = roles?.[role] || '';
    const pool = role === 'vision' ? chat.filter((m) => matchesModelUse(m.labels, 'vision')) : chat;
    return <li key={role} className="mm-assign-row" data-role={role}>
      <span className="mm-assign-label">{t(ROLE[role])}</span>
      {admin && roles
        ? <span className="mm-assign-model"><label className="mm-select"><span className="sr-only">{t(ROLE[role])}</span>
            <select aria-label={t(ROLE[role])} value={current} disabled={busy !== ''} onChange={(e) => void saveRole(role, e.target.value)}>
              {(role === 'vision' || role === 'code' || !current) && <option value="">{t('mm.assign.none')}</option>}
              {pool.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              {current && !pool.some((m) => m.name === current) && <option value={current}>{current}</option>}
            </select></label></span>
        : <span className="mm-assign-model" title={current || undefined}>{current || t('mm.assign.none')}</span>}
      <StatePill state={modelState(current)}/>
      <span className="mm-assign-control"/>
    </li>;
  };

  return <section className="mm-panel mm-assign" aria-labelledby="mm-assign-title">
    <div className="mm-panel-head"><h2 id="mm-assign-title">{t('mm.assign.title')}</h2></div>
    <p className="mm-note">{t('mm.assign.intro')}{info && !admin ? ` ${t('mm.assign.readOnly')}` : ''}</p>
    {!info && !error && <p className="mm-note" role="status">{t('mm.loading')}</p>}
    {info && <ul className="mm-assign-list">
      {info.services.filter((s) => s.id === 'embedding' || s.id === 'reranker' || s.id === 'decision').map(serviceRow)}
      {ROLES.map(roleRow)}
      {info.services.filter((s) => s.id === 'ocr' || s.id === 'documents').map(serviceRow)}
    </ul>}
    <div aria-live="polite">{(status || error) && <p className="mm-assign-status">{status && <span role="status" className="mm-note">{status}</span>}{error && <span role="alert" className="modal-err">{error}</span>}</p>}</div>
  </section>;
}
