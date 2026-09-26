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
