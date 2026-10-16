// #1638: Settings → Inference machines. The machines noevia's model-backed services run on, and which
// machine each part of noevia uses. Default: everything on this machine, which changes nothing. Administrators
// only: the Settings shell mounts this page for them alone, and the server refuses everyone else on every method.
//
// Decision service, sensitivity check, OCR, Docling and reranker move at once. Embeddings move only through the #1636 re-index (the same
// set-next → switch → finish the Models page uses), so the page asks first. OCR, Docling (#1841) and the sensitivity check (#1844) move at
// once like the decision service; with nothing assigned they keep the deployment's address, and the sensitivity check says it is shared.
// #1840: a chat role (Fast, Smart, Code, Creative) or Vision moves to a machine's OpenAI-compatible server with a port and the model
// that server lists, asked for through the server.
// #1880: on such a role, an administrator can start a bounded measurement of its model on that machine (generation and
// prompt-reading speed, speculative-decoding acceptance) and stop it; the result and the suggested flags show beside it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { notifyModelsChanged } from '../../models-changed';
import { formatNumber, formatPercent } from '../../number-format';
import { appLocale } from '../../user-preferences';
import { fetchMachineModels, fetchMachines, fetchMachineTune, machineAction, MachineError, machineTuneAction, parsePort } from './api';
import type { EmbeddingTarget, Machine, MachineAction, MachineMeasured, MachineService, MachineServiceId, MachinesView, MachineTuneResult, MachineTuneStatus } from './api';
import './machines.css';

const SERVICE_LABEL: Record<MachineServiceId, MessageKey> = {
  chatFast: 'machines.svc.chatFast', chatSmart: 'machines.svc.chatSmart', chatCode: 'machines.svc.chatCode', chatCreative: 'machines.svc.chatCreative', vision: 'machines.svc.vision',
  decision: 'machines.svc.decision', sensitivity: 'machines.svc.sensitivity', embedding: 'machines.svc.embedding', reranker: 'machines.svc.reranker', ocr: 'machines.svc.ocr', documents: 'machines.svc.documents',
};
const ORDER: MachineServiceId[] = ['chatFast', 'chatSmart', 'chatCode', 'chatCreative', 'vision', 'decision', 'sensitivity', 'embedding', 'reranker', 'ocr', 'documents'];
/** Services whose health is probed (GET /health at their address). */
const PROBED = new Set<MachineServiceId>(['decision', 'sensitivity', 'embedding', 'reranker', 'ocr', 'documents']);
const PLACEHOLDER_PORT: Partial<Record<MachineServiceId, string>> = { decision: '8040', sensitivity: '8040', ocr: '8030', documents: '8031' };
const HEALTH: Record<string, [MessageKey, 'good' | 'warn' | 'bad' | 'muted']> = {
  up: ['machines.health.up', 'good'], down: ['machines.health.down', 'warn'], unreachable: ['machines.health.unreachable', 'bad'],
  unknown: ['machines.health.unknown', 'muted'], idle: ['machines.health.idle', 'muted'],
};
/** Server error codes this page words itself; anything else shows the server's own text. */
const ERRORS: Partial<Record<string, MessageKey>> = {
  publicAddress: 'machines.error.publicAddress', portInAddress: 'machines.error.portInAddress', invalidAddress: 'machines.error.invalidAddress',
  invalidName: 'machines.error.invalidName', duplicateName: 'machines.error.duplicateName', duplicateAddress: 'machines.error.duplicateAddress',
  inUse: 'machines.error.inUse', embeddingOnMachine: 'machines.error.embeddingOnMachine', invalidPort: 'machines.error.invalidPort',
  noLocalEmbedding: 'machines.error.noLocalEmbedding', embeddingOff: 'machines.error.embeddingOff', tooMany: 'machines.error.tooMany',
  invalidModel: 'machines.error.invalidModel', unknownModel: 'machines.error.unknownModel', machineUnreachable: 'machines.error.machineUnreachable',
  machineBusy: 'machines.error.machineBusy', tuneRunning: 'machines.error.tuneRunning',
};
/** #1880: how often the page asks how the measurement is going, and for how long at most. */
const TUNE_POLL_MS = 1000, TUNE_POLL_DEADLINE_MS = 10 * 60 * 1000;

