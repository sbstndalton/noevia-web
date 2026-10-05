import type { JSX } from 'react';
import type { CodeApproval, CodeTask, PipelineCheckStatus, PipelineEvidence, PipelineLifecycle, PipelineTests } from './api';
import { useT } from '../../i18n';
import { formatDuration } from '../../number-format';
import { appLocale } from '../../user-preferences';
import type { MessageKey, Translate } from '../../i18n';

/* Pipeline tasks (#706): the stage strip, the evidence for a revision, and the sections behind it.
   Everything here renders server-supplied text as text. The test tail in particular is output from
   a command the agent ran, so it only ever goes into a text node. */

const MAIN_STAGES: PipelineLifecycle[] = ['planned', 'implementing', 'verifying', 'reviewing', 'changes_requested', 'merged'];
const byId = (t: Translate, key: string, fallback: string): string => { const text = t(key as MessageKey); return text === key ? fallback : text; };
export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : '—');
const shortHash = (hash: string | null | undefined): string => (hash ? hash.slice(0, 12) : '—');

/** Stage and elapsed durations use the app's own helper: at most two units, rolling up to hours and days. */
export function formatSpan(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 1 ? '<1s' : formatDuration(seconds, appLocale());
}

/** Time spent in each stage, from the authoritative moves: a stage lasts until the next move; the last one until `updatedAt`. */
export function stageDurations(task: CodeTask): { spent: Partial<Record<PipelineLifecycle, number>>; visited: Set<PipelineLifecycle> } {
  const moves = task.stages || [];
  const spent: Partial<Record<PipelineLifecycle, number>> = {};
  const visited = new Set<PipelineLifecycle>();
  const add = (stage: PipelineLifecycle, ms: number) => { spent[stage] = (spent[stage] || 0) + Math.max(0, ms); };
  moves.forEach((move, index) => {
    if (index === 0 && move.from) { visited.add(move.from); add(move.from, move.at - task.createdAt); }
    visited.add(move.to);
    add(move.to, (moves[index + 1]?.at ?? task.updatedAt) - move.at);
  });
  return { spent, visited };
}

export function PipelineStrip({ task }: { task: CodeTask }): JSX.Element | null {
  const t = useT();
  if (!task.pipeline) return null;
  const moves = task.stages || [];
  const current = task.lifecycle ?? moves[moves.length - 1]?.to ?? 'planned';
  const { spent, visited } = stageDurations(task);
  const stages: PipelineLifecycle[] = current === 'blocked' || visited.has('blocked') ? [...MAIN_STAGES, 'blocked'] : MAIN_STAGES;
  return <div className="code-pipe">
    <ol className="code-pipe-strip" aria-label={t('code.pipeline.strip')}>
      {stages.map(stage => {
        const state = stage === current ? 'current' : visited.has(stage) ? 'done' : 'pending';
        const ms = spent[stage];
        return <li key={stage} className={`code-pipe-stage is-${state}${stage === 'blocked' ? ' is-blocked' : ''}`} aria-current={state === 'current' ? 'step' : undefined}>
          <span className="code-pipe-name">{t(`code.pipeline.stage.${stage}` as MessageKey)}</span>
          <span className="code-sr">, {t(`code.pipeline.state.${state}` as MessageKey)}</span>
          {state !== 'pending' && stage !== 'blocked' && ms !== undefined && <span className="code-pipe-dur">{formatSpan(ms)}</span>}
        </li>;
      })}
    </ol>
    {task.revision && <p className="code-pipe-rev"><span aria-hidden="true">r{task.revision.n}</span>
      <span className="code-sr">{t('code.pipeline.revision', { n: task.revision.n })}</span></p>}
  </div>;
}

function TestsLine({ tests }: { tests: PipelineTests | null }): JSX.Element {
  const t = useT();
  if (!tests) return <>{t('code.pipeline.tests.none')}</>;
  const verdict = tests.passed ? t('code.pipeline.tests.passed') : tests.timedOut ? t('code.pipeline.tests.timedOut') : t('code.pipeline.tests.failed');
  const bits = [tests.exitCode !== null && tests.exitCode !== undefined ? t('code.pipeline.tests.exit', { code: tests.exitCode }) : '', typeof tests.durationMs === 'number' ? formatSpan(tests.durationMs) : ''].filter(Boolean);
  return <><strong className={tests.passed ? 'code-pipe-pass' : 'code-pipe-fail'}>{verdict}</strong>{bits.length > 0 && ` · ${bits.join(' · ')}`}</>;
}

/** The collapsible tail. Plain text in a <pre>: it is untrusted output, never markup. */
function TestOutput({ tests }: { tests: PipelineTests }): JSX.Element {
  const t = useT();
  return <details className="code-output-details code-pipe-details">
    <summary>{t('code.pipeline.tests.output')}</summary>
    {tests.truncated && <p className="code-plan-note">{t('code.pipeline.tests.truncated')}</p>}
    {tests.tail ? <pre className="code-approval-args" tabIndex={0} aria-label={t('code.pipeline.tests.output')}>{tests.tail}</pre> : <p className="code-plan-note">{t('code.pipeline.tests.noOutput')}</p>}
  </details>;
}

