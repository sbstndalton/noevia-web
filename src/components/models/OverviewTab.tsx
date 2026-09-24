import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch, fetchAutoRoles } from '../../api';
import type { InstalledModel } from '../../types';
import { SYSTEM_MODEL_LABEL } from '../../model-system';
import { errorText, mm } from './mm';
import type { Stuck } from './guided';
import { canPromptSuite, groupByRole, recoveryItems, ROLE_LABEL, roleOf } from './guided';

type Evidence = { category: string; state: string; value: { ctx?: number; rate?: number } | null; at: number | null };
type Roles = Awaited<ReturnType<typeof fetchAutoRoles>>;
type Backend = { name: string; found: boolean; status: string; loaded_model: string | null; probe_error: string | null; last_restart_error: string | null };
const EV_STATE: Record<string, string> = { verified: 'verified', failed: 'failed', stale: 'stale', reported: 'reported', unverified: 'not measured', unavailable: 'unavailable' };

/** Installed models by role with their evidence and route badges, then what needs attention. */
export function OverviewTab({ models, modelsError, onOpen, onTab }: { models: InstalledModel[]; modelsError: string | null; onOpen: (name: string) => void; onTab: (tab: 'discover' | 'hardware' | 'benchmarks') => void }): JSX.Element {
  const [roles, setRoles] = useState<Roles | null>(null);
  useEffect(() => { let live = true; fetchAutoRoles().then((v) => { if (live) setRoles(v); }).catch(() => undefined); return () => { live = false; }; }, []);
  return <div className="mm-overview">
    <RecoverPanel onTab={onTab}/>
    <QualityPanel models={models} modelsError={modelsError} roles={roles} onOpen={onOpen} onTab={onTab}/>
  </div>;
}

function routesFor(name: string, roles: Roles | null): string[] {
  const r = roles?.configured ? roles.roles : null;
  if (!r) return [];
  return (['fast', 'smart', 'vision', 'code'] as const).filter((k) => r[k] === name).map((k) => k[0].toUpperCase() + k.slice(1));
}

function QualityPanel({ models, modelsError, roles, onOpen, onTab }: { models: InstalledModel[]; modelsError: string | null; roles: Roles | null; onOpen: (name: string) => void; onTab: (tab: 'benchmarks') => void }): JSX.Element {
  const [evidence, setEvidence] = useState<Record<string, Evidence[] | null>>({});
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
    <div className="mm-panel-head"><h3 id="mm-quality">Quality</h3>
      <button type="button" className="modal-btn secondary" onClick={() => onTab('benchmarks')}>Run the prompt suite</button></div>
    <p className="mm-note">Installed models by role, with the latest measurements for their current settings. The prompt suite and auto-tune apply to chat models only.</p>
    {modelsError && <p role="alert" className="modal-err">{modelsError}</p>}
    {!groups.length && !modelsError && <p className="mm-note">No models are installed yet.</p>}
    {groups.map((g) => <div key={g.role} className="mm-role-group">
      <h4>{ROLE_LABEL[g.role]} <small>{g.models.length}</small></h4>
      <ul className="mm-role-list">{g.models.map((m) => {
        const routes = routesFor(m.name, roles), ev = evidence[m.name];
        const pick = (c: string) => ev?.find((e) => e.category === c);
        const ctx = pick('context_capacity'), speed = pick('throughput');
        const attention = ev?.some((e) => e.state === 'failed' || e.state === 'stale') || m.failed;
        return <li key={m.name}>
          <div className="mm-role-name"><strong>{m.name}</strong>
            <span className="mm-badges">
              {m.loaded && <span className="mm-pill is-good">Loaded</span>}
              {routes.map((r) => <span key={r} className="mm-pill">{r}</span>)}
              {attention && <span className="mm-pill is-warn">Needs attention</span>}
              {g.role === 'routing' && <span className="mm-pill">{SYSTEM_MODEL_LABEL}</span>}
            </span></div>
          {canPromptSuite(g.role) && <small className="mm-role-evidence">{ev === undefined ? 'Reading evidence…' : ev === null ? 'No evidence tracked on this engine.'
            : [`Context ${ctx ? EV_STATE[ctx.state] || ctx.state : 'not measured'}${ctx?.value?.ctx ? ` · ${ctx.value.ctx.toLocaleString('en-US')} tokens` : ''}`,
               `Speed ${speed ? EV_STATE[speed.state] || speed.state : 'not measured'}${typeof speed?.value?.rate === 'number' ? ` · ${speed.value.rate} tokens/s` : ''}`,
               ...(ev.map((e) => e.at || 0).some(Boolean) ? [`measured ${new Date(Math.max(...ev.map((e) => e.at || 0))).toLocaleDateString()}`] : [])].join(' · ')}</small>}
          {g.role !== 'routing' && <button type="button" className="modal-btn secondary" onClick={() => onOpen(m.name)}>{canPromptSuite(g.role) ? 'Optimize' : 'Details'}</button>}
        </li>;
      })}</ul>
    </div>)}
  </section>;
}

