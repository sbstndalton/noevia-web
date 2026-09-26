import type { JSX } from 'react';
import './active-code-tasks.css';
import { useActiveCodeTasks } from './useActiveCodeTasks';

/** The always-on header widget. Its fetch/poll loop now lives in `useActiveCodeTasks` (#415), so
 *  the Code-mode sidebar's own "TASKS" section can read the same live state without a second,
 *  divergent implementation. */
export function ActiveCodeTasks({ onOpenProject }: { onOpenProject: (id: string) => void }): JSX.Element | null {
  const { tasks, total, error, unavailable, retry } = useActiveCodeTasks(true);
  if (unavailable || (!tasks.length && !error)) return null;
  const waiting = tasks.filter((task) => task.status === 'waiting_approval').length;
  return <aside className="active-code-entry" aria-label="Active Code tasks">
    <details>
      <summary>{error ? 'Code task status unavailable' : waiting ? `${waiting} Code ${waiting === 1 ? 'task needs' : 'tasks need'} your decision` : `${tasks.length} active Code ${tasks.length === 1 ? 'task' : 'tasks'}`}</summary>
      {error && <p role="alert">{error} <button type="button" onClick={retry}>Retry</button></p>}
      {total > tasks.length && <p>Showing {tasks.length} of {total} active tasks. Open a project’s Code tab for its complete task list.</p>}
      {tasks.length > 0 && <ul>{tasks.map((task) => <li key={task.id}>
        <span><strong>{task.projectName}</strong> · {task.status === 'waiting_approval' ? `Waiting for your decision${task.approvalAction ? `: ${task.approvalAction.replaceAll('_', ' ')}` : ''}` : task.stage || (task.status === 'queued' ? 'Queued' : 'Running')}</span>
        <small>{task.title || 'Code task'}</small>
        <button type="button" onClick={() => onOpenProject(task.projectId)}>Open {task.projectName} · Code tab</button>
      </li>)}</ul>}
    </details>
  </aside>;
}
