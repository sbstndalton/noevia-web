import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch, fetchAutoRoles } from '../../api';
import type { InstalledModel } from '../../types';
import { appLocale } from '../../user-preferences';
import { errorText, mm, num } from './mm';
import type { Stuck } from './guided';
import { canPromptSuite, groupByRole, recoveryItems, roleOf } from './guided';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { ROLE_KEY, stuckStatus } from './mm-text';

type Evidence = { category: string; state: string; value: { ctx?: number; rate?: number } | null; at: number | null };
type Roles = Awaited<ReturnType<typeof fetchAutoRoles>>;
type Backend = { name: string; found: boolean; status: string; loaded_model: string | null; probe_error: string | null; last_restart_error: string | null };
const EV_STATE: Record<string, MessageKey> = { verified: 'mm.overview.ev.verified', failed: 'mm.overview.ev.failed', stale: 'mm.overview.ev.stale', reported: 'mm.overview.ev.reported', unverified: 'mm.overview.ev.unverified', unavailable: 'mm.overview.ev.unavailable' };
const ROUTE_BADGE: Record<'fast' | 'smart' | 'vision' | 'code', MessageKey> = { fast: 'mm.overview.route.fast', smart: 'mm.overview.route.smart', vision: 'mm.overview.route.vision', code: 'mm.overview.route.code' };

/** Installed models by role with their evidence and route badges, then what needs attention. */
export function OverviewTab({ models, modelsError, onOpen, onTab }: { models: InstalledModel[]; modelsError: string | null; onOpen: (name: string) => void; onTab: (tab: 'discover' | 'hardware' | 'benchmarks') => void }): JSX.Element {
  const [roles, setRoles] = useState<Roles | null>(null);
  useEffect(() => { let live = true; fetchAutoRoles().then((v) => { if (live) setRoles(v); }).catch(() => undefined); return () => { live = false; }; }, []);
  return <div className="mm-overview">
    <RecoverPanel onTab={onTab}/>
    <QualityPanel models={models} modelsError={modelsError} roles={roles} onOpen={onOpen} onTab={onTab}/>
  </div>;
}

function routesFor(name: string, roles: Roles | null): MessageKey[] {
  const r = roles?.configured ? roles.roles : null;
  if (!r) return [];
  return (['fast', 'smart', 'vision', 'code'] as const).filter((k) => r[k] === name).map((k) => ROUTE_BADGE[k]);
}

