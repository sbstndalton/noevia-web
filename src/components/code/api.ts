import { apiFetch } from '../../api';
import { cached } from '../../request-cache';

/** noevia's own action classes, as `server/code-actions.cjs` names them. */
export type CodeAction = 'read_repository' | 'edit_file' | 'execute_command' | 'install_dependency'
  | 'network' | 'delete' | 'git_push' | 'open_browser' | 'external_account' | 'none'
  /** The final card of a Planner-reviewed task (#519): accept the change. Never an agent's action. */
  | 'review_change'
  /** The optional plan card of a pipeline task (#705): approve the Planner's plan before any code runs. */
  | 'approve_plan';

/** The Planner's verdict on a finished change (#519), as `server/code-review-verdict.cjs` bounds it. */
export interface CodeReview {
  status: 'pending' | 'completed' | 'failed';
  /** 'astra': an approval card recorded before the 2026-09-29 role rename. */
  reviewer: 'planner' | 'astra'; baseSha: string | null; headSha: string | null;
  verdict?: 'approve' | 'request_changes'; summary?: string;
  findings?: { severity: 'blocker' | 'major' | 'minor' | 'note'; file?: string; message: string }[];
  corrected?: boolean; code?: string; reason?: string; files?: number | null;
}

export interface CodeApproval {
  id: string; action: CodeAction; title: string; kind: string; command: string; paths: string[];
  reason: string; arguments: unknown; diff: { path: string; oldText: string | null; newText: string | null } | null;
  /** Only on a `review_change` card: the verdict, or why there is none. */
  review?: CodeReview | null;
  /** Only on a pipeline task's accept card (#705/#706). */
  verdict?: { verdict?: 'approve' | 'request_changes'; summary?: string; findings?: number } | null;
  audit?: { overall: 'complete' | 'incomplete'; checks: { name: string; status: PipelineCheckStatus }[]; writeUp: { completeness?: string; summary?: string } | null } | null;
  evidence?: { revision: number; headSha: string | null; planHash: string | null; tests: PipelineTests | null; completeness: { reportHash: string } | null } | null;
  /** Null: accept only, nothing is merged. */
  merge?: { into: string; from: string; to: string } | null;
  /** Why an enabled merge is not offered on this card (`audit_incomplete`, `checked_out`, `base_moved`, …). */
  mergeWithheld?: { code: string; reason: string } | null;
  /** On an `approve_plan` card. */
  plan?: unknown;
}

