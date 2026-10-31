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
import { embeddingOptions, fetchAssignments, rerankerCurrent, finishEmbeddingSwitch, resetReranker, saveReranker, serviceSwitchEmbedding, switchEmbedding, turnEmbeddingOff } from './assignments';
import type { Assignments, ServiceAssignment, ServiceId } from './assignments';
import { errorText } from './mm';
import { fetchMachines } from '../machines/api';
import type { MachinesHealth } from '../machines/api';
import { isSleeping } from '../../model-residency';

const SERVICE: Record<ServiceId, MessageKey> = { embedding: 'mm.assign.svc.embedding', reranker: 'mm.assign.svc.reranker', decision: 'mm.assign.svc.decision', sensitivity: 'mm.assign.svc.sensitivity', ocr: 'mm.assign.svc.ocr', documents: 'mm.assign.svc.documents' };
const ROLES = ['fast', 'smart', 'code', 'vision', 'creative'] as const;
type Role = (typeof ROLES)[number];
const ROLE: Record<Role, MessageKey> = { fast: 'mm.assign.role.fast', smart: 'mm.assign.role.smart', code: 'mm.assign.role.code', vision: 'mm.assign.role.vision', creative: 'mm.assign.role.creative' };
type Tone = 'good' | 'warn' | 'bad' | 'muted';
const STATE: Record<string, [MessageKey, Tone]> = {
  active: ['mm.assign.state.active', 'good'], configured: ['mm.assign.state.configured', 'muted'], switching: ['mm.assign.state.switching', 'warn'], missing: ['mm.assign.state.missing', 'bad'], notInstalled: ['mm.assign.state.notInstalled', 'bad'], off: ['mm.assign.state.off', 'muted'],
  // #2238: what the inference-machines probe found at a service that is set up (administrators only).
  down: ['mm.assign.state.down', 'warn'], unreachable: ['mm.assign.state.unreachable', 'bad'],
  loaded: ['mm.loaded', 'good'], sleeping: ['mm.card.sleeping', 'muted'], unloaded: ['mm.card.unloaded', 'muted'], unset: ['mm.assign.state.unset', 'muted'],
};

export function StatePill({ state }: { state: string }): JSX.Element {
  const t = useT();
  const [key, tone] = STATE[state] || STATE.off;
  return <span className="mm-state" data-tone={tone}>{t(key)}</span>;
}

const PROBED: ServiceId[] = ['embedding', 'reranker', 'ocr', 'documents'];
/** The state a row shows. Core's 'active' only means set up; where the machines probe has an answer for the service it decides. */
function pillState(svc: ServiceAssignment, health: MachinesHealth['services'] | null): string {
  if (svc.state === 'missing' && !svc.model) return 'notInstalled';
  // The reranker's switch is on while core's state is 'off' (it has no model name to check): it is switched on, so it is judged
  // like a set-up service, not shown as Off beside a switch that is on.
  const setUp = svc.state === 'active' || (svc.id === 'reranker' && svc.enabled === true && svc.state === 'off');
  if (!setUp) return svc.state;
  if (svc.id === 'decision' || svc.id === 'sensitivity') return 'configured';
  if (!PROBED.includes(svc.id)) return svc.state;
  const probed = health?.[svc.id]?.state;
  // Switched on with no model and no address (a llama.cpp reranker): the probe has nothing to ask, and retrieval does not rerank.
  if (svc.id === 'reranker' && svc.state === 'off' && probed === 'unknown') return 'off';
  return probed === 'up' ? 'active' : probed === 'down' || probed === 'unreachable' ? probed : 'configured';
}

