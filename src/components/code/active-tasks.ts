/** The shape `/api/code/active` answers with, shared by the header's ActiveCodeTasks widget and
 *  the Code-mode sidebar (#415) so the two surfaces never disagree about which tasks are live. */
export interface ActiveTask {
  id: string; projectId: string; projectName: string; title: string | null;
  status: 'queued' | 'running' | 'waiting_approval'; stage: string | null; updatedAt: number;
  approvalAction: string | null;
}

/** Validates and narrows a `/api/code/active` response body. A malformed body is a status error,
 *  never a crash of the whole shell. Throws so both callers' existing `catch` blocks (which set
 *  their own "unavailable" error text) handle it the same way a network failure would. */
export function parseActiveTasks(result: unknown): { tasks: ActiveTask[]; total: number } {
  const body = result as { tasks?: unknown; total?: unknown } | null;
  if (!body || !Array.isArray(body.tasks)) throw new Error('Task status unavailable');
  const valid = (body.tasks as ActiveTask[]).filter((task) => task && typeof task.id === 'string' && typeof task.projectId === 'string');
  return { tasks: valid, total: typeof body.total === 'number' ? body.total : valid.length };
}

/** Sent on `window` once the server has taken a decision or a cancel for a task (#2599), so the "needs your decision" banner and
 *  the sidebar list do not wait for their next poll to stop showing it. */
export const CODE_TASK_ANSWERED = 'noevia:code-task-answered';
export type CodeTaskAnswer = { taskId: string; answer: 'approve' | 'approve_all' | 'deny' | 'cancel' };
export function announceCodeTaskAnswer(detail: CodeTaskAnswer): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<CodeTaskAnswer>(CODE_TASK_ANSWERED, { detail }));
}
/** What the person answered and what the active list said about that task at that moment (`updatedAt` is the server's own clock for the
 *  task row; every task event moves it, so a row that still holds the same value has not caught up with the answer). */
export type AnsweredMark = { answer: CodeTaskAnswer['answer']; at: number; updatedAt: number | null };
/** With no row to compare, a task the person has just answered is shown as answered this long. */
export const ANSWERED_HOLD_MS = 4000;
/** With a row to compare, for as long as the server's row is unchanged, but never longer than this. */
export const ANSWERED_MAX_MS = 20000;
/** The tasks as the person sees them. A task they just answered is shown as answered (cancelled: gone; allowed or declined: running)
 *  while the server's row for it is still the one they answered, so a lagging poll cannot bring the banner back; the moment the row
 *  moves (a new request for a decision, a new stage, a finish) the server's answer is shown as it is. */
export function applyAnswered(tasks: ActiveTask[], answered: ReadonlyMap<string, AnsweredMark>, now: number): ActiveTask[] {
  return tasks.flatMap((task) => {
    const mark = answered.get(task.id);
    if (!mark) return [task];
    const age = now - mark.at;
    const unchanged = mark.updatedAt === null ? age < ANSWERED_HOLD_MS : age < ANSWERED_MAX_MS && task.updatedAt <= mark.updatedAt;
    if (!unchanged) return [task];
    if (mark.answer === 'cancel') return [];
    return [task.status === 'waiting_approval' ? { ...task, status: 'running' as const, approvalAction: null } : task];
  });
}