export type PipelineLifecycle = 'planned' | 'implementing' | 'verifying' | 'reviewing' | 'changes_requested' | 'merged' | 'blocked';
export type PipelineCheckStatus = 'pass' | 'fail' | 'unknown';
/** The verifier's measured report. `tail` is untrusted command output: render it as text only. */
export interface PipelineTests {
  passed: boolean; exitCode: number | null; signal: string | null; timedOut: boolean; headSha: string | null;
  durationMs: number | null; tail: string; truncated: boolean;
}
export interface PipelineEvidence {
  revision: number; headSha: string | null; baseSha: string | null; planHash: string | null;
  tests: PipelineTests | null;
  review: { verdict: 'approve' | 'request_changes'; summary?: string; findings?: { severity: string; file?: string; message: string }[]; headSha?: string | null } | null;
  completeness: { reportHash: string } | null;
}
export interface PipelineAudit {
  revision: number; headSha: string | null; overall: 'complete' | 'incomplete';
  checks: { name: string; status: PipelineCheckStatus; detail?: string }[]; evidence?: unknown;
  writeUp: { completeness?: string; summary?: string; evidence?: { source: string; note: string }[]; gaps?: string[] } | null;
}
/** Present only on a pipeline task (`codePipeline`); any other task's view has none of these. */
export interface PipelineView {
  maxLoops: number; merge: boolean;
  plan: { revision: number; planHash: string; plan: { goal?: string; steps?: { n?: number; do?: string; done_when?: string }[]; constraints?: unknown } | null } | null;
  evidence: PipelineEvidence[]; audit: PipelineAudit | null;
}
export interface PipelineStageMove { from: PipelineLifecycle | null; to: PipelineLifecycle; revision: number; reason?: string; reportHash?: string; at: number }
export interface CodeTask {
  id: string; status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  stage: string | null; error: string | null; createdAt: number; updatedAt: number;
  task: string | null; branch: string | null;
  capabilities: CodeAction[]; steps: { id: string; title: string; status: string }[];
  /** Latest plan event reported by the harness; entries have no completion state. */
  plan: { status: 'proposed' | 'edited' | 'skipped'; subQuestions: string[]; truncated: boolean } | null;
  /** Bounded visible ACP assistant text; it may be partial when the task stops. */
  assistantOutput: { text: string; truncated: boolean } | null;
  approval: CodeApproval | null;
  /** What the harness reported about the run — and, in `limitations`, what it did not. */
  meta: {
    harness: string | null; harnessVersion: string | null; protocolVersion: number | null;
    usage: { input: number | null; output: number | null; total: number | null } | null;
    /** How full the model's window got — not the same thing as tokens spent. */
    context: { used: number; size: number; percent: number } | null;
    commands: number; failedCommands: number; messageChunks: number; limitations: string[];
  } | null;
  identityHash: string | null;
  lifecycle?: PipelineLifecycle | null;
  revision?: { n: number; headSha: string | null; planHash: string | null; at: number } | null;
  stages?: PipelineStageMove[];
  pipeline?: PipelineView;
  /** Present only on a task that was reviewed (features.plannerReview). */
  review?: CodeReview;
  result: { stopReason?: string; branch?: string; tools?: number; approvals?: number; allowed?: number; refused?: number; denied?: number;
    network?: NetworkActivity;
    review?: { reviewed: boolean; verdict: 'approve' | 'request_changes' | null; accepted: boolean; decision: string; headSha: string | null } } | null;
}
export interface Harness { id: string; label: string; version: string | null }
export interface PreparationMode { id: string; label: string; available: boolean; reason: string }
export interface CodeState {
  repositories: { id: string }[]; capabilities: CodeAction[]; defaultCapabilities: CodeAction[];
  harnesses: Harness[]; promptPreparation: PreparationMode[]; sandboxed: boolean;
  /** False when the server has no egress proxy: a task can then have no network at all. */
  network?: boolean; tasks: CodeTask[];
}
export interface StartTask {
  repository: string; prompt: string; capabilities: CodeAction[]; domains: string[];
  harness?: string; promptPreparation?: string;
}

async function read<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty */ }
  if (!response.ok) throw Object.assign(new Error((body as { error?: string } | null)?.error || `Request failed (${response.status})`), { status: response.status });
  return body as T;
}
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/code`;
const post = (url: string, body?: unknown) => apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const fetchCode = (projectId: string) => apiFetch(base(projectId)).then(r => read<CodeState>(r));
/** #458: `useCodeAccess` mounts once from `CodingWorkspace` and once from `Sidebar` on the same
 *  `/code` load, each independently calling `fetchCode(projectId)` to answer the same yes/no
 *  question for the same id — doubling every request in the probe sequence #450 already
 *  documented. `cached()` (request-cache.ts, the same mechanism #425 gave
 *  fetchProfile/fetchFeatureFlags) shares one in-flight/settled probe per project id between
 *  them, so `/code` makes exactly one `/api/projects/<id>/code` request per id, not two.
 *  `fetchCode` itself stays uncached: `CodePanel`'s own polling of task status needs a fresh
 *  answer every call, not a briefly-stale one. */
export const fetchCodeAccess = (projectId: string) => cached(`noevia:code-access:${projectId}`, () => fetchCode(projectId));
export const startTask = (projectId: string, body: StartTask) => post(base(projectId), body).then(r => read<{ taskId: string; branch: string }>(r));
export const fetchTask = (projectId: string, id: string) => apiFetch(`${base(projectId)}/${id}`).then(r => read<CodeTask>(r));
export const cancelTask = (projectId: string, id: string) => post(`${base(projectId)}/${id}/cancel`).then(r => read<CodeTask>(r));
/** Answers one named approval. A 409 means that card is gone: refresh and show what is waiting now. */
export const decideTask = (projectId: string, id: string, approvalId: string, decision: 'approve' | 'approve_all' | 'deny') =>
  post(`${base(projectId)}/${id}/approve`, { decision, approvalId }).then(r => read<{ ok: true }>(r));

/** What a networked task reached through the egress proxy, and what it was refused, by host. */
export type NetworkActivity = {
  allowed: number; refused: number;
  hosts: { host: string; allowed: number; refused: number; reason: string | null }[];
};
