import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cancelResearch, fetchResearch, proposePlan, savePartialResearch, startResearch } from './api';
import type { ResearchJob, ResearchState } from './api';
import { ShellIcon } from '../ShellIcon';
import './research.css';

const ACTIVE = new Set(['queued', 'running']);
const STATUS: Record<ResearchJob['status'], string> = { queued: 'Queued', running: 'Running', completed: 'Saved', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' };

/** Deep research for one project (D12). Rendered only for admins with features.deepResearch. */
export function ResearchPanel({ projectId, onSaved }: { projectId: string; onSaved?: () => void }): JSX.Element {
  const [state, setState] = useState<ResearchState | null>(null);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [plan, setPlan] = useState<string[] | null>(null);
  const [planEdited, setPlanEdited] = useState(false);
  const [busy, setBusy] = useState('');
  // Saved report files appear as project sources; tell the host when that count grows.
  const savedCount = useRef<number | null>(null);

  const load = useCallback(() => fetchResearch(projectId).then(next => {
    setState(next);
    const saved = next.jobs.reduce((n, j) => n + j.artifacts.length, 0);
    if (savedCount.current !== null && saved > savedCount.current) onSaved?.();
    savedCount.current = saved;
  }).catch(e => setError((e as Error).message)), [projectId, onSaved]);

  useEffect(() => { savedCount.current = null; load(); }, [load]);
  const running = !!state?.jobs.some(j => ACTIVE.has(j.status));
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const act = async (label: string, work: () => Promise<unknown>) => {
    setBusy(label); setError('');
    try { await work(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const start = (withPlan: boolean) => act('start', async () => {
    await startResearch(projectId, withPlan && plan ? { question, plan: planEdited ? 'edited' : 'proposed', subQuestions: plan } : { question, plan: 'skipped' });
    setQuestion(''); setPlan(null); setPlanEdited(false);
  });
  const edit = (next: string[]) => { setPlan(next); setPlanEdited(true); };

  if (!state) return <div className="research-panel"><p className="rail-empty">{error || 'Loading research…'}</p></div>;
  const minutes = Math.round(state.budget.maxMs / 60000);
  return <div className="research-panel">
    <section className="research-compose" aria-labelledby="research-heading">
      <div className="research-heading">
        <h2 id="research-heading">Deep research</h2>
        <p>Plans an investigation, reads web results and this project's sources, and saves a cited report here. Web pages are treated as data, never instructions.</p>
        <ul className="research-budget" aria-label="Budget per job">
          <li>{state.budget.maxWebCalls} web calls</li><li>{minutes} min</li><li>{state.budget.resultsPerQuery} sources per question</li>
        </ul>
      </div>
      {!state.available && <p className="research-note" role="status">{state.reason}</p>}
      {error && <p className="research-note is-error" role="alert">{error}</p>}
      <label className="research-label" htmlFor="research-question">Research question</label>
      <textarea id="research-question" className="research-question" rows={3} maxLength={2000} value={question}
        placeholder="What do you want to find out?" onChange={e => setQuestion(e.target.value)} disabled={!!busy || running}/>
      {plan && <fieldset className="research-plan">
        <legend>Plan · {plan.length} question{plan.length === 1 ? '' : 's'}</legend>
        <ol>{plan.map((item, i) => <li key={i}>
          <input aria-label={`Plan question ${i + 1}`} value={item} maxLength={200} onChange={e => edit(plan.map((p, j) => (j === i ? e.target.value : p)))}/>
          <button type="button" className="shell-icon-button" aria-label={`Remove question ${i + 1}`} title="Remove" onClick={() => edit(plan.filter((_, j) => j !== i))} disabled={plan.length <= 1}><ShellIcon name="close"/></button>
        </li>)}</ol>
        <div className="research-plan-actions">
          <button type="button" className="btn btn-ghost" onClick={() => edit([...plan, ''])} disabled={plan.length >= 7}>Add question</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setPlan(null); setPlanEdited(false); }}>Discard plan</button>
        </div>
      </fieldset>}
      <div className="research-actions">
        {!plan && <button type="button" className="btn btn-secondary" disabled={!question.trim() || !!busy || running || !state.available}
          onClick={() => act('plan', async () => { setPlan(await proposePlan(projectId, question)); setPlanEdited(false); })}>{busy === 'plan' ? 'Planning…' : 'Propose a plan'}</button>}
        <button type="button" className="btn btn-primary" disabled={!question.trim() || !!busy || running || !state.available || (!!plan && !plan.some(p => p.trim()))}
          onClick={() => start(!!plan)}>{busy === 'start' ? 'Starting…' : plan ? 'Start research' : 'Start without a plan'}</button>
      </div>
      {running && <p className="research-note" role="status">One research job runs per project at a time.</p>}
    </section>

    <section className="research-jobs" aria-label="Research jobs">
      {state.jobs.length === 0 ? <p className="rail-empty">No research yet.</p> : state.jobs.map(job => <ResearchJobCard key={job.id} job={job} busy={busy}
        onCancel={() => act(`cancel:${job.id}`, () => cancelResearch(projectId, job.id))}
        onSave={() => act(`save:${job.id}`, () => savePartialResearch(projectId, job.id))}/>)}
    </section>
  </div>;
}

function ResearchJobCard({ job, busy, onCancel, onSave }: { job: ResearchJob; busy: string; onCancel: () => void; onSave: () => void }): JSX.Element {
  const title = job.result?.question || job.plan?.question || 'Research';
  const total = job.plan?.subQuestions.length || job.result?.questions || 1;
  const done = job.checkpoint?.step || job.result?.sections || 0;
  const active = ACTIVE.has(job.status);
  return <article className={`research-job is-${job.status}`} aria-busy={active}>
    <header>
      <h3>{title}</h3>
      <span className="research-status">{job.status === 'completed' && job.result?.partial ? 'Saved · partial' : STATUS[job.status]}</span>
    </header>
    {active && <>
      <progress max={total} value={done} aria-label={`${done} of ${total} questions researched`}/>
      <p className="research-stage">{job.stage || 'Starting…'}</p>
    </>}
    {job.error && <p className="research-note is-error">{job.error}</p>}
    {job.result && <p className="research-meta">{job.result.sections} of {job.result.questions} questions · {job.result.webCalls} web calls · {job.result.citations} citations, {Math.round(job.result.citationValidity * 100)}% verified</p>}
    {job.artifacts.length > 0 && <ul className="research-files" aria-label="Saved files">{job.artifacts.map(name => <li key={name}><ShellIcon name="folder" size={14}/>{name}</li>)}</ul>}
    <div className="research-actions">
      {active && <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy === `cancel:${job.id}`}>Cancel</button>}
      {job.canSavePartial && <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy === `save:${job.id}`}>Save partial report</button>}
    </div>
    {job.result?.markdown && <details className="research-report"><summary>Report preview</summary><pre>{job.result.markdown}</pre></details>}
  </article>;
}
