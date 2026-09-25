import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import './active-code-tasks.css';

interface ActiveTask {
  id: string; projectId: string; projectName: string; title: string | null;
  status: 'queued' | 'running' | 'waiting_approval'; stage: string | null; updatedAt: number;
  approvalAction: string | null;
}

/** One scoped request covers every project; the server includes only this administrator's live tasks. */
export function ActiveCodeTasks({ onOpenProject }: { onOpenProject: (id: string) => void }): JSX.Element | null {
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (unavailable) return;
    let live = true;
    let timer: number | undefined;
    let pending = false;
    const load = async () => {
      if (!live || pending || document.hidden || !navigator.onLine) return;
      pending = true;
      try {
        const response = await apiFetch('/api/code/active');
        if (response.status === 403 || response.status === 404) { if (live) { setUnavailable(true); setTasks([]); setTotal(0); } return; }
        if (!response.ok) throw new Error(`Task status unavailable (${response.status})`);
        const result = await response.json().catch(() => null) as { tasks?: unknown; total?: unknown } | null;
        // A malformed body is a status error, never a crash of the whole shell.
        if (!result || !Array.isArray(result.tasks)) throw new Error('Task status unavailable');
        const valid = (result.tasks as ActiveTask[]).filter((task) => task && typeof task.id === 'string' && typeof task.projectId === 'string');
        if (live) { setTasks(valid); setTotal(typeof result.total === 'number' ? result.total : valid.length); setError(''); }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'Task status unavailable');
      } finally { pending = false; }
    };
    const wake = () => { if (!document.hidden && navigator.onLine) void load(); };
    void load();
    // One bounded request for all projects. Hidden/offline tabs pause and refresh on return.
    timer = window.setInterval(wake, tasks.length ? 15000 : 45000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => { live = false; if (timer) window.clearInterval(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
  }, [tasks.length, unavailable, revision]);

  if (unavailable || (!tasks.length && !error)) return null;
  const waiting = tasks.filter((task) => task.status === 'waiting_approval').length;
  return <aside className="active-code-entry" aria-label="Active Code tasks">
    <details>
      <summary>{error ? 'Code task status unavailable' : waiting ? `${waiting} Code ${waiting === 1 ? 'task needs' : 'tasks need'} your decision` : `${tasks.length} active Code ${tasks.length === 1 ? 'task' : 'tasks'}`}</summary>
      {error && <p role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></p>}
      {total > tasks.length && <p>Showing {tasks.length} of {total} active tasks. Open a project’s Code tab for its complete task list.</p>}
      {tasks.length > 0 && <ul>{tasks.map((task) => <li key={task.id}>
        <span><strong>{task.projectName}</strong> · {task.status === 'waiting_approval' ? `Waiting for your decision${task.approvalAction ? `: ${task.approvalAction.replaceAll('_', ' ')}` : ''}` : task.stage || (task.status === 'queued' ? 'Queued' : 'Running')}</span>
        <small>{task.title || 'Code task'}</small>
        <button type="button" onClick={() => onOpenProject(task.projectId)}>Open {task.projectName} · Code tab</button>
      </li>)}</ul>}
    </details>
  </aside>;
}
