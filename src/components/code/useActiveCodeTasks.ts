import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api';
import { ANSWERED_MAX_MS, CODE_TASK_ANSWERED, applyAnswered, parseActiveTasks } from './active-tasks';
import type { AnsweredMark, CodeTaskAnswer } from './active-tasks';
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
  /** True while the last poll failed; the caller words it in the interface language (#624). */
  const [error, setError] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [revision, setRevision] = useState(0);
  // #2599: tasks the person has just allowed, declined or cancelled; the server can lag a few seconds behind its own answer.
  const answered = useRef(new Map<string, AnsweredMark>());
  const lastTasks = useRef<ActiveTask[]>([]);
  lastTasks.current = tasks;
  // Ask again at once, a few more times while the server settles, and once more when the longest hold ends (each reload also repaints).
  useEffect(() => {
    if (!enabled) return;
    const timers: number[] = [];
    const answeredNow = (event: Event) => {
      const { taskId, answer } = (event as CustomEvent<CodeTaskAnswer>).detail ?? {};
      if (typeof taskId !== 'string') return;
      const now = Date.now();
      for (const [id, mark] of answered.current) if (now - mark.at >= ANSWERED_MAX_MS) answered.current.delete(id);
      answered.current.set(taskId, { answer, at: now, updatedAt: lastTasks.current.find((task) => task.id === taskId)?.updatedAt ?? null });
      setRevision((value) => value + 1);
      for (const delay of [1500, 4000, 8000, 14000, ANSWERED_MAX_MS + 50]) timers.push(window.setTimeout(() => setRevision((value) => value + 1), delay));
    };
    window.addEventListener(CODE_TASK_ANSWERED, answeredNow);
    return () => { timers.forEach((id) => window.clearTimeout(id)); window.removeEventListener(CODE_TASK_ANSWERED, answeredNow); };
  }, [enabled]);
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
        if (!response.ok) throw new Error('Task status unavailable');
        const body = await response.json().catch(() => null);
        const { tasks: valid, total: count } = parseActiveTasks(body);
        if (live) { setTasks(valid); setTotal(count); setError(false); }
      } catch {
        if (live) setError(true);
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
  const shown = applyAnswered(tasks, answered.current, Date.now());
  return { tasks: shown, total: Math.max(0, total - (tasks.length - shown.length)), error, unavailable, retry: () => setRevision((value) => value + 1) };
}