type Draft = { machine: string; port: string; protocol: 'tei' | 'llamacpp'; model: string };
const draftOf = (s: MachineService): Draft => ({ machine: s.machine === 'other' ? 'local' : s.machine, port: s.port ? String(s.port) : '', protocol: s.protocol || 'tei', model: s.model || '' });
/** #1840: what a machine listed for a chat role's row, for the machine and port it was asked at. */
type Listing = { key: string; loading?: boolean; models?: string[]; error?: string };

/** #1854: what a chat role's machine measured for its model, one line; null when nothing came back. */
function measuredFacts(m: MachineMeasured | undefined, t: ReturnType<typeof useT>): string | null {
  if (!m) return null;
  const context = typeof m.contextTokens === 'number' ? t('machines.measured.context', { tokens: formatNumber(m.contextTokens, t.locale, 0) }) : t('machines.measured.contextUnknown');
  const thinking = t(m.thinking === true ? 'machines.measured.thinkingYes' : m.thinking === false ? 'machines.measured.thinkingNo' : 'machines.measured.thinkingUnknown');
  const vision = t(m.vision === true ? 'machines.measured.visionYes' : m.vision === false ? 'machines.measured.visionNo' : 'machines.measured.visionUnknown');
  return [context, thinking, vision].join(' · ');
}

/** #1880: the last measurement of a role's model on its machine, one line. */
function tunedFacts(r: MachineTuneResult, t: ReturnType<typeof useT>): string {
  const rate = (v: number) => formatNumber(v, t.locale, { max: 1 });
  const parts: string[] = [];
  if (typeof r.decode?.tokensPerSecond === 'number') parts.push(t('machines.tuned.decode', { rate: rate(r.decode.tokensPerSecond) }));
  for (const p of r.prefill || []) if (typeof p.tokensPerSecond === 'number') parts.push(t('machines.tuned.prefill', { rate: rate(p.tokensPerSecond), tokens: formatNumber(p.tokens, t.locale, 0) }));
  parts.push(r.speculative?.measured && typeof r.speculative.acceptance === 'number' ? t('machines.tuned.specAccepted', { percent: formatPercent(r.speculative.acceptance * 100, t.locale) }) : t('machines.tuned.specNone'));
  return parts.join(' · ');
}
/** #1880: what the owner could change on that machine, from the measurement's rules. */
function tunedAdvice(r: MachineTuneResult, machine: string, t: ReturnType<typeof useT>): string[] {
  const out = (r.recommendations || []).map((rec) => rec.key === 'contextTokens'
    ? t('machines.tuned.suggestContext', { machine, flag: rec.flag, tokens: formatNumber(r.contextTokens || 0, t.locale, 0), seconds: formatNumber(rec.fillSeconds || 0, t.locale, 0) })
    : t('machines.tuned.suggestSpecOff', { machine, flag: rec.flag, percent: formatPercent((rec.acceptance || 0) * 100, t.locale) }));
  return out.length ? out : [t('machines.tuned.keep')];
}

