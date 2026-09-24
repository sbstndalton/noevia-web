import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cancelTask, decideTask, fetchTask } from './code/api';
import type { CodeTask } from './code/api';
import { ApprovalCard } from './code/CodePanel';
import { isDecisionStale } from './code/decision-guard';
import { TASK_FINAL } from '../chat-mode';
import type { CoworkTaskRef } from '../types';

const STATUS_LABEL: Record<CodeTask['status'], string> = {
  queued: 'Queued', running: 'Running', waiting_approval: 'Waiting for your approval', completed: 'Completed',
  failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted',
};

/**
 * A Cowork task inside the chat (#236): its status, latest steps and output, the existing
 * approval card (all three decisions, full arguments), Cancel while it runs, and Retry once it
 * failed or stopped. It follows the task by polling its own endpoint; nothing here decides.
 */
export function CoworkTaskCard({ task: ref, onRetry, disabled }: { task: CoworkTaskRef; onRetry: () => void; disabled: boolean }): JSX.Element {
  const [task, setTask] = useState<CodeTask | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef<CodeTask | null>(null);
  const load = useCallback(async () => {
    try { const next = await fetchTask(ref.projectId, ref.taskId); live.current = next; setTask(next); setError(''); return next; }
    catch (err) { setError(err instanceof Error ? err.message : 'Task status is unavailable.'); return null; }
  }, [ref.projectId, ref.taskId]);
  useEffect(() => {
    let stop = false, timer = 0;
    const tick = async () => {
      const next = await load();
      if (!stop && !(next && TASK_FINAL.has(next.status))) timer = window.setTimeout(tick, 2000);
    };
    void tick();
    return () => { stop = true; window.clearTimeout(timer); };
  }, [load]);
  const decide = async (decision: 'approve' | 'approve_all' | 'deny', approvalId: string) => {
    if (isDecisionStale(live.current?.approval?.id ?? null, approvalId)) { setError('That approval already changed — refreshing.'); void load(); return; }
    setBusy(true);
    try { await decideTask(ref.projectId, ref.taskId, approvalId, decision); }
    catch (err) { setError(err instanceof Error ? err.message : 'The decision did not save.'); }
    finally { setBusy(false); void load(); }
  };
  const cancel = async () => {
    setBusy(true);
    try { setTask(await cancelTask(ref.projectId, ref.taskId)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Cancel failed.'); }
    finally { setBusy(false); }
  };
  const final = !!task && TASK_FINAL.has(task.status);
  const output = task?.assistantOutput?.text?.trim() || '';
  return <section className="cowork-task" aria-label={`Cowork task in ${ref.repository}`} aria-busy={!final}>
    <header className="cowork-task-head">
      <span className="cowork-task-title">Cowork task · {ref.repository}</span>
      <span className="cowork-task-status" data-status={task?.status ?? 'loading'} role="status">{task ? STATUS_LABEL[task.status] : 'Loading…'}</span>
    </header>
    {task?.stage && !final && <p className="cowork-task-note">{task.stage}</p>}
    {task && task.steps.length > 0 && <ol className="cowork-task-steps">
      {task.steps.slice(-5).map(step => <li key={step.id} data-status={step.status}>{step.title}</li>)}
    </ol>}
    {output && <pre className="cowork-task-output">{output.length > 1200 ? `…${output.slice(-1200)}` : output}</pre>}
    {task?.approval && task.status === 'waiting_approval' && <ApprovalCard approval={task.approval} busy={busy} onDecide={(d, id) => void decide(d, id)} />}
    {task?.error && <p className="cowork-task-note" role="alert">{task.error}</p>}
    {error && <p className="cowork-task-note" role="alert">{error}</p>}
    <div className="cowork-task-actions">
      {task && !final && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void cancel()}>Cancel task</button>}
      {task && final && task.status !== 'completed' && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onRetry}>Retry as a new task</button>}
      {task?.branch && <span className="cowork-task-note">Branch <code>{task.branch}</code></span>}
    </div>
  </section>;
}
