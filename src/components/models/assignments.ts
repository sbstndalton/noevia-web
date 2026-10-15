// #1662: what each model-backed service uses (GET /api/models/assignments), and the one write
// the overview and the delete flow share: switching the embedding model (#1636's
// POST /api/embedding migration: set-next → switch → finish). Kept React-free.
import { apiFetch } from '../../api';

export type ServiceId = 'embedding' | 'reranker' | 'decision' | 'sensitivity' | 'ocr' | 'documents';
/** 'unloaded' (#1795): embedding only, its model is installed but not loaded, as its card says. */
export type ServiceState = 'active' | 'switching' | 'missing' | 'off' | 'unloaded';
export interface ServiceAssignment {
  id: ServiceId; model: string | null; state: ServiceState; canChange: boolean;
  next?: string; ready?: boolean;
  /** Admins only. Embedding: { model, profile }; reranker: names. */
  options?: (string | { model: string; profile: string; served?: boolean })[];
  baseUrl?: string | null;
  /** #1668: noevia runs this embedding service itself, so a switch loads the model first. */
  managed?: boolean;
  /** #1668: admins only, managed service: "Turn embedding off" is possible now. */
  canTurnOff?: boolean;
  /** #1796, decision, admins only: 'admin' when the address saved in Settings replaces the deployment's. */
  source?: 'admin' | 'deployment';
  /** #1796, sensitivity: true when the check uses the decision service itself. */
  shared?: boolean;
  /** #1666, decision, admins only: 'admin' when the model was chosen in Settings; the ids that can be chosen and the deployment's. */
  modelSource?: 'admin';
  models?: string[];
  deploymentModel?: string;
  /** #1665, reranker, admins only: the runtime switch (never an address). */
  enabled?: boolean;
  choice?: string | null;
  choices?: RerankerChoice[];
}
/** #1665: a reranker this server can use: 'tei' or 'llamacpp:<preset>'. */
export interface RerankerChoice { id: string; backend: 'tei' | 'llamacpp'; model: string }
export interface RerankerSettings { enabled: boolean; choice: string | null; source: 'admin' | 'deployment'; options: RerankerChoice[] }
/** #1816: the reranker choice to show and to send back. A saved choice is kept even when it is not in `choices` (a
 *  llama.cpp preset not currently offered); turning reranking off must not drop it. '' when nothing is saved. */
export const rerankerCurrent = (svc: Pick<ServiceAssignment, 'choice' | 'choices'>): string =>
  typeof svc.choice === 'string' && svc.choice && ((svc.choices || []).some((c) => c.id === svc.choice) || svc.choice.startsWith('llamacpp:')) ? svc.choice : '';

export interface Assignments { admin: boolean; services: ServiceAssignment[]; available?: boolean }

export async function fetchAssignments(): Promise<Assignments> {
  const r = await apiFetch('/api/models/assignments');
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  const v = await r.json() as Assignments;
  return { admin: v.admin === true, services: Array.isArray(v.services) ? v.services : [], available: v.available };
}

/** Embedding models a switch may target: only those the server reports a running embeddings
 *  endpoint really serves (#1660 review). A single-model sidecar serves only its own model, so a
 *  switch to anything else would embed with the wrong model; such options are never offered. */
export const embeddingOptions = (s: ServiceAssignment | undefined): { model: string; profile: string }[] =>
  (s?.options || []).filter((o): o is { model: string; profile: string; served: true } => typeof o === 'object' && !!o && typeof o.model === 'string' && (o as { served?: unknown }).served === true);

/** How the Diary's half of a step went. 'none': no Diary on this server. */
export type DiaryHalf = 'ok' | 'pending' | 'failed' | 'none';
/** 'done': search uses the new model everywhere; 'reindexing': the projects are still building it;
 *  'diaryPending' / 'diaryFailed': the projects switched but the Diary is still re-indexing, or
 *  refused (#1668 review: a 207 is not a full success). */
export type SwitchOutcome = 'done' | 'reindexing' | 'diaryPending' | 'diaryFailed';

