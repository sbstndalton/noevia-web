import { apiFetch } from '../../api';

/** noevia's own action classes, as `server/code-actions.cjs` names them. */
export type CodeAction = 'read_repository' | 'edit_file' | 'execute_command' | 'install_dependency'
  | 'network' | 'delete' | 'git_push' | 'open_browser' | 'external_account' | 'none';

export interface CodeApproval {
  id: string; action: CodeAction; title: string; kind: string; command: string; paths: string[];
  reason: string; arguments: unknown; diff: { path: string; oldText: string | null; newText: string | null } | null;
}
export interface CodeTask {
  id: string; status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  stage: string | null; error: string | null; createdAt: number; updatedAt: number;
  task: string | null; branch: string | null;
  capabilities: CodeAction[]; steps: { id: string; title: string; status: string }[];
  plan: { status: string; subQuestions: string[] } | null;
  approval: CodeApproval | null;
  /** What the harness reported about the run — and, in `limitations`, what it did not. */
  meta: {
    harness: string | null; harnessVersion: string | null; protocolVersion: number | null;
    usage: { input: number | null; output: number | null; total: number | null } | null;
    commands: number; failedCommands: number; turns: number; limitations: string[];
  } | null;
  identityHash: string | null;
  result: { stopReason?: string; branch?: string; tools?: number; approvals?: number; allowed?: number; refused?: number; denied?: number } | null;
}
export interface CodeState {
  repositories: { id: string }[]; capabilities: CodeAction[]; defaultCapabilities: CodeAction[]; tasks: CodeTask[];
}
export interface StartTask { repository: string; prompt: string; capabilities: CodeAction[]; domains: string[] }

async function read<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty */ }
  if (!response.ok) throw Object.assign(new Error((body as { error?: string } | null)?.error || `Request failed (${response.status})`), { status: response.status });
  return body as T;
}
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/code`;
const post = (url: string, body?: unknown) => apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const fetchCode = (projectId: string) => apiFetch(base(projectId)).then(r => read<CodeState>(r));
export const startTask = (projectId: string, body: StartTask) => post(base(projectId), body).then(r => read<{ taskId: string; branch: string }>(r));
export const cancelTask = (projectId: string, id: string) => post(`${base(projectId)}/${id}/cancel`).then(r => read<CodeTask>(r));
export const decideTask = (projectId: string, id: string, decision: 'approve' | 'approve_all' | 'deny') =>
  post(`${base(projectId)}/${id}/approve`, { decision }).then(r => read<{ ok: true }>(r));
