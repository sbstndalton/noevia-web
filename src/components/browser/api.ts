import { apiFetch } from '../../api';

/** One browser action, in the same vocabulary as `server/browser-executor.cjs`. */
export type BrowserActionType = 'navigate' | 'click' | 'type' | 'select' | 'press' | 'upload'
  | 'submit' | 'extract' | 'screenshot' | 'scroll' | 'hover' | 'wait';
export interface BrowserAction {
  type: BrowserActionType; selector?: string; url?: string; text?: string; key?: string; file?: string;
}
export interface BrowserApproval {
  id: string; action: BrowserActionType | string; reason: string; origin: string;
  element: { tag: string; type: string; role: string; name: string; text: string } | null;
  url: string | null; typed: string | null; file: string | null;
  screenshot?: string; screenshotOmitted?: boolean; screenshotOmissionReason?: string;
}
export interface BrowserTask {
  id: string; status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  stage: string | null; error: string | null; createdAt: number; updatedAt: number;
  domains: string[]; capabilities: string[]; steps: { id: string; title: string; status: string }[];
  approval: BrowserApproval | null;
  result: unknown;
}
export interface BrowserState {
  capabilities: string[];
  /** False when the server has no egress proxy: a task cannot open at all. */
  network: boolean;
  tasks: BrowserTask[];
}
export interface BrowserActionResult {
  status: 'done' | 'blocked' | 'uncertain'; origin: string; reason?: string;
  evidence?: { text?: string; screenshot?: string; screenshotOmitted?: boolean };
}

async function read<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty */ }
  if (!response.ok) throw Object.assign(new Error((body as { error?: string } | null)?.error || `Request failed (${response.status})`), { status: response.status });
  return body as T;
}
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/browser`;
const post = (url: string, body?: unknown) => apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const fetchBrowser = (projectId: string) => apiFetch(base(projectId)).then(r => read<BrowserState>(r));
export const startBrowserTask = (projectId: string, domains: string[]) => post(base(projectId), { domains }).then(r => read<{ taskId: string; domains: string[] }>(r));
export const fetchBrowserTask = (projectId: string, id: string) => apiFetch(`${base(projectId)}/${id}`).then(r => read<BrowserTask>(r));
export const runBrowserAction = (projectId: string, id: string, action: BrowserAction) => post(`${base(projectId)}/${id}/act`, action).then(r => read<BrowserActionResult>(r));
/** Answers one named approval. A 409 means that card is gone: refresh and show what is waiting now. */
export const decideBrowserTask = (projectId: string, id: string, approvalId: string, decision: 'approve' | 'approve_all' | 'deny') =>
  post(`${base(projectId)}/${id}/approve`, { decision, approvalId }).then(r => read<{ ok: true }>(r));
export const finishBrowserTask = (projectId: string, id: string, result: unknown = null) => post(`${base(projectId)}/${id}/finish`, { result }).then(r => read<{ ok: true }>(r));
export const cancelBrowserTask = (projectId: string, id: string) => post(`${base(projectId)}/${id}/cancel`).then(r => read<BrowserTask>(r));