function QualityPanel({ models, modelsError, roles, onOpen, onTab }: { models: InstalledModel[]; modelsError: string | null; roles: Roles | null; onOpen: (name: string) => void; onTab: (tab: 'benchmarks') => void }): JSX.Element {
  const t = useT();
  const [evidence, setEvidence] = useState<Record<string, Evidence[] | null>>({});
  const evState = (state: string) => (EV_STATE[state] ? t(EV_STATE[state]) : state);
  const chatNames = models.filter((m) => canPromptSuite(roleOf(m.name, m.labels))).map((m) => m.name).join('\n');
  useEffect(() => {
    let live = true;
    for (const name of chatNames ? chatNames.split('\n') : []) {
      apiFetch('/api/models/evidence?model=' + encodeURIComponent(name)).then(async (r) => {
        const v = await r.json().catch(() => ({}));
        if (live) setEvidence((prev) => ({ ...prev, [name]: r.ok && v.tracked ? v.categories : null }));
      }).catch(() => { if (live) setEvidence((prev) => ({ ...prev, [name]: null })); });
    }
    return () => { live = false; };
  }, [chatNames]);
  const groups = groupByRole(models);
  return <section className="mm-panel" aria-labelledby="mm-quality">
    <div className="mm-panel-head"><h3 id="mm-quality">{t('mm.overview.quality')}</h3>
      <button type="button" className="modal-btn secondary" onClick={() => onTab('benchmarks')}>{t('mm.overview.runSuite')}</button></div>
    <p className="mm-note">{t('mm.overview.qualityNote')}</p>
    {modelsError && <p role="alert" className="modal-err">{modelsError}</p>}
    {!groups.length && !modelsError && <p className="mm-note">{t('mm.overview.noModels')}</p>}
    {groups.map((g) => <div key={g.role} className="mm-role-group">
      <h4>{t(ROLE_KEY[g.role])} <small>{g.models.length}</small></h4>
      <ul className="mm-role-list">{g.models.map((m) => {
        const routes = routesFor(m.name, roles), ev = evidence[m.name];
        const pick = (c: string) => ev?.find((e) => e.category === c);
        const ctx = pick('context_capacity'), speed = pick('throughput');
        const attention = ev?.some((e) => e.state === 'failed' || e.state === 'stale') || m.failed;
        return <li key={m.name}>
          <div className="mm-role-name"><strong>{m.name}</strong>
            <span className="mm-badges">
              {m.loaded && <span className="mm-pill is-good">{t('mm.loaded')}</span>}
              {routes.map((r) => <span key={r} className="mm-pill">{t(r)}</span>)}
              {attention && <span className="mm-pill is-warn">{t('mm.overview.attention')}</span>}
              {g.role === 'routing' && <span className="mm-pill">{t('model.systemLabel')}</span>}
            </span></div>
          {canPromptSuite(g.role) && <small className="mm-role-evidence">{ev === undefined ? t('mm.overview.readingEvidence') : ev === null ? t('mm.overview.noEvidence')
            : [t('mm.overview.context', { state: ctx ? evState(ctx.state) : t('mm.overview.ev.unverified') }) + (ctx?.value?.ctx ? ` · ${t('mm.tokensCount', { tokens: num(ctx.value.ctx, 0) })}` : ''),
               t('mm.overview.speed', { state: speed ? evState(speed.state) : t('mm.overview.ev.unverified') }) + (typeof speed?.value?.rate === 'number' ? ` · ${t('mm.tokensPerSecond', { rate: num(speed.value.rate) })}` : ''),
               ...(ev.map((e) => e.at || 0).some(Boolean) ? [t('mm.overview.measured', { date: new Date(Math.max(...ev.map((e) => e.at || 0))).toLocaleDateString(appLocale()) })] : [])].join(' · ')}</small>}
          {g.role !== 'routing' && <button type="button" className="modal-btn secondary" onClick={() => onOpen(m.name)}>{canPromptSuite(g.role) ? t('mm.overview.optimize') : t('mm.details')}</button>}
        </li>;
      })}</ul>
    </div>)}
  </section>;
}