function Checks({ checks }: { checks: { name: string; status: PipelineCheckStatus; detail?: string }[] }): JSX.Element {
  const t = useT();
  return <ul className="code-pipe-checks" aria-label={t('code.pipeline.completeness')}>
    {checks.map(check => <li key={check.name} className={`is-${check.status}`}>
      <span className="code-pipe-check-status">{byId(t, `code.pipeline.check.${check.status}`, check.status)}</span>
      {' '}<span>{byId(t, `code.pipeline.check.${check.name}`, check.name)}</span>
      {check.detail ? <span className="code-pipe-detail"> — {check.detail}</span> : null}
    </li>)}
  </ul>;
}

function EvidenceFacts({ evidence }: { evidence: PipelineEvidence }): JSX.Element {
  const t = useT();
  const review = evidence.review;
  return <dl className="code-pipe-facts">
    <div><dt>{t('code.pipeline.head')}</dt><dd><code title={evidence.headSha || undefined}>{shortSha(evidence.headSha)}</code></dd></div>
    <div><dt>{t('code.pipeline.base')}</dt><dd><code title={evidence.baseSha || undefined}>{shortSha(evidence.baseSha)}</code></dd></div>
    <div><dt>{t('code.pipeline.planHash')}</dt><dd><code title={evidence.planHash || undefined}>{shortHash(evidence.planHash)}</code></dd></div>
    <div><dt>{t('code.pipeline.tests')}</dt><dd><TestsLine tests={evidence.tests}/></dd></div>
    <div><dt>{t('code.pipeline.review')}</dt><dd>{review
      ? <>{review.verdict === 'approve' ? t('code.review.suggestsAccepting') : t('code.review.requestsChanges')}{review.summary ? ` — ${review.summary}` : ''}</>
      : t('code.pipeline.review.none')}</dd></div>
  </dl>;
}

