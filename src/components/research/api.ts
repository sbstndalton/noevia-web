import { apiFetch } from '../../api';

export interface ResearchBudget { maxWebCalls: number; maxMs: number; resultsPerQuery: number }
export interface ResearchJob {
  id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; stage: string | null;
  plan: { status: 'proposed' | 'edited' | 'skipped'; question: string | null; subQuestions: string[] } | null; error: string | null;
  createdAt: number; updatedAt: number; checkpoint: { step: number; question: string } | null; artifacts: string[];
  result: { question: string; partial: boolean; sections: number; questions: number; citationValidity: number; citations: number; webCalls: number; markdown: string; sources: number } | null;
  canSavePartial: boolean;
}
export interface ResearchState { budget: ResearchBudget; available: boolean; reason: string | null; jobs: ResearchJob[] }

async function read<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty */ }
  if (!response.ok) throw Object.assign(new Error((body as { error?: string } | null)?.error || `Request failed (${response.status})`), { status: response.status });
  return body as T;
}
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/research`;
const post = (url: string, body?: unknown) => apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const fetchResearch = (projectId: string) => apiFetch(base(projectId)).then(r => read<ResearchState>(r));
export const proposePlan = (projectId: string, question: string) => post(`${base(projectId)}/plan`, { question }).then(r => read<{ subQuestions: string[] }>(r)).then(b => b.subQuestions);
export const startResearch = (projectId: string, body: { question: string; plan: 'skipped' | 'proposed' | 'edited'; subQuestions?: string[] }) => post(base(projectId), body).then(r => read<ResearchJob>(r));
export const cancelResearch = (projectId: string, id: string) => post(`${base(projectId)}/${id}/cancel`).then(r => read<ResearchJob>(r));
export const savePartialResearch = (projectId: string, id: string) => post(`${base(projectId)}/${id}/save`).then(r => read<ResearchJob>(r));