/** #1856: a short reason for any state that is not plainly healthy: refused / timeout / http NNN. */
const REASON: Record<string, MessageKey> = {
  refused: 'machines.reason.refused', timeout: 'machines.reason.timeout', 'not-found': 'machines.reason.notFound',
  'not-on-this-network': 'machines.reason.notOnNetwork', network: 'machines.reason.network',
};
/** `service`: on a machine's roll-up, the failing service's label, so "This machine" says which one is behind the Error (#1861). */
function HealthPill({ state, reason, service }: { state: string | undefined; reason?: string; service?: string }): JSX.Element {
  const t = useT();
  const [key, tone] = HEALTH[state || 'unknown'] || HEALTH.unknown;
  if (state === 'up' && reason === 'needs-auth') return <span className="mm-state" data-tone="good" data-reason="needs-auth">{t('machines.reason.needsAuth')}</span>;
  const http = /^http-(\d{3})$/.exec(reason || '');
  const why = (state === 'down' || state === 'unreachable') && reason ? (http ? (http[1] === '404' ? t('machines.reason.httpNotFound') : t('machines.reason.http', { status: http[1] })) : REASON[reason] ? t(REASON[reason]) : '') : '';
  const shown = why && service ? t('machines.reason.inService', { service, reason: why }) : why;
  return <span className="mm-state" data-tone={tone} data-reason={why ? reason : undefined} data-service={why && service ? service : undefined} title={shown || undefined}>{t(key)}{shown ? ` · ${shown}` : ''}</span>;
}

