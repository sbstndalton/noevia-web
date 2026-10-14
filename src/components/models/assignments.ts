// #1662: what each model-backed service uses (GET /api/models/assignments), and the one write
// the overview and the delete flow share: switching the embedding model (#1636's
// POST /api/embedding migration: set-next → switch → finish). Kept React-free.
import { apiFetch } from '../../api';

export type ServiceId = 'embedding' | 'reranker' | 'decision' | 'ocr' | 'documents';
export type ServiceState = 'active' | 'switching' | 'missing' | 'off';
export interface ServiceAssignment {
  id: ServiceId; model: string | null; state: ServiceState; canChange: boolean;
  next?: string; ready?: boolean;
  /** Admins only. Embedding: { model, profile }; reranker: names. */
  options?: (string | { model: string; profile: string; served?: boolean })[];
  baseUrl?: string | null;
}
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

type EmbedReply = { projects?: { error?: string; code?: string }; diary?: { error?: string } };
async function embeddingAction(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; code?: string; error?: string }> {
  const r = await apiFetch('/api/embedding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const v = await r.json().catch(() => ({})) as EmbedReply & { error?: string };
  // 207: one half (usually an unconfigured Diary) refused; the projects half decides.
  const projectsError = v.projects?.error;
  return { ok: (r.ok || r.status === 207) && !projectsError, status: r.status, code: v.projects?.code, error: projectsError || v.error };
}

/**
 * Switches the embedding service to `target`. Resolves 'done' when search now uses it (the old
 * model is free to delete), 'reindexing' when the re-index has started but is not finished yet.
 */
export async function switchEmbedding(target: { model: string; profile: string }, baseUrl: string | null | undefined): Promise<'done' | 'reindexing'> {
  const next = await embeddingAction({ action: 'set-next', target: { baseUrl: baseUrl ?? '', model: target.model, profile: target.profile } });
  if (!next.ok && next.code !== 'alreadyActive') throw Error(next.error || `HTTP ${next.status}`);
  const sw = await embeddingAction({ action: 'switch' });
  if (!sw.ok) {
    if (sw.code === 'notReady') return 'reindexing';
    throw Error(sw.error || `HTTP ${sw.status}`);
  }
  const fin = await embeddingAction({ action: 'finish' });
  if (!fin.ok) throw Error(fin.error || `HTTP ${fin.status}`);
  return 'done';
}

/** Finishes a switch that was re-indexing (the overview's "Finish switch"). */
export async function finishEmbeddingSwitch(): Promise<'done' | 'reindexing'> {
  const sw = await embeddingAction({ action: 'switch' });
  if (!sw.ok) { if (sw.code === 'notReady') return 'reindexing'; throw Error(sw.error || `HTTP ${sw.status}`); }
  const fin = await embeddingAction({ action: 'finish' });
  if (!fin.ok) throw Error(fin.error || `HTTP ${fin.status}`);
  return 'done';
}