export function ServiceAssignments({ models }: { models: InstalledModel[] }): JSX.Element | null {
  const t = useT();
  const [info, setInfo] = useState<Assignments | null>(null);
  const [roles, setRoles] = useState<AutoRoles | null>(null);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState('');
  const [embedPick, setEmbedPick] = useState('');
  const live = useRef(true), request = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // #2238: GET /api/models/assignments says 'active' for a service when an address is set up, not when it answers. An administrator also
  // gets the inference-machines probe (GET /api/models/machines?health=1: one cached health request per service); until it answers,
  // and for a member (who cannot read it), a set-up service reads "Configured", never "Running".
  const [health, setHealth] = useState<MachinesHealth['services'] | null>(null);
  const [probeFailed, setProbeFailed] = useState(false);
  const load = useCallback(() => {
    const id = ++request.current;   // only the newest load may update the rows
    fetchAssignments().then((v) => {
      if (!live.current || id !== request.current) return;
      setInfo(v); setError('');
      if (v.admin) fetchMachines({ health: true }).then((m) => { if (live.current && id === request.current) { setHealth(m.health?.services ?? null); setProbeFailed(false); } }).catch(() => { if (live.current && id === request.current) { setHealth(null); setProbeFailed(true); } });
    }).catch(() => { if (live.current && id === request.current) setError(t('mm.assign.loadError')); });
    fetchAutoRoles().then((v) => { if (live.current) setRoles(v.roles); }).catch(() => undefined);
  }, [t]);
  useEffect(() => { load(); }, [load]);
  useModelsChanged(load);

  const admin = info?.admin === true;
  const chat = models.filter((m) => !m.missingFile && isChatGenerationModel(m.name, m.labels));
  const byName = new Map(models.map((m) => [m.name, m]));
  const modelState = (name: string | null | undefined) => !name ? 'unset' : !byName.has(name) || byName.get(name)!.missingFile ? 'missing' : isSleeping(byName.get(name)) ? 'sleeping' : byName.get(name)!.loaded ? 'loaded' : 'unloaded';

  const saveRole = async (role: Role, model: string) => {
    if (!roles) return;
    const next: AutoRoles = { ...roles, [role]: model };
    if (!next.fast || !next.smart) { setError(t('mm.route.needBoth')); return; }
    setBusy(role); setError(''); setStatus('');
    try {
      await setAutoRoles({ fast: next.fast, smart: next.smart, vision: next.vision || '', code: next.code || '', creative: next.creative || '' });
      setRoles(next); setStatus(t('mm.assign.saved')); notifyModelsChanged();
    } catch (e) { setError(errorText(e, t('mm.saveError'))); } finally { setBusy(''); }
  };
  const runEmbedding = async (svc: ServiceAssignment, finish: boolean) => {
    const target = embeddingOptions(svc).find((o) => o.model === embedPick);
    if (!finish && !target) return;
    setBusy('embedding'); setError(''); setStatus('');
    try {
      const outcome = finish || svc.next === target!.model ? await finishEmbeddingSwitch() : svc.managed ? await serviceSwitchEmbedding(target!) : await switchEmbedding(target!, svc.baseUrl);
      const model = finish ? svc.next || '' : target!.model;
      if (outcome === 'diaryFailed') setError(t('mm.assign.diaryFailed', { model }));
      else setStatus(outcome === 'done' ? t('mm.assign.saved') : outcome === 'diaryPending' ? t('mm.assign.diaryPending', { model }) : t('mm.assign.reindexing', { model }));
      setEmbedPick(''); notifyModelsChanged(); load();
    } catch (e) { setError(errorText(e, t('mm.saveError'))); } finally { setBusy(''); }
  };

  // #1665: the reranker's runtime switch. Each change applies at once (like the role pickers); the server checks
  // the administrator, audits it, and maps the chosen id to the reranker's address (none is ever sent here).
  const runReranker = async (action: () => Promise<unknown>, done: MessageKey) => {
    setBusy('reranker'); setError(''); setStatus('');
    try { await action(); setStatus(t(done)); notifyModelsChanged(); load(); }
    catch (e) {
      const id = (e as { id?: string }).id;
      setError(id === 'noReranker' ? t('mm.assign.rerankerNoChoice') : id === 'unknownReranker' ? t('mm.assign.rerankerUnknown') : errorText(e, t('mm.saveError')));
    } finally { setBusy(''); }
  };
  const rerankerControls = (svc: ServiceAssignment) => {
    const choices = svc.choices || [];
    const current = rerankerCurrent(svc);
    const savedOutside = current !== '' && !choices.some((c) => c.id === current);
    // The reranker service (TEI) is named by its model alone; a llama.cpp preset says where it runs.
    const label = (c: { backend: string; model: string }) => (c.backend === 'tei' ? c.model : t('mm.assign.rerankerLlamacpp', { model: c.model }));
    // #2114: a long name is cut inside the picker; its full text stays available as the title.
    const currentChoice = choices.find((c) => c.id === current);
    const currentLabel = current ? (currentChoice ? label(currentChoice) : savedOutside ? label({ backend: 'llamacpp', model: current.slice('llamacpp:'.length) }) : undefined) : undefined;
    return <span className="mm-assign-reranker" data-testid="reranker-switch">
      <label className="mm-assign-toggle">
        <input type="checkbox" role="switch" className="noevia-switch" checked={svc.enabled === true}
          disabled={busy !== '' || (!current && svc.enabled !== true)}
          onChange={(e) => { const on = e.currentTarget.checked; void runReranker(() => saveReranker(on, savedOutside && !on ? undefined : current || null), on ? 'mm.assign.rerankerOn' : 'mm.assign.rerankerOff'); }}/>
        <span>{t('mm.assign.rerankerToggle')}</span>
      </label>
      {choices.length > 0
        ? <label className="mm-select"><span className="sr-only">{t('mm.assign.rerankerModel')}</span>
            <select aria-label={t('mm.assign.rerankerModel')} title={currentLabel} value={current} disabled={busy !== ''}
              onChange={(e) => { const id = e.target.value; if (id) void runReranker(() => saveReranker(svc.enabled === true, id), 'mm.assign.saved'); }}>
              {!current && <option value="">{t('mm.assign.rerankerPick')}</option>}
              {savedOutside && <option value={current}>{label({ backend: 'llamacpp', model: current.slice('llamacpp:'.length) })}</option>}
              {choices.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
            </select></label>
        : <span className="mm-assign-fixed">{t('mm.assign.rerankerNoOptions')}</span>}
      {svc.source === 'admin' && <button type="button" className="popup-tab" disabled={busy !== ''} onClick={() => void runReranker(resetReranker, 'mm.assign.rerankerReset')}>{t('mm.assign.useDeployment')}</button>}
      <span className="mm-assign-fixed">{t(svc.source === 'admin' ? 'mm.assign.rerankerFromSettings' : 'mm.assign.rerankerFromDeployment')}</span>
    </span>;
  };

  const turnOff = async () => {
    setBusy('embedding'); setError(''); setStatus('');
    try { await turnEmbeddingOff(); setStatus(t('mm.assign.turnedOff')); notifyModelsChanged(); load(); }
    catch (e) { setError(errorText(e, t('mm.saveError'))); } finally { setBusy(''); }
  };

  const serviceRow = (svc: ServiceAssignment) => {
    const off = svc.id === 'embedding' && svc.managed === true && svc.state === 'off';
    // Off: any installed embedding model, the previous one included, turns it back on.
    const options = svc.id === 'embedding' ? embeddingOptions(svc).filter((o) => off || o.model !== svc.model) : [];
    const pickLabel = off ? t('mm.assign.turnOnWith') : t('mm.assign.switchEmbedding');
    const name = svc.model || ((svc.id === 'ocr' || svc.id === 'documents') && svc.state === 'active' ? t('mm.assign.builtIn') : t('mm.assign.none'));
    return <li key={svc.id} className="mm-assign-row" data-service={svc.id}>
      <span className="mm-assign-label">{t(SERVICE[svc.id])}</span>
      <span className="mm-assign-model" title={svc.model || undefined}>{name}{svc.next ? <small> → {svc.next}</small> : null}</span>
      {/* #1796 review: for Decision and Sensitivity core's 'active' only means an address is set up; nothing checks it answers. */}
      <StatePill state={pillState(svc, health)}/>
      <span className="mm-assign-control">
        {svc.id === 'embedding' && admin && svc.canChange && (svc.next
          ? <button className="popup-tab" disabled={busy !== ''} onClick={() => void runEmbedding(svc, true)}>{busy === 'embedding' ? t('mm.assign.switching') : t('mm.assign.finish')}</button>
          : options.length > 0
            ? <><label className="mm-select"><span className="sr-only">{pickLabel}</span>
                <select aria-label={pickLabel} value={embedPick} disabled={busy !== ''} onChange={(e) => setEmbedPick(e.target.value)}>
                  <option value="">{pickLabel}</option>
                  {options.map((o) => <option key={o.model} value={o.model}>{o.model}</option>)}
                </select></label>
              {embedPick && <button className="popup-tab" disabled={busy !== ''} onClick={() => void runEmbedding(svc, false)}>{busy === 'embedding' ? t('mm.assign.switching') : off ? t('mm.assign.turnOn') : t('mm.assign.switch')}</button>}</>
            : <span className="mm-assign-fixed">{t(svc.managed ? 'mm.assign.noEmbeddingInstalled' : 'mm.assign.noEmbeddingOptions')}</span>)}
        {svc.id === 'embedding' && admin && svc.canTurnOff && !embedPick && <button className="popup-tab" disabled={busy !== ''} onClick={() => void turnOff()}>{t('mm.assign.turnOff')}</button>}
        {/* #1695: a reranker whose file is gone says so, and names what it can be set to instead. */}
        {svc.id === 'reranker' && admin && svc.canChange ? rerankerControls(svc)
          : svc.id === 'reranker' && svc.state === 'missing' && svc.model
          ? <span className="mm-assign-fixed" data-testid="reranker-missing">{svc.options?.length ? t('mm.assign.rerankerMissingWith', { models: svc.options.map((o) => (typeof o === 'string' ? o : o.model)).join(', ') }) : t('mm.assign.rerankerMissing')}</span>
          // #1796: the decision address saved in Settings, or the sensitivity check that shares it, says so.
          // #1666: administrators choose the decision model (and address) in Decision service setup; say where.
          : svc.id === 'decision' && admin ? <span className="mm-assign-fixed">{t(svc.source === 'machine' ? 'mm.assign.decisionOnMachine' : svc.source !== 'admin' ? 'mm.assign.decisionChoose' : svc.modelSource === 'admin' ? 'mm.assign.decisionModelFromSettings' : 'mm.assign.decisionFromSettings')}</span>
          : svc.id === 'sensitivity' && svc.shared ? <span className="mm-assign-fixed">{t('mm.assign.sensitivityShared')}</span>
          : (svc.id === 'reranker' || svc.id === 'ocr' || svc.id === 'documents' || svc.id === 'decision' || svc.id === 'sensitivity') && <span className="mm-assign-fixed">{t('mm.assign.fixedByServer')}</span>}
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
              {(role === 'vision' || role === 'code' || role === 'creative' || !current) && <option value="">{t('mm.assign.none')}</option>}
              {pool.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              {current && !pool.some((m) => m.name === current) && <option value={current}>{current}</option>}
            </select></label></span>
        : <span className="mm-assign-model" title={current || undefined}>{current || t('mm.assign.none')}</span>}
      <StatePill state={modelState(current)}/>
      <span className="mm-assign-control">{role === 'creative' && <span className="mm-assign-fixed" data-testid="creative-swap-note">{t('mm.assign.creativeNote')}</span>}</span>
    </li>;
  };

  const downNames = info ? info.services.filter((s) => ['unreachable', 'down'].includes(pillState(s, health))).map((s) => t(SERVICE[s.id])).join(', ') : '';
  return <section className="mm-panel mm-assign" aria-labelledby="mm-assign-title">
    <div className="mm-panel-head"><h2 id="mm-assign-title">{t('mm.assign.title')}</h2></div>
    <p className="mm-note">{t('mm.assign.intro')}{info && !admin ? ` ${t('mm.assign.readOnly')}` : ''}</p>
    {!info && !error && <p className="mm-note" role="status">{t('mm.loading')}</p>}
    {info && <ul className="mm-assign-list">
      {info.services.filter((s) => s.id === 'embedding' || s.id === 'reranker' || s.id === 'decision' || s.id === 'sensitivity').map(serviceRow)}
      {ROLES.map(roleRow)}
      {info.services.filter((s) => s.id === 'ocr' || s.id === 'documents').map(serviceRow)}
    </ul>}
    {/* One polite announcement, only when something is wrong: the services that do not answer, or that the check itself failed (#2238). */}
    <div aria-live="polite">{(downNames || probeFailed) && <p className="mm-assign-status mm-note">{downNames ? t('mm.assign.downSummary', { services: downNames }) : t('mm.assign.healthFailed')}</p>}</div>
    <div aria-live="polite">{(status || error) && <p className="mm-assign-status">{status && <span role="status" className="mm-note">{status}</span>}{error && <span role="alert" className="modal-err">{error}</span>}</p>}</div>
  </section>;
}
