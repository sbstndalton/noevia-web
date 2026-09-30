import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cancelTask, decideTask, fetchCode, startTask } from './api';
import type { CodeAction, CodeApproval, CodeReview, CodeState, CodeTask, NetworkActivity, PreparationMode } from './api';
import { isDecisionStale } from './decision-guard';
import { EmptyState } from '../EmptyState';
import { ShellIcon } from '../ShellIcon';
import { useT } from '../../i18n';
import type { MessageKey, Translate } from '../../i18n';
import { formatBinaryBytes, formatNumber, formatPercent } from '../../number-format';
import { appLocale } from '../../user-preferences';
import { around } from '../../text-around';
import './code.css';

/** How much of the assistant's output the server keeps (server/code-harness.cjs); the note names it in the locale's units. */
const OUTPUT_PREVIEW_BYTES = 32 * 1024;

const ACTIVE = new Set(['queued', 'running', 'waiting_approval']);
/** The task's status word, from `code.status.*` (#617). */
const statusLabel = (t: Translate, status: CodeTask['status']): string => t(`code.status.${status}` as MessageKey);
/** A catalogue string for a server-supplied id, or the server's own English when the id is not in the catalogue. */
const byId = (t: Translate, key: string, fallback: string): string => { const text = t(key as MessageKey); return text === key ? fallback : text; };
const actionLabel = (t: Translate, action: CodeAction): string => byId(t, `code.action.${action}`, ACTION_LABEL[action]);
const elapsed = (task: CodeTask): string => {
  const end = ACTIVE.has(task.status) ? Date.now() : task.updatedAt;
  const seconds = Math.max(0, Math.floor((end - task.createdAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
/** Plain language for each action class, in the same words the approval card uses. */
export const ACTION_LABEL: Record<CodeAction, string> = {
  read_repository: 'Read the repository', edit_file: 'Edit files', execute_command: 'Run commands',
  install_dependency: 'Install dependencies', network: 'Reach the network', delete: 'Delete files',
  git_push: 'Push to git', open_browser: 'Open a browser', external_account: 'Use an external account', none: 'Nothing',
  review_change: 'Accept the finished change',
};

/** Code mode for one project (spec-agent-execution §3). Rendered only for admins with the feature on. */
export function CodePanel({ projectId }: { projectId: string }): JSX.Element {
  // Project identity owns every task snapshot and composer choice. The keyed child is replaced
  // during the render that changes projects, before an effect could briefly paint the old one.
  return <ProjectCodePanel key={projectId} projectId={projectId}/>;
}

function ProjectCodePanel({ projectId }: { projectId: string }): JSX.Element {
  const t = useT();
  const [state, setState] = useState<CodeState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [prompt, setPrompt] = useState('');
  const [repository, setRepository] = useState('');
  const [capabilities, setCapabilities] = useState<CodeAction[] | null>(null);
  const [domains, setDomains] = useState('');
  const [harness, setHarness] = useState('');
  const [preparation, setPreparation] = useState('direct');
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const ordinaryRequest = useRef(0);
  const activeMutation = useRef(0);
  const nextMutation = useRef(0);
  // Read at click time, not render time: `state` in a render's own closures is only ever
  // as fresh as that render, so checking a stale approval id against it would compare two
  // copies of the same snapshot. This ref always holds the latest poll's result.
  const latestState = useRef<CodeState | null>(null);
  latestState.current = state;

  const load = useCallback(async (mutation = 0) => {
    // Polls pause while a mutation owns the lifecycle. Its follow-up load passes that mutation's
    // token; this prevents an in-flight pre-mutation snapshot from becoming authoritative later.
    if (activeMutation.current && mutation !== activeMutation.current) return;
    // A slow ordinary poll remains eligible instead of being invalidated every second forever.
    // Mutation refreshes intentionally bypass this fence and supersede the older snapshot.
    if (!mutation && ordinaryRequest.current) return;
    const request = ++requestGeneration.current;
    if (!mutation) ordinaryRequest.current = request;
    try {
      const next = await fetchCode(projectId);
      if (!mounted.current || request !== requestGeneration.current) return;
      setState(next);
      setError('');
      setCapabilities(current => current ?? next.defaultCapabilities);
      setRepository(current => current || next.repositories[0]?.id || '');
      setHarness(current => current || next.harnesses[0]?.id || '');
    } catch (e) {
      if (mounted.current && request === requestGeneration.current) setError((e as Error).message);
    } finally {
      if (ordinaryRequest.current === request) ordinaryRequest.current = 0;
    }
  }, [projectId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestGeneration.current++;
      ordinaryRequest.current = 0;
      activeMutation.current = 0;
    };
  }, [load]);
  const running = !!state?.tasks.some(t => ACTIVE.has(t.status));
  // A task that is waiting for an answer is polled faster: the person is looking at the card.
  useEffect(() => {
    if (!running) return;
    const waiting = state?.tasks.some(t => t.status === 'waiting_approval');
    const timer = window.setInterval(() => { void load(); }, waiting ? 1000 : 2000);
    return () => window.clearInterval(timer);
  }, [running, state, load]);

  const act = async (label: string, work: () => Promise<unknown>, onSuccess?: () => void) => {
    // Mirrors ResearchPanel's guard: without it a double click (or a click while a
    // previous decision/cancel/start is still in flight) fires a second mutation on
    // top of the first, and for an approval that means two decisions sent for one
    // task — the second racing the first's own follow-up load.
    if (activeMutation.current) return;
    const mutation = ++nextMutation.current;
    activeMutation.current = mutation;
    requestGeneration.current++;
    ordinaryRequest.current = 0;
    setBusy(label); setError('');
    try {
      await work();
      if (mounted.current && activeMutation.current === mutation) {
        onSuccess?.();
        await load(mutation);
      }
    } catch (e) {
      // A conflict means what the person acted on has moved on (an approval that expired, a
      // task that started elsewhere): show the current state, not the stale card.
      if (mounted.current && activeMutation.current === mutation && (e as { status?: number }).status === 409) await load(mutation);
      if (mounted.current && activeMutation.current === mutation) setError((e as Error).message);
    } finally {
      if (mounted.current && activeMutation.current === mutation) {
        activeMutation.current = 0;
        setBusy('');
      }
    }
  };
  const toggle = (action: CodeAction) => setCapabilities(list =>
    (list || []).includes(action) ? (list || []).filter(a => a !== action) : [...(list || []), action]);

  if (!state || !capabilities) return <div className="code-panel"><p className={`code-note${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || t('code.panel.loading')}</p>{error && <button type="button" className="btn btn-secondary" onClick={() => void load()}>{t('code.panel.retry')}</button>}</div>;
  // Network and installs only mean something where the egress proxy exists; elsewhere they are
  // shown, unavailable, with the reason, rather than offered and then silently not granted.
  const online = state.network === true;
  const needsNetwork = (action: CodeAction) => action === 'network' || action === 'install_dependency';
  const needsDomains = online && (capabilities.includes('network') || capabilities.includes('install_dependency'));
  const noRepositories = state.repositories.length === 0;

  return <div className="code-panel">
    <section className="code-compose" aria-labelledby="code-heading">
      <div className="code-heading">
        <h2 id="code-heading">{t('code.panel.heading')}</h2>
        <p>{t('code.panel.intro')}</p>
      </div>
      {error && <p className="code-note is-error" role="alert">{error}</p>}
      {noRepositories && <p className="code-note" role="status">{around(t('code.panel.noRepositories'), 'name')[0]}<code>CODE_REPOS</code>{around(t('code.panel.noRepositories'), 'name')[1]}</p>}

      <div className="code-field">
        <label htmlFor="code-repository">{t('code.panel.repository')}</label>
        <select id="code-repository" value={repository} disabled={noRepositories || running || !!busy}
          onChange={e => setRepository(e.target.value)}>
          {state.repositories.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
        </select>
      </div>

      <div className="code-choices">
        {/* One harness per deployment today. A select holding a single option is a dropdown
            that lies about offering a choice, so with one it reads as the fact it is — and a
            <p> is not a labelable element, so it carries its own label text. */}
        {state.harnesses.length > 1
          ? <div className="code-field">
              <label htmlFor="code-harness">{t('code.panel.harness')}</label>
              <select id="code-harness" value={harness} disabled={running || !!busy} onChange={e => setHarness(e.target.value)}>
                {state.harnesses.map(h => <option key={h.id} value={h.id}>{h.label}{h.version ? ` ${h.version}` : ''}</option>)}
              </select>
            </div>
          : <div className="code-field">
              <p className="code-fact"><span>{t('code.panel.harness')}</span>{state.harnesses[0]
                ? `${state.harnesses[0].label}${state.harnesses[0].version ? ` ${state.harnesses[0].version}` : ''}`
                : t('code.panel.harnessNone')}</p>
            </div>}
        <div className="code-field">
          <label htmlFor="code-preparation">{t('code.panel.preparation')}</label>
          <select id="code-preparation" value={preparation} disabled={running || !!busy} onChange={e => setPreparation(e.target.value)}>
            {state.promptPreparation.map(m => <option key={m.id} value={m.id} disabled={!m.available}>
              {byId(t, `code.prep.${m.id}.label`, m.label)}{m.available ? '' : ` — ${t('code.panel.notAvailable')}`}</option>)}
          </select>
          <PreparationNote mode={state.promptPreparation.find(m => m.id === preparation)}/>
        </div>
      </div>

      {/* Where the harness runs is a security fact, not a setting, so it is stated either way. */}
      <p className={`code-note${state.sandboxed ? '' : ' is-error'}`}>
        {state.sandboxed
          ? online
            ? t('code.panel.sandboxOnline')
            : t('code.panel.sandboxOffline')
          : t('code.panel.notSandboxed')}
      </p>

      <div className="code-field">
        <label htmlFor="code-prompt">{t('code.panel.promptLabel')}</label>
        <textarea id="code-prompt" rows={3} maxLength={8000} value={prompt} disabled={noRepositories || running || !!busy}
          placeholder={t('code.panel.promptPlaceholder')}
          onChange={e => setPrompt(e.target.value)}/>
      </div>

      <fieldset className="code-capabilities">
        <legend>{t('code.panel.capabilities')}</legend>
        <p className="code-note">{t('code.panel.capabilitiesNote')}</p>
        <div className="code-capability-list">
          {state.capabilities.map(action => {
            const unavailable = !online && needsNetwork(action);
            return <label key={action} className={`code-capability${unavailable ? ' is-unavailable' : ''}`}>
              <input type="checkbox" checked={!unavailable && capabilities.includes(action)} disabled={unavailable || running || !!busy} onChange={() => toggle(action)}/>
              <span>{actionLabel(t, action)}</span>
            </label>;
          })}
        </div>
        {!online && <p className="code-note">{t('code.panel.offlineNote')}</p>}
      </fieldset>

      {needsDomains && <div className="code-field">
        <label htmlFor="code-domains">{t('code.panel.domainsLabel')}</label>
        <input id="code-domains" value={domains} disabled={running || !!busy} placeholder="registry.npmjs.org, pypi.org"
          onChange={e => setDomains(e.target.value)}/>
        <p className="code-note">{t('code.panel.domainsNote')}</p>
      </div>}

      <div className="code-actions">
        <button type="button" className="btn btn-primary" disabled={!prompt.trim() || !repository || running || !!busy}
          onClick={() => act('start', () => startTask(projectId, { repository, prompt, capabilities: capabilities.filter(a => online || !needsNetwork(a)), harness, promptPreparation: preparation,
            domains: domains.split(',').map(d => d.trim()).filter(Boolean) }), () => setPrompt(''))}>{busy === 'start' ? t('code.panel.starting') : t('code.panel.start')}</button>
      </div>
      {running && <p className="code-note" role="status">{t('code.panel.oneTask')}</p>}
    </section>

    <section className="code-tasks" aria-label={t('code.panel.tasksLabel')}>
      <div className="code-tasks-heading">
        <div><h2>{t('code.panel.tasksHeading')}</h2><p className="code-note" role="status">{state.tasks.filter(task => task.status === 'waiting_approval').length > 0
          ? t.plural('code.panel.tasksWaiting', state.tasks.filter(task => task.status === 'waiting_approval').length)
          : state.tasks.filter(task => ACTIVE.has(task.status)).length > 0
            ? t('code.panel.tasksInProgress', { count: state.tasks.filter(task => ACTIVE.has(task.status)).length })
            : t.plural('code.panel.tasksSaved', state.tasks.length)}
          {state.tasks.some(task => task.status === 'failed' || task.status === 'interrupted') && ` · ${t('code.panel.tasksNeedReview')}`}</p></div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => void load()}>{t('code.panel.refresh')}</button>
      </div>
      {state.tasks.length === 0
        ? <EmptyState icon="code" title={t('code.panel.emptyTitle')} compact>{t('code.panel.emptyBody')}</EmptyState>
        : state.tasks.map(task => <TaskCard key={task.id} task={task} busy={busy}
          onDecide={(decision, approvalId) => {
            // approvalId is bound in the render that drew the button the person clicked.
            // If a poll landed between that render and the click, this task's live
            // approval id has since moved on (resolved, replaced, or expired) — sending
            // the stale id would decide the wrong approval, so skip and say why instead.
            const live = latestState.current?.tasks.find(t => t.id === task.id)?.approval?.id;
            if (isDecisionStale(live, approvalId)) { setError(t('code.panel.staleApproval')); void load(); return; }
            act(`decide:${task.id}`, () => decideTask(projectId, task.id, approvalId, decision));
          }}
          onCancel={() => act(`cancel:${task.id}`, () => cancelTask(projectId, task.id))}/>)}
    </section>
  </div>;
}

function TaskCard({ task, busy, onDecide, onCancel }: {
  task: CodeTask; busy: string;
  onDecide: (decision: 'approve' | 'approve_all' | 'deny', approvalId: string) => void; onCancel: () => void;
}): JSX.Element {
  const t = useT();
  const active = ACTIVE.has(task.status);
  const updated = new Date(task.updatedAt).toLocaleString(appLocale() ?? [], { dateStyle: 'medium', timeStyle: 'short' });
  const outcome = task.status === 'waiting_approval' ? (task.approval ? t('code.task.waitingDecisionFor', { action: actionLabel(t, task.approval.action) }) : t('code.task.waitingDecision'))
    : task.status === 'completed' ? (task.result?.tools ? t.plural('code.task.finishedAfter', task.result.tools) : statusLabel(t, 'completed'))
    : task.status === 'failed' ? t('code.task.failedOutcome')
    : task.status === 'cancelled' ? statusLabel(t, 'cancelled')
    : task.status === 'interrupted' ? t('code.task.interruptedOutcome')
    : task.stage || statusLabel(t, task.status);
  return <article className={`code-task is-${task.status}`} aria-busy={active && !task.approval}>
    <header>
      <h3>{task.task || task.branch || t('code.task.untitled')}</h3>
      <span className="code-status">{statusLabel(t, task.status)}</span>
    </header>
    <p className="code-meta">{[task.branch, task.capabilities.map(a => actionLabel(t, a)).join(' · ')].filter(Boolean).join(' · ') || t('code.task.readOnly')}</p>
    <p className="code-stage"><span role={task.status === 'waiting_approval' ? 'status' : undefined}>{outcome}</span> · {t('code.task.elapsed', { time: elapsed(task) })} · {t('code.task.updated')} <time dateTime={new Date(task.updatedAt).toISOString()}>{updated}</time></p>
    {task.error && <p className="code-note is-error">{task.error}</p>}
    {task.approval && <ApprovalCard approval={task.approval} busy={busy.startsWith('decide:')} onDecide={onDecide}/>}
    {active && <div className="code-actions"><button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!!busy}>{t('code.task.cancel')}</button></div>}
    {task.plan && <section className="code-plan" role="region" aria-label={t('code.task.plan.region')} tabIndex={0}>
      <h4>{t('code.task.plan.heading')}</h4>
      <p className="code-plan-note">{t('code.task.plan.status', { status: byId(t, `code.task.plan.state.${task.plan.status}`, task.plan.status) })}</p>
      {task.plan.truncated && <p className="code-plan-note">{t('code.task.plan.truncated')}</p>}
      {task.plan.status !== 'skipped' && (task.plan.subQuestions.length
        ? <ul>{task.plan.subQuestions.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
        : <p className="code-plan-note">{t('code.task.plan.empty')}</p>)}
    </section>}
    {task.assistantOutput?.text && (active
      ? <section className="code-output" role="region" aria-label={t('code.task.output.heading')} tabIndex={0}>
          <h4>{t('code.task.output.heading')}</h4>
          {task.assistantOutput.truncated && <p className="code-output-note">{t('code.task.output.truncated', { size: formatBinaryBytes(OUTPUT_PREVIEW_BYTES, appLocale()) })}</p>}
          <p>{task.assistantOutput.text}</p>
        </section>
      : <details className="code-output code-output-details">
          <summary>{task.assistantOutput.truncated ? t('code.task.output.shortened') : t('code.task.output.heading')}</summary>
          {task.assistantOutput.truncated && <p className="code-output-note">{t('code.task.output.truncated', { size: formatBinaryBytes(OUTPUT_PREVIEW_BYTES, appLocale()) })}</p>}
          <p>{task.assistantOutput.text}</p>
        </details>)}
    {task.result && !active && <p className="code-meta">
      {t('code.task.result', {
        tools: t.plural('code.task.result.tools', task.result.tools ?? 0, { count: formatNumber(task.result.tools ?? 0, appLocale(), 0) }),
        allowed: formatNumber(task.result.allowed ?? 0, appLocale(), 0), declined: formatNumber(task.result.refused ?? 0, appLocale(), 0), refused: formatNumber(task.result.denied ?? 0, appLocale(), 0),
      })}
    </p>}
    {task.result?.network && !active && <NetworkNote network={task.result.network}/>}
    {task.review && !active && <ReviewOutcome review={task.review} decision={task.result?.review}/>}
    {task.meta && !active && <TaskMeta meta={task.meta}/>}
  </article>;
}

/**
 * The hosts a task reached, and the ones the proxy refused. A refused host is the usual reason a
 * networked task could not install something, and naming it is what lets the next task ask for it.
 */
function NetworkNote({ network }: { network: NetworkActivity }): JSX.Element | null {
  const t = useT();
  if (!network.hosts.length) return <p className="code-meta">{t('code.network.none')}</p>;
  const reached = network.hosts.filter(h => h.allowed);
  const refused = network.hosts.filter(h => h.refused);
  return <>
    {reached.length > 0 && <p className="code-meta">{t('code.network.reached', { hosts: reached.map(h => `${h.host} (${h.allowed})`).join(' · ') })}</p>}
    {refused.length > 0 && <p className="code-note is-error">
      {t('code.network.refused', { hosts: refused.map(h => `${h.host} (${h.refused})`).join(' · ') })}
    </p>}
  </>;
}

/** Why a preparation mode is or is not on offer — the measurement, in its own words. */
function PreparationNote({ mode }: { mode?: PreparationMode }): JSX.Element | null {
  const t = useT();
  return mode ? <p className="code-note">{byId(t, `code.prep.${mode.id}.reason`, mode.reason)}</p> : null;
}

/**
 * What the harness reported — and what it did not. The limitations are shown, not hidden: a
 * run that could not say how many tokens it used is not evidence that it used none, and §1's
 * whole point is showing evidence rather than a score.
 */
export function TaskMeta({ meta }: { meta: NonNullable<CodeTask['meta']> }): JSX.Element {
  const t = useT();
  const parts = [
    meta.harnessVersion ? `${meta.harness || 'harness'} ${meta.harnessVersion}` : meta.harness,
    meta.usage?.total != null ? t('chat.meta.tokens', { tokens: formatNumber(meta.usage.total, appLocale(), 0) }) : null,
    // Context used is its own measurement; a harness can report it and not token usage (#600: in
    // the interface language, with the locale's own percent and grouping).
    meta.context ? t('code.meta.context', { percent: formatPercent(meta.context.percent, appLocale(), 0), size: formatNumber(meta.context.size, appLocale(), 0) }) : null,
    meta.commands
      ? meta.failedCommands
        ? t.plural('code.meta.commandsFailed', meta.commands, { failed: meta.failedCommands })
        : t.plural('code.meta.commands', meta.commands)
      : null,
  ].filter(Boolean);
  return <>
    {parts.length > 0 && <p className="code-meta">{parts.join(' · ')}</p>}
    {meta.limitations.length > 0 && <details className="code-limitations">
      <summary>{t('code.meta.limitations', { count: formatNumber(meta.limitations.length, appLocale(), 0) })}</summary>
      <ul>{meta.limitations.map(l => <li key={l}>{l}</li>)}</ul>
    </details>}
  </>;
}

/**
 * The gate. Three distinct answers, and the arguments in full — never truncated, never
 * summarised — because seeing them IS the gate. There is no "never ask".
 */
export function ApprovalCard({ approval, busy, onDecide }: {
  approval: CodeApproval; busy: boolean; onDecide: (decision: 'approve' | 'approve_all' | 'deny', approvalId: string) => void;
}): JSX.Element {
  const t = useT();
  if (approval.action === 'review_change') return <ReviewCard approval={approval} busy={busy} onDecide={onDecide}/>;
  const standing = approval.action !== 'delete' && approval.action !== 'git_push';
  // Bound here, at the render that drew this card, so every click on it carries the id
  // of the approval actually on screen rather than whatever `approval` resolves to later.
  const approvalId = approval.id;
  return <div className="code-approval" role="group" aria-label={t('code.approval.group')}>
    <p className="code-approval-title"><ShellIcon name="security" size={16}/>{actionLabel(t, approval.action)}{approval.title ? ` — ${approval.title}` : ''}</p>
    {approval.reason && <p className="code-note">{approval.reason}</p>}
    {approval.command && <pre className="code-approval-args" aria-label={t('code.approval.command')}>{approval.command}</pre>}
    {approval.diff && <pre className="code-approval-args" aria-label={t('code.approval.changesTo', { path: approval.diff.path })}>{approval.diff.newText ?? ''}</pre>}
    {approval.arguments !== null && approval.arguments !== undefined &&
      <pre className="code-approval-args" aria-label={t('code.approval.arguments')}>{JSON.stringify(approval.arguments, null, 2)}</pre>}
    <div className="code-approval-actions">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide('approve', approvalId)}>{t('code.approval.allowOnce')}</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onDecide('deny', approvalId)}>{t('code.approval.decline')}</button>
      {standing && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDecide('approve_all', approvalId)}>{t('code.approval.allowTask')}</button>}
    </div>
    {!standing && <p className="code-note">{t('code.approval.askedAlways')}</p>}
  </div>;
}

/** The Planner's verdict, or the plain reason there is none. Advice, never the decision. */
function ReviewVerdict({ review }: { review: CodeReview }): JSX.Element {
  const t = useT();
  if (review.status !== 'completed') {
    return <p className="code-review-verdict is-unreviewed">
      {review.reason ? t('code.review.notReviewedReason', { reason: review.reason }) : t('code.review.notReviewed')}
    </p>;
  }
  const findings = review.findings || [];
  return <>
    <p className={`code-review-verdict is-${review.verdict === 'approve' ? 'approve' : 'changes'}`}>
      {review.verdict === 'approve' ? t('code.review.suggestsAccepting') : t('code.review.requestsChanges')}{review.summary ? ` — ${review.summary}` : ''}
    </p>
    {findings.length > 0 && <ul className="code-review-findings" aria-label={t('code.review.findings')}>
      {findings.map((f, i) => <li key={i}><strong>{byId(t, `code.review.severity.${f.severity}`, f.severity)}</strong>{f.file ? <> · <code>{f.file}</code></> : null} — {f.message}</li>)}
    </ul>}
  </>;
}

/**
 * The last card of a reviewed task (#519). The Planner's verdict sits above the question, and the
 * question is the person's alone: accept or decline, once. There is no standing answer — there is
 * no later card for one to stand in for — and a card left unanswered expires as a decline.
 */
function ReviewCard({ approval, busy, onDecide }: {
  approval: CodeApproval; busy: boolean; onDecide: (decision: 'approve' | 'approve_all' | 'deny', approvalId: string) => void;
}): JSX.Element {
  const t = useT();
  const approvalId = approval.id;
  return <div className="code-approval code-review" role="group" aria-label={t('code.review.group')}>
    <p className="code-approval-title"><ShellIcon name="security" size={16}/>{actionLabel(t, 'review_change')}</p>
    {approval.review && <ReviewVerdict review={approval.review}/>}
    {approval.reason && <p className="code-note">{approval.reason}</p>}
    {approval.arguments !== null && approval.arguments !== undefined &&
      <pre className="code-approval-args" aria-label={t('code.review.changeToAccept')}>{JSON.stringify(approval.arguments, null, 2)}</pre>}
    <div className="code-approval-actions">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide('approve', approvalId)}>{t('code.review.accept')}</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onDecide('deny', approvalId)}>{t('code.approval.decline')}</button>
    </div>
    <p className="code-note">{t('code.review.advice')}</p>
  </div>;
}

/** What happened at the review, once the task has finished. */
function ReviewOutcome({ review, decision }: { review: CodeReview; decision?: NonNullable<CodeTask['result']>['review'] }): JSX.Element {
  const t = useT();
  return <section className="code-review-outcome" aria-label={t('code.review.outcome')}>
    <ReviewVerdict review={review}/>
    {decision && <p className="code-meta">{decision.accepted ? t('code.review.youAccepted') : decision.decision === 'timeout'
      ? t('code.review.timedOut') : t('code.review.notAccepted')} {t('code.review.branchStays')}</p>}
  </section>;
}
