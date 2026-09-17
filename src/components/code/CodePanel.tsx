import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { cancelTask, decideTask, fetchCode, startTask } from './api';
import type { CodeAction, CodeApproval, CodeState, CodeTask } from './api';
import { EmptyState } from '../EmptyState';
import { ShellIcon } from '../ShellIcon';
import './code.css';

const ACTIVE = new Set(['queued', 'running', 'waiting_approval']);
const STATUS: Record<CodeTask['status'], string> = {
  queued: 'Queued', running: 'Running', waiting_approval: 'Waiting for you',
  completed: 'Finished', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted',
};
/** Plain language for each action class, in the same words the approval card uses. */
export const ACTION_LABEL: Record<CodeAction, string> = {
  read_repository: 'Read the repository', edit_file: 'Edit files', execute_command: 'Run commands',
  install_dependency: 'Install dependencies', network: 'Reach the network', delete: 'Delete files',
  git_push: 'Push to git', open_browser: 'Open a browser', external_account: 'Use an external account', none: 'Nothing',
};

/** Code mode for one project (spec-agent-execution §3). Rendered only for admins with the feature on. */
export function CodePanel({ projectId }: { projectId: string }): JSX.Element {
  const [state, setState] = useState<CodeState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [prompt, setPrompt] = useState('');
  const [repository, setRepository] = useState('');
  const [capabilities, setCapabilities] = useState<CodeAction[] | null>(null);
  const [domains, setDomains] = useState('');

  const load = useCallback(() => fetchCode(projectId)
    .then(next => { setState(next); setCapabilities(current => current ?? next.defaultCapabilities); setRepository(current => current || next.repositories[0]?.id || ''); })
    .catch(e => setError((e as Error).message)), [projectId]);

  useEffect(() => { load(); }, [load]);
  const running = !!state?.tasks.some(t => ACTIVE.has(t.status));
  // A task that is waiting for an answer is polled faster: the person is looking at the card.
  useEffect(() => {
    if (!running) return;
    const waiting = state?.tasks.some(t => t.status === 'waiting_approval');
    const timer = window.setInterval(load, waiting ? 1000 : 2000);
    return () => window.clearInterval(timer);
  }, [running, state, load]);

  const act = async (label: string, work: () => Promise<unknown>) => {
    setBusy(label); setError('');
    try { await work(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const toggle = (action: CodeAction) => setCapabilities(list =>
    (list || []).includes(action) ? (list || []).filter(a => a !== action) : [...(list || []), action]);

  if (!state || !capabilities) return <div className="code-panel"><p className="code-note">{error || 'Loading Code mode…'}</p></div>;
  const needsDomains = capabilities.includes('network') || capabilities.includes('install_dependency');
  const noRepositories = state.repositories.length === 0;

  return <div className="code-panel">
    <section className="code-compose" aria-labelledby="code-heading">
      <div className="code-heading">
        <h2 id="code-heading">Code</h2>
        <p>Runs a coding harness in a git worktree of its own, on a branch of its own. Every edit, command,
          install, delete and push stops here for your answer first, with the arguments in full.</p>
      </div>
      {error && <p className="code-note is-error" role="alert">{error}</p>}
      {noRepositories && <p className="code-note" role="status">No repository is registered on this server. An administrator adds them with <code>CODE_REPOS</code>.</p>}

      <div className="code-field">
        <label htmlFor="code-repository">Repository</label>
        <select id="code-repository" value={repository} disabled={noRepositories || running || !!busy}
          onChange={e => setRepository(e.target.value)}>
          {state.repositories.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
        </select>
      </div>

      <div className="code-field">
        <label htmlFor="code-prompt">What should it do?</label>
        <textarea id="code-prompt" rows={3} maxLength={8000} value={prompt} disabled={noRepositories || running || !!busy}
          placeholder="Describe the task, as you would to a colleague who has the repository open."
          onChange={e => setPrompt(e.target.value)}/>
      </div>

      <fieldset className="code-capabilities">
        <legend>What this task may do</legend>
        <p className="code-note">Anything left off is refused outright, without asking you. Anything on still stops at an approval.</p>
        <div className="code-capability-list">
          {state.capabilities.map(action => <label key={action} className="code-capability">
            <input type="checkbox" checked={capabilities.includes(action)} disabled={running || !!busy} onChange={() => toggle(action)}/>
            <span>{ACTION_LABEL[action]}</span>
          </label>)}
        </div>
      </fieldset>

      {needsDomains && <div className="code-field">
        <label htmlFor="code-domains">Domains it may reach</label>
        <input id="code-domains" value={domains} disabled={running || !!busy} placeholder="registry.npmjs.org, pypi.org"
          onChange={e => setDomains(e.target.value)}/>
        <p className="code-note">Comma separated. Everything else is blocked at the proxy, not just discouraged.</p>
      </div>}

      <div className="code-actions">
        <button type="button" className="btn btn-primary" disabled={!prompt.trim() || !repository || running || !!busy}
          onClick={() => act('start', async () => {
            await startTask(projectId, { repository, prompt, capabilities,
              domains: domains.split(',').map(d => d.trim()).filter(Boolean) });
            setPrompt('');
          })}>{busy === 'start' ? 'Starting…' : 'Start task'}</button>
      </div>
      {running && <p className="code-note" role="status">One task runs per project at a time.</p>}
    </section>

    <section className="code-tasks" aria-label="Coding tasks">
      {state.tasks.length === 0
        ? <EmptyState icon="code" title="No tasks yet" compact>Describe a task above. Its branch stays in the repository when it finishes.</EmptyState>
        : state.tasks.map(task => <TaskCard key={task.id} task={task} busy={busy}
          onDecide={decision => act(`decide:${task.id}`, () => decideTask(projectId, task.id, decision))}
          onCancel={() => act(`cancel:${task.id}`, () => cancelTask(projectId, task.id))}/>)}
    </section>
  </div>;
}

function TaskCard({ task, busy, onDecide, onCancel }: {
  task: CodeTask; busy: string;
  onDecide: (decision: 'approve' | 'approve_all' | 'deny') => void; onCancel: () => void;
}): JSX.Element {
  const active = ACTIVE.has(task.status);
  return <article className={`code-task is-${task.status}`} aria-busy={active && !task.approval}>
    <header>
      <h3>{task.task || task.branch || 'Task'}</h3>
      <span className="code-status">{STATUS[task.status]}</span>
    </header>
    <p className="code-meta">{[task.branch, task.capabilities.map(a => ACTION_LABEL[a]).join(' · ')].filter(Boolean).join(' · ') || 'Read only'}</p>
    {task.stage && active && !task.approval && <p className="code-stage">{task.stage}</p>}
    {task.error && <p className="code-note is-error">{task.error}</p>}
    {task.approval && <ApprovalCard approval={task.approval} busy={busy.startsWith('decide:')} onDecide={onDecide}/>}
    {task.result && !active && <p className="code-meta">
      {task.result.tools ?? 0} tool calls · {task.result.allowed ?? 0} allowed · {task.result.refused ?? 0} declined · {task.result.denied ?? 0} refused by noevia
    </p>}
    {active && <div className="code-actions"><button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!!busy}>Cancel task</button></div>}
  </article>;
}

/**
 * The gate. Three distinct answers, and the arguments in full — never truncated, never
 * summarised — because seeing them IS the gate. There is no "never ask".
 */
function ApprovalCard({ approval, busy, onDecide }: {
  approval: CodeApproval; busy: boolean; onDecide: (decision: 'approve' | 'approve_all' | 'deny') => void;
}): JSX.Element {
  const standing = approval.action !== 'delete' && approval.action !== 'git_push';
  return <div className="code-approval" role="group" aria-label="Approval required">
    <p className="code-approval-title"><ShellIcon name="security" size={16}/>{ACTION_LABEL[approval.action]}{approval.title ? ` — ${approval.title}` : ''}</p>
    {approval.reason && <p className="code-note">{approval.reason}</p>}
    {approval.command && <pre className="code-approval-args" aria-label="Command">{approval.command}</pre>}
    {approval.diff && <pre className="code-approval-args" aria-label={`Changes to ${approval.diff.path}`}>{approval.diff.newText ?? ''}</pre>}
    {approval.arguments !== null && approval.arguments !== undefined &&
      <pre className="code-approval-args" aria-label="Arguments">{JSON.stringify(approval.arguments, null, 2)}</pre>}
    <div className="code-approval-actions">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide('approve')}>Allow once</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onDecide('deny')}>Decline</button>
      {standing && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDecide('approve_all')}>Allow for this task</button>}
    </div>
    {!standing && <p className="code-note">Deletes and pushes are asked every time.</p>}
  </div>;
}