function RecoverPanel({ onTab }: { onTab: (tab: 'discover' | 'hardware') => void }): JSX.Element {
  const [items, setItems] = useState<Stuck[] | null>(null), [backends, setBackends] = useState<Backend[] | null>(null);
  const t = useT();
  const [error, setError] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(''), [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    const read = (path: string) => apiFetch(path).then(async (r) => (r.ok ? (await r.json()).job ?? null : null)).catch(() => null);
    const [autotune, calibration, downloads, engines] = await Promise.all([
      read('/api/models/autotune?model='), read('/api/models/calibration?model='),
      mm<{ jobs: { id: string; filename: string; repo: string; status: string; error: string | null }[] }>('downloads').then((v) => v.jobs || []).catch(() => []),
      // `v.backends` is missing rather than `[]` when the endpoint answers with an unexpected or
      // malformed body (a stale server, a proxy swallowing the route) — `?? null` keeps that the
      // same "unavailable" state as a rejected request instead of a bare `undefined` that crashes
      // the `!backends.length` read below.
      mm<{ backends: Backend[] }>('backends').then((v) => v.backends ?? null).catch(() => null),
    ]);
    setItems(recoveryItems({ autotune, calibration, downloads, now: Date.now() })); setBackends(engines);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (item: Stuck, action: Stuck['actions'][number]) => {
    if (action === 'discover') { onTab('discover'); return; }
    setBusy(item.id + action); setError(''); setNote('');
    const base = item.kind === 'autotune' ? '/api/models/autotune' : '/api/models/calibration';
    const [path, body] = action === 'cancel' ? [base + '/cancel', undefined]
      : action === 'resume' ? [base + '/resume', { confirmPause: confirmed }]
      : [base, { model: item.model, confirmPause: confirmed }];
    try {
      const r = await apiFetch(path, { method: 'POST', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const v = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(v.error || t('mm.requestFailed', { status: r.status }));
      setNote(action === 'cancel' ? t('mm.recover.cancelRequested') : action === 'resume' ? t('mm.recover.resumed') : t('mm.recover.restarted'));
      await load();
    } catch (e) { setError(errorText(e, t('mm.recover.failed'))); } finally { setBusy(''); }
  };
  const unhealthy = (backends || []).filter((b) => !b.found || b.status !== 'running' || b.probe_error || b.last_restart_error);
  const needsPause = items?.some((i) => i.actions.includes('resume') || i.actions.includes('retry'));
  return <section className="mm-panel" aria-labelledby="mm-recover">
    <div className="mm-panel-head"><h3 id="mm-recover">{t('mm.recover.title')}</h3>
      <button type="button" className="modal-btn secondary" onClick={() => void load()}>{t('mm.recover.checkAgain')}</button></div>
    <div className="mm-loader-row"><span className={`model-dot${backends && !unhealthy.length ? '' : ' down'}`}/><strong>{t('mm.recover.loader')}</strong>
      <span className="mm-loader-state">{backends === null ? t('mm.recover.healthUnavailable') : !backends.length ? t('mm.recover.noEngine') : unhealthy.length
        ? unhealthy.map((b) => `${b.name}: ${b.probe_error || b.last_restart_error || b.status}`).join(' · ')
        : backends.map((b) => (b.loaded_model ? t('mm.recover.runningWith', { engine: b.name, model: b.loaded_model }) : t('mm.recover.running', { engine: b.name }))).join(' · ')}</span>
      <button type="button" className="mm-guided-link" onClick={() => onTab('hardware')}>{t('mm.recover.openLogs')}</button></div>
    {items === null && <p className="mm-note" role="status">{t('mm.recover.checking')}</p>}
    {items?.length === 0 && <p className="mm-note" role="status">{t('mm.recover.none')}</p>}
    {!!items?.length && <ul className="mm-recover-list">{items.map((item) => <li key={item.kind + item.id}>
      <div><span><strong>{item.kind === 'autotune' ? t('mm.recover.kind.autotune') : item.kind === 'calibration' ? t('mm.recover.kind.calibration') : t('mm.recover.kind.download')}</strong> · {item.model || t('mm.recover.unknownModel')} · {stuckStatus(t, item.status)}</span>
        {item.detail && <small>{item.detail}</small>}
        {item.kind !== 'download' && <small>{t('mm.recover.settingsStay')}</small>}
        {!item.actions.length && <small>{t('mm.recover.systemNote', { label: t('model.systemLabel') })}</small>}</div>
      <span className="mm-actions">{item.actions.map((a) => <button key={a} type="button" className="modal-btn secondary" disabled={!!busy || ((a === 'resume' || a === 'retry') && !confirmed)} onClick={() => void act(item, a)}>
        {busy === item.id + a ? t('mm.working') : a === 'cancel' ? t('common.cancel') : a === 'resume' ? t('mm.recover.resume') : a === 'retry' ? t('mm.recover.retry') : t('mm.recover.retryDiscover')}</button>)}</span>
    </li>)}</ul>}
    {needsPause && <label className="mm-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}/>{t('mm.recover.confirmPause')}</label>}
    {note && <p className="mm-note" role="status">{note}</p>}
    {error && <p role="alert" className="modal-err">{error}</p>}
  </section>;
}