type EmbedReply = { projects?: { error?: string; code?: string }; diary?: { error?: string; code?: string } };
export function diaryHalf(diary: EmbedReply['diary']): DiaryHalf {
  if (!diary) return 'none';
  if (!diary.error) return 'ok';
  if (diary.code === 'notConfigured') return 'none';
  return diary.code === 'notReady' ? 'pending' : 'failed';
}
async function embeddingAction(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; code?: string; error?: string; diary: DiaryHalf; diaryError?: string }> {
  const r = await apiFetch('/api/embedding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const v = await r.json().catch(() => ({})) as EmbedReply & { error?: string };
  // 207: one half refused. The projects half decides whether the step went on; the Diary's half is
  // reported with it, never counted as success.
  const projectsError = v.projects?.error;
  return { ok: (r.ok || r.status === 207) && !projectsError, status: r.status, code: v.projects?.code, error: projectsError || v.error, diary: diaryHalf(v.diary), diaryError: v.diary?.error };
}

/** The outcome of a switch whose projects half finished, given the Diary's half of each step. */
export function finished(steps: { diary: DiaryHalf }[]): SwitchOutcome {
  if (steps.some((s) => s.diary === 'failed')) return 'diaryFailed';
  if (steps.some((s) => s.diary === 'pending')) return 'diaryPending';
  return 'done';
}

/**
 * Switches the embedding service to `target`. Resolves 'done' when search now uses it (the old
 * model is free to delete), 'reindexing' when the re-index has started but is not finished yet.
 */
export async function switchEmbedding(target: { model: string; profile: string }, baseUrl: string | null | undefined): Promise<SwitchOutcome> {
  const next = await embeddingAction({ action: 'set-next', target: { baseUrl: baseUrl ?? '', model: target.model, profile: target.profile } });
  if (!next.ok && next.code !== 'alreadyActive') throw Error(next.error || `HTTP ${next.status}`);
  const sw = await embeddingAction({ action: 'switch' });
  if (!sw.ok) {
    if (sw.code === 'notReady') return 'reindexing';
    throw Error(sw.error || `HTTP ${sw.status}`);
  }
  const fin = await embeddingAction({ action: 'finish' });
  if (!fin.ok) throw Error(fin.error || `HTTP ${fin.status}`);
  return finished([next, sw, fin]);
}

/**
 * #1668: switches a managed embedding service to `target`: noevia (re)starts the service with it,
 * waits until it reports the model loaded, then re-indexes. 'done' when search now uses it (the
 * old model is freed once the service has dropped it), 'reindexing' when the re-index is still
 * running. Also turns embedding back on from off.
 */
export async function serviceSwitchEmbedding(target: { model: string; profile: string }): Promise<SwitchOutcome> {
  const r = await embeddingAction({ action: 'service-switch', model: target.model, profile: target.profile });
  if (!r.ok) throw Error(r.error || `HTTP ${r.status}`);
  const st = await embeddingAction({ action: 'switch' });
  if (!st.ok) {
    if (st.code === 'notReady') return 'reindexing';
    if (st.code === 'noNext') return finished([r]); // back on with the model the vectors already belong to
    throw Error(st.error || `HTTP ${st.status}`);
  }
  const fin = await embeddingAction({ action: 'finish' });
  if (!fin.ok) throw Error(fin.error || `HTTP ${fin.status}`);
  return finished([r, st, fin]);
}

/** #1668: stops the managed embedding service. Search and the Diary then say embedding is off. */
export async function turnEmbeddingOff(): Promise<void> {
  const r = await apiFetch('/api/embedding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'service-off' }) });
  if (!r.ok) {
    const v = await r.json().catch(() => ({})) as { error?: string };
    throw Error(v.error || `HTTP ${r.status}`);
  }
}

/** Finishes a switch that was re-indexing (the overview's "Finish switch"). */
export async function finishEmbeddingSwitch(): Promise<SwitchOutcome> {
  const sw = await embeddingAction({ action: 'switch' });
  if (!sw.ok) { if (sw.code === 'notReady') return 'reindexing'; throw Error(sw.error || `HTTP ${sw.status}`); }
  const fin = await embeddingAction({ action: 'finish' });
  if (!fin.ok) throw Error(fin.error || `HTTP ${fin.status}`);
  return finished([sw, fin]);
}

/** #1665: the reranker's runtime switch (admins only; the server refuses anyone else). */
async function rerankerRequest(method: 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<RerankerSettings> {
  const r = await apiFetch('/api/models/reranker', { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const v = await r.json().catch(() => ({})) as RerankerSettings & { error?: string; errorId?: string };
  if (!r.ok) throw Object.assign(Error(v.error || `HTTP ${r.status}`), { id: v.errorId });
  return v;
}
export const saveReranker = (enabled: boolean, choice: string | null): Promise<RerankerSettings> => rerankerRequest('PUT', { enabled, choice });
/** Back to the deployment's reranker configuration ("Use deployment default"). */
export const resetReranker = (): Promise<RerankerSettings> => rerankerRequest('DELETE');