export function InferenceMachinesSettings(): JSX.Element {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [view, setView] = useState<MachinesView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  // The add form's own outcome, shown beside it rather than under the assignments.
  const [addError, setAddError] = useState(''), [addStatus, setAddStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState<Partial<Record<MachineServiceId, Draft>>>({});
  const [listings, setListings] = useState<Partial<Record<MachineServiceId, Listing>>>({});
  const [name, setName] = useState(''), [address, setAddress] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; address: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reindex, setReindex] = useState<{ target: EmbeddingTarget; machine: string } | null>(null);
  const live = useRef(true), request = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // #1880: the measurement in progress (or the last one) and the role whose start is being confirmed.
  const [tune, setTune] = useState<MachineTuneStatus | null>(null);
  const [confirmTune, setConfirmTune] = useState<MachineServiceId | null>(null);
  const polling = useRef(false);

  const load = useCallback(async (health = true) => {
    const id = ++request.current;
    try {
      const v = await fetchMachines({ health });
      if (!live.current || id !== request.current) return;
      setView((old) => (v.health || !old?.health ? v : { ...v, health: old.health }));
      setLoadError('');
    } catch {
      if (live.current && id === request.current) setLoadError(tRef.current('machines.loadError'));
    }
  }, []);
  useEffect(() => { void load(true); }, [load]);

  /** #1880: follow a running measurement until it ends (or the deadline passes), then refresh the measured lines. */
  const follow = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    const until = Date.now() + TUNE_POLL_DEADLINE_MS;
    try {
      while (live.current && Date.now() < until) {
        await new Promise((r) => setTimeout(r, TUNE_POLL_MS));
        if (!live.current) return;
        let next: MachineTuneStatus | null = null;
        try { next = await fetchMachineTune(); } catch { continue; }
        if (!live.current) return;
        setTune(next);
        if (next?.state !== 'running') { void load(true); return; }
      }
    } finally { polling.current = false; }
  }, [load]);
  useEffect(() => {
    void fetchMachineTune().then((s) => { if (!live.current) return; setTune(s); if (s?.state === 'running') void follow(); }, () => {});
  }, [follow]);

  const message = (e: unknown, fallback: MessageKey) => {
    if (e instanceof MachineError) { const key = e.code ? ERRORS[e.code] : undefined; return key ? t(key) : e.message || t(fallback); }
    return t(fallback);
  };
  const act = async (key: string, body: MachineAction, done: MessageKey, after?: () => void) => {
    const inForm = body.action === 'add';
    const say = inForm ? setAddStatus : setStatus, fail = inForm ? setAddError : setError;
    setBusy(key); setError(''); setStatus(''); setAddError(''); setAddStatus('');
    try {
      const v = await machineAction(body);
      if (!live.current) return;
      setView((old) => ({ ...v, ...(old?.health ? { health: old.health } : {}) }));
      say(t(done)); after?.();
      void load(true);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof MachineError && e.code === 'reindexRequired' && e.target && body.action === 'assign') { setReindex({ target: e.target, machine: body.machine }); return; }
      fail(message(e, 'machines.saveError'));
    } finally { if (live.current) setBusy(''); }
  };

  const startTune = async (service: MachineServiceId) => {
    setBusy(`tune:${service}`); setError(''); setStatus('');
    try {
      const s = await machineTuneAction({ action: 'tune', service, confirm: true });
      if (!live.current) return;
      setConfirmTune(null); setTune(s);
      void follow();
    } catch (e) {
      if (live.current) { setConfirmTune(null); setError(message(e, 'machines.tune.failedStart')); }
    } finally { if (live.current) setBusy(''); }
  };
  const stopTune = async () => {
    try { const s = await machineTuneAction({ action: 'tuneAbort' }); if (live.current) setTune(s); } catch (e) { if (live.current) setError(message(e, 'machines.saveError')); }
  };
  /** #1880: how the last measurement ended, said once on the role it measured. */
  const tuneOutcome = (s: MachineTuneStatus): string => {
    const machine = s.machine.name;
    if (s.state === 'done') return t('machines.tune.done', { model: s.model, machine });
    if (s.state === 'aborted') return t('machines.tune.aborted');
    if (s.state === 'interrupted') return t('machines.tune.interrupted', { machine });
    return t(s.code === 'stepTimeout' || s.code === 'runTimeout' ? 'machines.tune.failedTimeout' : 'machines.tune.failed', { machine });
  };

  const machines = view?.machines || [];
  const machineName = (id: string) => id === 'local' ? t('machines.thisMachine') : id === 'other' ? t('machines.otherAddress') : machines.find((m) => m.id === id)?.name || id;
  const remote = machines.filter((m) => !m.builtIn);

  const add = (e: FormEvent) => {
    e.preventDefault();
    void act('add', { action: 'add', name: name.trim(), address: address.trim() }, 'machines.added', () => { setName(''); setAddress(''); });
  };

  const runReindex = async () => {
    if (!reindex) return;
    const { target, machine } = reindex;
    setBusy('reindex'); setError(''); setStatus('');
    try {
      // The model manager modules stay in their lazy chunk (core tests/server/i18n.test.cjs): loaded on demand here.
      const { switchEmbedding } = await import('../models/assignments');
      const outcome = await switchEmbedding({ model: target.model, profile: target.profile }, target.baseUrl);
      if (!live.current) return;
      setReindex(null);
      setStatus(outcome === 'done' ? t('machines.reindexDone', { machine: machineName(machine) }) : outcome === 'reindexing' ? t('machines.reindexStarted', { machine: machineName(machine) })
        : outcome === 'diaryPending' ? t('machines.reindexDiaryPending') : t('machines.reindexDiaryFailed'));
      notifyModelsChanged();
      void load(true);
    } catch (e) {
      if (live.current) setError(e instanceof Error && e.message ? t('machines.reindexFailed', { reason: e.message }) : t('machines.saveError'));
    } finally { if (live.current) setBusy(''); }
  };

  /** #1861: the label of the service behind a degraded roll-up ('engine' is this machine's own inference engine). */
  const failingLabel = (id: string | undefined): string | undefined => (!id ? undefined : id === 'engine' ? t('machines.service.engine') : SERVICE_LABEL[id as MachineServiceId] ? t(SERVICE_LABEL[id as MachineServiceId]) : undefined);

  const machineRow = (m: Machine) => {
    const state = view?.health?.machines?.[m.id];
    const label = m.builtIn ? t('machines.thisMachine') : m.name || m.id;
    const editingThis = editing?.id === m.id;
    return <div key={m.id} className="model-row machines-row" data-machine={m.id}>
      <span className={`model-dot${state === 'unreachable' ? ' down' : state === 'down' ? ' warn' : state === 'up' ? '' : ' off'}`} aria-hidden="true"/>
      <div className="model-name-group">
        <span className="model-name">{label}</span>
        <span className="model-quant">{m.builtIn ? t('machines.thisMachineAddress') : m.address}{m.unresolved ? ` · ${t('machines.unresolved')}` : ''}</span>
        <span className="machines-runs">{m.services.length ? t('machines.runs', { services: ORDER.filter((s) => m.services.includes(s)).map((s) => t(SERVICE_LABEL[s])).join(', ') }) : t('machines.runsNothing')}</span>
        {editingThis && <form className="machines-form machines-edit" aria-label={t('machines.editNamed', { name: label })} onSubmit={(e) => { e.preventDefault(); void act(`edit:${m.id}`, { action: 'update', id: m.id, name: editing.name, address: editing.address }, 'machines.updated', () => setEditing(null)); }}>
          <label>{t('machines.name')}<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoComplete="off"/></label>
          <label>{t('machines.address')}<input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} inputMode="url" autoComplete="off" spellCheck={false}/></label>
          <span className="machines-actions">
            <button type="submit" className="btn btn-primary" disabled={busy !== ''}>{busy === `edit:${m.id}` ? t('common.checking') : t('machines.save')}</button>
            <button type="button" className="btn btn-secondary" disabled={busy !== ''} onClick={() => setEditing(null)}>{t('machines.cancel')}</button>
          </span>
        </form>}
        {removing === m.id && <span className="machines-actions" role="group" aria-label={t('machines.removeNamed', { name: label })}>
          <span>{t('machines.removeWarn', { name: label })}</span>
          <button type="button" className="btn btn-primary" disabled={busy !== ''} onClick={() => void act(`remove:${m.id}`, { action: 'remove', id: m.id }, 'machines.removed', () => setRemoving(null))}>{t('machines.removeConfirm')}</button>
          <button type="button" className="btn btn-secondary" disabled={busy !== ''} onClick={() => setRemoving(null)}>{t('machines.cancel')}</button>
        </span>}
      </div>
      <HealthPill state={state} reason={view?.health?.reasons?.[m.id]} service={failingLabel(view?.health?.failing?.[m.id])}/>
      {!m.builtIn && !editingThis && removing !== m.id && <span className="machines-actions">
        <button type="button" className="popup-tab" aria-label={t('machines.editNamed', { name: label })} disabled={busy !== ''} onClick={() => { setEditing({ id: m.id, name: m.name || '', address: m.address || '' }); setRemoving(null); }}>{t('machines.edit')}</button>
        <button type="button" className="popup-tab" aria-label={t('machines.removeNamed', { name: label })} disabled={busy !== ''} onClick={() => { setRemoving(m.id); setEditing(null); }}>{t('machines.remove')}</button>
      </span>}
    </div>;
  };

  const serviceRow = (s: MachineService) => {
    const d = drafts[s.id] || draftOf(s);
    const setDraft = (patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [s.id]: { ...d, ...patch } }));
    // #1847: a worker the deployment has not switched on cannot be moved (assigning a machine would switch it on).
    const notEnabled = s.enabled === false && s.machine === 'local';
    const chat = s.mode === 'chat';
    const movable = (s.mode === 'runtime' || s.mode === 'reindex' || chat) && !notEnabled;
    const onRemote = d.machine !== 'local';
    const port = parsePort(d.port);
    const changed = d.machine !== draftOf(s).machine || (onRemote && (d.port !== draftOf(s).port || (s.id === 'reranker' && d.protocol !== draftOf(s).protocol) || (chat && d.model !== draftOf(s).model)));
    const health = view?.health?.services?.[s.id];
    const label = t(SERVICE_LABEL[s.id]);
    // #1840: the models the machine lists at this port; asked for on request, kept only for the machine and port asked.
    const listingKey = `${d.machine}:${port ?? ''}`;
    const listing = listings[s.id]?.key === listingKey ? listings[s.id] : undefined;
    const modelChoices = [...(listing?.models || []), ...(d.model && !(listing?.models || []).includes(d.model) ? [d.model] : [])];
    const findModels = async () => {
      if (port === null) { setError(t('machines.error.invalidPort')); return; }
      setError('');
      setListings((all) => ({ ...all, [s.id]: { key: listingKey, loading: true } }));
      try {
        const models = await fetchMachineModels(d.machine, port);
        if (!live.current) return;
        setListings((all) => ({ ...all, [s.id]: { key: listingKey, models } }));
        if (models.length && !models.includes(d.model)) setDraft({ model: models[0] });
      } catch (e) {
        if (live.current) setListings((all) => ({ ...all, [s.id]: { key: listingKey, error: message(e, 'machines.modelsError') } }));
      }
    };
    const apply = () => {
      if (onRemote && port === null) { setError(t('machines.error.invalidPort')); return; }
      if (chat && onRemote && !d.model) { setError(t('machines.error.invalidModel')); return; }
      void act(`assign:${s.id}`, { action: 'assign', service: s.id, machine: d.machine, ...(onRemote && port ? { port } : {}), ...(s.id === 'reranker' && onRemote ? { protocol: d.protocol } : {}), ...(chat && onRemote ? { model: d.model } : {}) }, 'machines.assigned',
        () => setDrafts((all) => { const next = { ...all }; delete next[s.id]; return next; }));
    };
    return <li key={s.id} className="mm-assign-row machines-assign" data-service={s.id}>
      <span className="mm-assign-label">{label}</span>
      <span className="mm-assign-model">
        {movable
          ? <label className="mm-select"><span className="sr-only">{t('machines.machineFor', { service: label })}</span>
              <select aria-label={t('machines.machineFor', { service: label })} value={d.machine} disabled={busy !== '' || !view} onChange={(e) => setDraft({ machine: e.target.value })}>
                <option value="local">{t('machines.thisMachine')}</option>
                {remote.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                {s.machine === 'other' && <option value="other" disabled>{t('machines.otherAddress')}</option>}
              </select></label>
          : <span>{machineName(s.machine)}</span>}
      </span>
      {PROBED.has(s.id) || (chat && s.machine !== 'local') ? <HealthPill state={health?.state} reason={health?.reason}/> : <span className="machines-pill-slot" aria-hidden="true"/>}
      <span className="mm-assign-control">
        {movable && onRemote && <label className="machines-port">{t('machines.port')}
          <input aria-label={t('machines.portFor', { service: label })} value={d.port} inputMode="numeric" size={6} placeholder={PLACEHOLDER_PORT[s.id] || '8080'} disabled={busy !== ''} onChange={(e) => setDraft({ port: e.target.value })}/></label>}
        {chat && onRemote && <button type="button" className="popup-tab" disabled={busy !== '' || !!listing?.loading} onClick={() => void findModels()}>{listing?.loading ? t('common.checking') : t('machines.findModels')}</button>}
        {chat && onRemote && modelChoices.length > 0 && <label className="mm-select"><span className="sr-only">{t('machines.modelFor', { service: label })}</span>
          <select aria-label={t('machines.modelFor', { service: label })} value={d.model} disabled={busy !== ''} onChange={(e) => setDraft({ model: e.target.value })}>
            {!d.model && <option value="">{t('machines.chooseModel')}</option>}
            {modelChoices.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></label>}
        {chat && onRemote && listing?.models && listing.models.length === 0 && <span className="mm-assign-fixed" role="status">{t('machines.modelsNone')}</span>}
        {chat && onRemote && listing?.error && <span className="mm-assign-fixed machines-unreachable" role="alert">{listing.error}</span>}
        {s.id === 'reranker' && onRemote && <label className="mm-select"><span className="sr-only">{t('machines.protocol')}</span>
          <select aria-label={t('machines.protocol')} value={d.protocol} disabled={busy !== ''} onChange={(e) => setDraft({ protocol: e.target.value === 'llamacpp' ? 'llamacpp' : 'tei' })}>
            <option value="tei">{t('machines.protocol.tei')}</option>
            <option value="llamacpp">{t('machines.protocol.llamacpp')}</option>
          </select></label>}
        {movable && changed && <button type="button" className="popup-tab" disabled={busy !== ''} onClick={apply}>{busy === `assign:${s.id}` ? t('common.checking') : s.mode === 'reindex' ? t('machines.move') : t('machines.apply')}</button>}
        {notEnabled && <span className="mm-assign-fixed">{t('machines.note.workerNotEnabled')}</span>}
        {s.mode === 'local' && <span className="mm-assign-fixed">{t('machines.note.local')}</span>}
        {s.mode === 'deployment' && <span className="mm-assign-fixed">{t('machines.note.deployment')}</span>}
        {s.id === 'embedding' && <span className="mm-assign-fixed">{t('machines.note.embedding')}</span>}
        {chat && s.machine !== 'local' && !changed && <span className="mm-assign-fixed">{t('machines.note.chat', { model: s.model || '' })}</span>}
        {chat && s.machine !== 'local' && !changed && (() => {
          // #1854: measured on that machine for its model; the engine-only measurements are named as not taken there.
          const measured = view?.health?.measured?.[s.id];
          const facts = measuredFacts(measured, t);
          const name = machineName(s.machine);
          return facts ? <span className="mm-assign-fixed" data-note="measured">{t('machines.measured', { machine: name, facts })} {t(measured?.tune ? 'machines.notMeasuredAfterTune' : 'machines.notMeasured', { machine: name })}</span> : null;
        })()}
        {chat && s.machine !== 'local' && !changed && (() => {
          // #1880: the last administrator-started measurement of this model there, and what it suggests.
          const r = view?.health?.measured?.[s.id]?.tune;
          if (!r) return null;
          const name = machineName(s.machine);
          const when = new Date(r.measuredAt);
          const date = Number.isNaN(when.getTime()) ? '' : new Intl.DateTimeFormat(appLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(when);
          return <span className="mm-assign-fixed" data-note="tuned">{t('machines.tuned', { machine: name, date, facts: tunedFacts(r, t) })} {tunedAdvice(r, name, t).join(' ')}</span>;
        })()}
        {chat && s.machine !== 'local' && !changed && (() => {
          // #1880: start (after a confirmation), follow and stop a measurement on this role's machine.
          const name = machineName(s.machine);
          const mine = tune && tune.service === s.id;
          if (tune && mine && tune.state === 'running') return <span className="machines-actions" data-note="tune-running" role="status">
            <span>{t('machines.tune.running', { machine: tune.machine.name, step: formatNumber(Math.max(1, tune.stepIndex), t.locale, 0), steps: formatNumber(tune.steps, t.locale, 0) })}</span>
            <button type="button" className="btn btn-secondary" data-action="tune-stop" onClick={() => void stopTune()}>{t('machines.tune.stop')}</button>
          </span>;
          if (confirmTune === s.id) return <span className="machines-actions" role="group" data-note="tune-confirm" aria-label={t('machines.tune.measure', { machine: name })}>
            <span>{t('machines.tune.confirm', { model: s.model || '', machine: name })}</span>
            <button type="button" className="btn btn-primary" data-action="tune-start" disabled={busy !== ''} onClick={() => void startTune(s.id)}>{busy === `tune:${s.id}` ? t('common.checking') : t('machines.tune.start')}</button>
            <button type="button" className="btn btn-secondary" disabled={busy !== ''} onClick={() => setConfirmTune(null)}>{t('machines.cancel')}</button>
          </span>;
          const otherRunning = tune?.state === 'running';
          return <>
            {mine && tune && tune.state !== 'running' && <span className="mm-assign-fixed" data-note="tune-outcome" role="status">{tuneOutcome(tune)}</span>}
            {health?.state === 'up' && <button type="button" className="popup-tab" data-action="tune" disabled={busy !== '' || otherRunning} onClick={() => { setConfirmTune(s.id); setError(''); }}>{t('machines.tune.measure', { machine: name })}</button>}
          </>;
        })()}
        {chat && s.machine !== 'local' && s.needsConfirm && !changed && <span className="mm-assign-fixed machines-unreachable" role="status" data-note="confirm-model">{t('machines.note.confirmModel', { model: s.model || '' })}</span>}
        {/* #1844: no address of its own and nothing assigned: it follows the decision service. */}
        {s.id === 'sensitivity' && s.machine === 'local' && !s.url && <span className="mm-assign-fixed">{t('machines.note.sensitivityShared')}</span>}
        {health?.state === 'unreachable' && <span className="mm-assign-fixed machines-unreachable" role="status">{t(s.id === 'decision' ? 'machines.unreachable.decision' : chat ? 'machines.unreachable.chat' : 'machines.unreachable.service')}</span>}
      </span>
    </li>;
  };

  return <div className="inference-machines">
    <div className="settings-title"><h1>{t('settings.section.machines')}</h1><p>{t('machines.intro')}</p></div>
    {!view ? <div className="settings-section">
      {loadError ? <><p className="route-note" role="alert">{loadError}</p><button type="button" className="btn btn-secondary" onClick={() => void load(true)}>{t('machines.retry')}</button></> : <p className="preview-footnote">{t('admin.loading')}</p>}
    </div> : <>
      <section className="settings-section" aria-labelledby="machines-list-title">
        <div className="settings-section-heading"><h2 id="machines-list-title">{t('machines.listTitle')}</h2>
          <button type="button" className="popup-tab" disabled={busy !== ''} onClick={() => { setStatus(''); void load(true); }}>{t('machines.checkNow')}</button></div>
        <div className="set-rows">{machines.map(machineRow)}</div>
        <form className="machines-form" aria-label={t('machines.addTitle')} onSubmit={add}>
          <h3>{t('machines.addTitle')}</h3>
          <label>{t('machines.name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('machines.namePlaceholder')} autoComplete="off" maxLength={60}/></label>
          <label>{t('machines.address')}<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.50" inputMode="url" autoComplete="off" spellCheck={false}/></label>
          <button type="submit" className="btn btn-primary" disabled={busy !== '' || !name.trim() || !address.trim()}>{busy === 'add' ? t('common.checking') : t('machines.add')}</button>
          <p className="gdrive-note">{t('machines.addressNote')}</p>
          <div className="machines-form-outcome" aria-live="polite">{addStatus && <span role="status" className="mm-note">{addStatus}</span>}{addError && <span role="alert" className="modal-err">{addError}</span>}</div>
        </form>
      </section>
      <section className="settings-section" aria-labelledby="machines-assign-title">
        <h2 id="machines-assign-title">{t('machines.assignTitle')}</h2>
        <p className="mm-note">{t('machines.assignIntro')}</p>
        <ul className="mm-assign-list">{ORDER.map((id) => view.services.find((s) => s.id === id)).filter((s): s is MachineService => !!s).map(serviceRow)}</ul>
      </section>
      {reindex && <section className="settings-section machines-reindex" role="region" aria-label={t('machines.reindexTitle')}>
        <h2>{t('machines.reindexTitle')}</h2>
        <p>{t('machines.reindexBody', { machine: machineName(reindex.machine), model: reindex.target.model })}</p>
        <span className="machines-actions">
          <button type="button" className="btn btn-primary" disabled={busy !== ''} onClick={() => void runReindex()}>{busy === 'reindex' ? t('machines.reindexing') : t('machines.reindexConfirm')}</button>
          <button type="button" className="btn btn-secondary" disabled={busy !== ''} onClick={() => setReindex(null)}>{t('machines.cancel')}</button>
        </span>
      </section>}
    </>}
    <div aria-live="polite">{(status || error) && <p className="mm-assign-status">{status && <span role="status" className="mm-note">{status}</span>}{error && <span role="alert" className="modal-err">{error}</span>}</p>}</div>
  </div>;
}
