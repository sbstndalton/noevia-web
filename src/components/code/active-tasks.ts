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
/** How long a task the person has just answered is shown as answered, whatever a lagging poll still says: a cancelled task is gone,
 *  an allowed or declined one is running again. After this the server's own answer is shown as it is (a second request can wait). */
export const ANSWERED_HOLD_MS = 4000;
/** The tasks as the person sees them: `answered` maps task id -> { answer, at }; an entry older than ANSWERED_HOLD_MS no longer counts. */
export function applyAnswered(tasks: ActiveTask[], answered: ReadonlyMap<string, { answer: CodeTaskAnswer['answer']; at: number }>, now: number): ActiveTask[] {
  return tasks.flatMap((task) => {
    const mark = answered.get(task.id);
    if (!mark || now - mark.at >= ANSWERED_HOLD_MS) return [task];
    if (mark.answer === 'cancel') return [];
    return [task.status === 'waiting_approval' ? { ...task, status: 'running' as const, approvalAction: null } : task];
  });
}