function RecoverPanel({ onTab }: { onTab: (tab: 'discover' | 'hardware') => void }): JSX.Element {
  const [items, setItems] = useState<Stuck[] | null>(null), [backends, setBackends] = useState<Backend[] | null>(null);
  const [error, setError] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(''), [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    const read = (path: string) => apiFetch(path).then(async (r) => (r.ok ? (await r.json()).job ?? null : null)).catch(() => null);
    const [autotune, calibration, downloads, engines] = await Promise.all([
      read('/api/models/autotune?model='), read('/api/models/calibration?model='),
      mm<{ jobs: { id: string; filename: string; repo: string; status: string; error: string | null }[] }>('downloads').then((v) => v.jobs || []).catch(() => []),
      mm<{ backends: Backend[] }>('backends').then((v) => v.backends).catch(() => null),
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
      if (!r.ok) throw Error(v.error || `Request failed (${r.status})`);
      setNote(action === 'cancel' ? 'Cancel requested.' : action === 'resume' ? 'Resumed. Follow it on the model’s page.' : 'Started again. Follow it on the model’s page.');
      await load();
    } catch (e) { setError(errorText(e, 'The request failed.')); } finally { setBusy(''); }
  };
  const unhealthy = (backends || []).filter((b) => !b.found || b.status !== 'running' || b.probe_error || b.last_restart_error);
  const needsPause = items?.some((i) => i.actions.includes('resume') || i.actions.includes('retry'));
  return <section className="mm-panel" aria-labelledby="mm-recover">
    <div className="mm-panel-head"><h3 id="mm-recover">Recover</h3>
      <button type="button" className="modal-btn secondary" onClick={() => void load()}>Check again</button></div>
    <div className="mm-loader-row"><span className={`model-dot${backends && !unhealthy.length ? '' : ' down'}`}/><strong>Model loader</strong>
      <span className="mm-loader-state">{backends === null ? 'Health unavailable' : !backends.length ? 'No engine found' : unhealthy.length
        ? unhealthy.map((b) => `${b.name}: ${b.probe_error || b.last_restart_error || b.status}`).join(' · ')
        : backends.map((b) => `${b.name} running${b.loaded_model ? ` · ${b.loaded_model} loaded` : ''}`).join(' · ')}</span>
      <button type="button" className="mm-guided-link" onClick={() => onTab('hardware')}>Open logs</button></div>
    {items === null && <p className="mm-note" role="status">Checking jobs…</p>}
    {items?.length === 0 && <p className="mm-note" role="status">No failed or stuck tuning, calibration or download jobs.</p>}
    {!!items?.length && <ul className="mm-recover-list">{items.map((item) => <li key={item.kind + item.id}>
      <div><span><strong>{item.kind === 'autotune' ? 'Auto-tune' : item.kind === 'calibration' ? 'Context measurement' : 'Download'}</strong> · {item.model || 'unknown model'} · {item.status}</span>
        {item.detail && <small>{item.detail}</small>}
        {item.kind !== 'download' && <small>Settings saved before this run stay active; chat keeps using them.</small>}
        {!item.actions.length && <small>{SYSTEM_MODEL_LABEL} — not tuned or calibrated.</small>}</div>
      <span className="mm-actions">{item.actions.map((a) => <button key={a} type="button" className="modal-btn secondary" disabled={!!busy || ((a === 'resume' || a === 'retry') && !confirmed)} onClick={() => void act(item, a)}>
        {busy === item.id + a ? 'Working…' : a === 'cancel' ? 'Cancel' : a === 'resume' ? 'Resume' : a === 'retry' ? 'Retry' : 'Retry from Discover'}</button>)}</span>
    </li>)}</ul>}
    {needsPause && <label className="mm-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}/>Chat pauses while a run resumes. I have stopped Diary background jobs and other programs that use the model server.</label>}
    {note && <p className="mm-note" role="status">{note}</p>}
    {error && <p role="alert" className="modal-err">{error}</p>}
  </section>;
}
