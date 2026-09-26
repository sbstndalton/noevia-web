import { useEffect, useState } from 'react';
import { apiFetch } from '../../api';
import { parseActiveTasks } from './active-tasks';
import type { ActiveTask } from './active-tasks';
export type { ActiveTask } from './active-tasks';

/** One scoped request covers every project; the server includes only this administrator's live
 *  tasks. Shared by the header's `ActiveCodeTasks` widget and the Code-mode sidebar (#415), so
 *  moving this logic here (rather than duplicating the fetch/poll loop) keeps them reading the
 *  same state the same way.
 *
 *  `enabled` lets a caller that is not always showing task data (the sidebar, only in Code mode)
 *  skip the request and its poll entirely rather than running it — and paying for it — everywhere
 *  the component using it happens to be mounted. */
export function useActiveCodeTasks(enabled: boolean) {
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || unavailable) return;
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
        const body = await response.json().catch(() => null);
        const { tasks: valid, total: count } = parseActiveTasks(body);
        if (live) { setTasks(valid); setTotal(count); setError(''); }
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
  }, [enabled, tasks.length, unavailable, revision]);
  return { tasks, total, error, unavailable, retry: () => setRevision((value) => value + 1) };
}