/** The evidence and the collapsible sections behind the strip. */
export function PipelineDetails({ task }: { task: CodeTask }): JSX.Element | null {
  const t = useT();
  const pipeline = task.pipeline;
  if (!pipeline) return null;
  const n = task.revision?.n ?? (pipeline.evidence.length ? Math.max(...pipeline.evidence.map(e => e.revision)) : 1);
  const evidence = pipeline.evidence.find(e => e.revision === n);
  const earlier = pipeline.evidence.filter(e => e.revision < n).sort((a, b) => b.revision - a.revision);
  const audit = pipeline.audit;
  const plan = pipeline.plan?.plan;
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const constraints = Array.isArray(plan?.constraints) ? (plan.constraints as unknown[]).filter((c): c is string => typeof c === 'string') : [];
  return <div className="code-pipe-details-wrap">
    <section className="code-pipe-evidence" aria-label={t('code.pipeline.evidence.heading', { n })}>
      <h4>{t('code.pipeline.evidence.heading', { n })}</h4>
      {evidence ? <>
        <EvidenceFacts evidence={evidence}/>
        {evidence.tests && <TestOutput tests={evidence.tests}/>}
        {audit && audit.revision === n && <><h5>{t('code.pipeline.completeness')}</h5><Checks checks={audit.checks}/></>}
      </> : <p className="code-plan-note">{t('code.pipeline.evidence.none')}</p>}
    </section>
    {pipeline.plan && plan && <details className="code-output-details code-pipe-details">
      <summary>{t('code.pipeline.plan.heading')}</summary>
      {plan.goal && <p className="code-pipe-goal"><strong>{t('code.pipeline.plan.goal')}</strong> {plan.goal}</p>}
      {steps.length > 0 && <ol className="code-pipe-steps">{steps.map((step, i) => <li key={i}>
        {step.do}{step.done_when ? <span className="code-pipe-detail"><br/>{t('code.pipeline.plan.doneWhen', { text: step.done_when })}</span> : null}</li>)}</ol>}
      {constraints.length > 0 && <><h5>{t('code.pipeline.plan.constraints')}</h5><ul>{constraints.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
    </details>}
    <details className="code-output-details code-pipe-details">
      <summary>{t('code.pipeline.audit.heading')}</summary>
      {audit ? <>
        <p className="code-pipe-goal"><strong className={audit.overall === 'complete' ? 'code-pipe-pass' : 'code-pipe-fail'}>{t(`code.pipeline.audit.${audit.overall}` as MessageKey)}</strong>
          {' · '}{t('code.pipeline.revisionShort', { n: audit.revision })} · <code title={audit.headSha || undefined}>{shortSha(audit.headSha)}</code></p>
        {audit.writeUp?.summary && <p className="code-pipe-goal">{audit.writeUp.summary}</p>}
        <Checks checks={audit.checks}/>
        {!!audit.writeUp?.gaps?.length && <><h5>{t('code.pipeline.audit.gaps')}</h5><ul>{audit.writeUp.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></>}
        {!!audit.writeUp?.evidence?.length && <><h5>{t('code.pipeline.audit.evidence')}</h5>
          <ul>{audit.writeUp.evidence.map((e, i) => <li key={i}><code>{e.source}</code> — {e.note}</li>)}</ul></>}
      </> : <p className="code-plan-note">{t('code.pipeline.audit.none')}</p>}
    </details>
    {earlier.length > 0 && <details className="code-output-details code-pipe-details">
      <summary>{t('code.pipeline.earlier')} ({earlier.length})</summary>
      {earlier.map(e => <section key={e.revision} className="code-pipe-earlier" aria-label={t('code.pipeline.revision', { n: e.revision })}>
        <h5>{t('code.pipeline.revision', { n: e.revision })}</h5>
        <EvidenceFacts evidence={e}/>
        {e.tests && <TestOutput tests={e.tests}/>}
      </section>)}
    </details>}
  </div>;
}

/** What a pipeline task's accept card adds: verdict, audit, evidence. Null for any other card. */
export function AcceptSummary({ approval }: { approval: CodeApproval }): JSX.Element | null {
  const t = useT();
  const { verdict, audit, evidence } = approval;
  if (!verdict && !audit && !evidence) return null;
  return <dl className="code-pipe-facts code-pipe-accept">
    {verdict && !approval.review && <div><dt>{t('code.pipeline.review')}</dt><dd>
      {verdict.verdict === 'approve' ? t('code.review.suggestsAccepting') : t('code.review.requestsChanges')}{verdict.summary ? ` — ${verdict.summary}` : ''}
      {typeof verdict.findings === 'number' && verdict.findings > 0 && ` · ${t.plural('code.pipeline.accept.findings', verdict.findings)}`}</dd></div>}
    {audit && <div><dt>{t('code.pipeline.audit.heading')}</dt><dd>
      <strong className={audit.overall === 'complete' ? 'code-pipe-pass' : 'code-pipe-fail'}>{t(`code.pipeline.audit.${audit.overall}` as MessageKey)}</strong>
      {audit.writeUp?.summary ? ` — ${audit.writeUp.summary}` : ''}
      <Checks checks={audit.checks}/></dd></div>}
    {evidence && <div><dt>{t('code.pipeline.accept.evidence')}</dt><dd>
      {t('code.pipeline.revisionShort', { n: evidence.revision })} · <code title={evidence.headSha || undefined}>{shortSha(evidence.headSha)}</code> · <TestsLine tests={evidence.tests}/></dd></div>}
  </dl>;
}

/** The accept button's words: merging into the base branch, or accepting without a merge. */
export function acceptLabel(t: Translate, approval: CodeApproval): string {
  if (!approval.audit && !approval.evidence && !approval.verdict) return t('code.review.accept');
  return approval.merge ? t('code.pipeline.accept.merge', { into: approval.merge.into }) : t('code.pipeline.accept.only');
}
/** What accepting will do, in words, for a pipeline accept card: replaces the raw payload (kept collapsed below). */
export function AcceptWhat({ approval }: { approval: CodeApproval }): JSX.Element | null {
  const t = useT();
  if (!isPipelineCard(approval)) return null;
  const args = (approval.arguments && typeof approval.arguments === 'object' ? approval.arguments : {}) as { branch?: string; baseSha?: string; headSha?: string; files?: unknown[] };
  const branch = args.branch || '—';
  const into = approval.merge?.into;
  const files = Array.isArray(args.files) ? args.files.length : 0;
  const failing = (approval.audit?.checks || []).filter(c => c.status !== 'pass');
  const withheld = approval.mergeWithheld;
  return <>
    <p className="code-pipe-what">{into
      ? t('code.pipeline.accept.mergeNote', { branch, into, sha: shortSha(args.headSha) })
      : t('code.pipeline.accept.onlyNote', { branch, sha: shortSha(args.headSha) })}</p>
    <dl className="code-pipe-facts">
      <div><dt>{t('code.pipeline.accept.branch')}</dt><dd><code>{branch}</code>{into ? <> → <code>{into}</code></> : null}</dd></div>
      <div><dt>{t('code.pipeline.accept.reviewed')}</dt><dd><code title={args.headSha}>{shortSha(args.headSha)}</code></dd></div>
      <div><dt>{t('code.pipeline.base')}</dt><dd><code title={args.baseSha}>{shortSha(args.baseSha)}</code></dd></div>
      {files > 0 && <div><dt>{t('code.pipeline.accept.files')}</dt><dd>{files}</dd></div>}
    </dl>
    {withheld && <div className="code-pipe-withheld" role="group" aria-label={t('code.pipeline.accept.withheld')}>
      <p className="code-pipe-withheld-title">{t('code.pipeline.accept.withheld')}</p>
      {withheld.code === 'audit_incomplete' && failing.length > 0
        ? <ul>{failing.map(c => <li key={c.name}>{byId(t, `code.pipeline.check.${c.name}`, c.name)} — {byId(t, `code.pipeline.check.${c.status}`, c.status)}</li>)}</ul>
        : <p className="code-pipe-reason">{withheld.reason}</p>}
    </div>}
  </>;
}
export const isPipelineCard = (approval: CodeApproval): boolean => !!(approval.audit || approval.evidence || approval.verdict);
