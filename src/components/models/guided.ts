// Pure helpers for the guided model manager (#204): the "Will it fit?" estimate, its verdict and
// recommendation, the auto-tune pre-flight, role grouping and the recovery list. No fetches here,
// so tests/guided-model-manager.test.cjs covers every rule without a browser.
import { isChatGenerationModel } from '../../model-kind';
import { isSystemModel } from '../../model-system';

/** What /api/models/estimate returns (server/llamacpp-autoconfig.cjs estimateInputs). */
export type EstimateInputs = {
  model: string; budgetGib: number | null; chat: boolean; sizeable: boolean; arch: string; nativeCtx: number | null;
  modelGib: number; pinnedGib: number; reserveGib: number; safety: number; moe: boolean;
  rows: { ctx: number; kvQ8Gib: number }[]; current: { ctx: number | null; kv: string | null };
};
export type Hardware = { systemGB: number | null; gpus: { name: string; capacityGB: number | null; sharedGB: number | null }[] };
export type Verdict = 'fits' | 'tight' | 'no';

// Bytes per cache element, from llama.cpp's block layouts. q8_0 is what the server sized rows at.
export const KV_BYTES: Record<string, number> = { f16: 2, q8_0: 1.0625, q5_1: 0.75, q5_0: 0.6875, q4_1: 0.625, q4_0: 0.5625 };
/** #190: automatic choices never go below Q5. Q4 stays selectable in Advanced for experts. */
export const KV_FLOOR = 'q5_0';
export const KV_GUIDED = ['f16', 'q8_0', 'q5_1', 'q5_0'] as const;
export const belowKvFloor = (kv: string | null | undefined) => !!kv && kv in KV_BYTES && KV_BYTES[kv] < KV_BYTES[KV_FLOOR];
/** Headroom under which a fit is only "tight": 10% of the budget, at least 1 GiB. */
export const tightMargin = (budgetGib: number) => Math.max(1, budgetGib * 0.1);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which memory the estimate is compared with. A configured server budget wins; otherwise the
 *  largest GPU's dedicated plus shared memory (shared-memory APUs report most of it as shared),
 *  otherwise system RAM. Null when nothing is known: the panel then asks for a figure. */
export function budgetFor(serverBudget: number | null | undefined, hw: Hardware | null): { gib: number; source: string } | null {
  if (serverBudget && serverBudget > 0) return { gib: serverBudget, source: 'the configured inference memory budget' };
  const gpu = (hw?.gpus || []).map((g) => ({ g, total: (g.capacityGB || 0) + (g.sharedGB || 0) })).sort((a, b) => b.total - a.total)[0];
  if (gpu && gpu.total > 0) return { gib: gpu.total, source: `${gpu.g.name} (${gpu.g.sharedGB ? 'dedicated + shared' : 'dedicated'} memory)` };
  if (hw?.systemGB) return { gib: hw.systemGB, source: 'system memory (no GPU reported)' };
  return null;
}

/** Nearest estimated row at or above `ctx` (the ladder the calibrator verifies). */
export function rowFor(inputs: EstimateInputs, ctx: number) {
  return inputs.rows.find((r) => r.ctx >= ctx) || inputs.rows.at(-1) || null;
}

/** Estimated GiB for one context and cache type, with the server's reserve and safety margin. */
export function estimateGib(inputs: EstimateInputs, ctx: number, kv: string): { ctx: number; kv: string; kvGib: number; totalGib: number } | null {
  const row = rowFor(inputs, ctx);
  const per = KV_BYTES[kv];
  if (!row || !per) return null;
  const kvGib = row.kvQ8Gib * (per / KV_BYTES.q8_0);
  return { ctx: row.ctx, kv, kvGib: round2(kvGib), totalGib: round2((inputs.modelGib + kvGib + inputs.pinnedGib + inputs.reserveGib) * inputs.safety) };
}

export function verdictFor(totalGib: number, budgetGib: number): Verdict {
  if (totalGib > budgetGib) return 'no';
  return budgetGib - totalGib < tightMargin(budgetGib) ? 'tight' : 'fits';
}

export type Recommendation = { kind: 'use'; ctx: number; kv: string; totalGib: number; verdict: Verdict; text: string }
  | { kind: 'smaller'; text: string } | { kind: 'unknown'; text: string };

/** The one next step. Prefers q8_0 at the largest context that fits with headroom; drops to Q5
 *  only when q8_0 cannot reach `wantCtx`; never recommends below the Q5 floor (#190). */
export function recommend(inputs: EstimateInputs, budgetGib: number, wantCtx = 0): Recommendation {
  if (!inputs.chat) return { kind: 'unknown', text: 'Embedding, reranking and projector files keep their qualified settings; the estimate covers chat models.' };
  if (!inputs.sizeable || !inputs.rows.length) return { kind: 'unknown', text: `The model file does not describe its attention layout (${inputs.arch || 'unknown architecture'}), so memory cannot be estimated. Use Measure context instead.` };
  const best = (kv: string, allowTight: boolean) => {
    let pick: ReturnType<typeof estimateGib> = null;
    for (const row of inputs.rows) {
      const e = estimateGib(inputs, row.ctx, kv);
      if (e && (allowTight ? e.totalGib <= budgetGib : verdictFor(e.totalGib, budgetGib) === 'fits')) pick = e;
    }
    return pick;
  };
  const target = wantCtx || 0;
  for (const allowTight of [false, true]) {
    for (const kv of ['q8_0', 'q5_1', 'q5_0']) {
      const e = best(kv, allowTight);
      if (!e) continue;
      // A lower cache type is only worth it when it reaches a context q8_0 cannot.
      if (kv !== 'q8_0' && target && e.ctx < target) continue;
      if (kv === 'q8_0' && target && e.ctx < target) {
        const q5 = best('q5_1', allowTight) || best('q5_0', allowTight);
        if (q5 && q5.ctx >= target) continue;
      }
      const verdict = verdictFor(e.totalGib, budgetGib);
      return { kind: 'use', ctx: e.ctx, kv, totalGib: e.totalGib, verdict,
        text: `Use ${e.ctx.toLocaleString('en-US')} tokens with ${kv} KV cache (about ${e.totalGib} of ${budgetGib} GiB${verdict === 'tight' ? ', little headroom' : ''}).` };
    }
  }
  const floor = round2((inputs.modelGib + inputs.pinnedGib + inputs.reserveGib) * inputs.safety);
  return { kind: 'smaller', text: `This model needs about ${floor} GiB before any context, and the smallest context does not fit ${budgetGib} GiB even with Q5 KV cache. Choose a smaller quantization${inputs.moe ? ' or configure CPU expert offload in Advanced' : ''}.` };
}

// ── Tuning pre-flight ────────────────────────────────────────────────────────────────────────
export const TUNE_STEPS = [
  { id: 'kv', label: 'KV cache', what: 'Loads the model once per cache type and keeps the fastest one that passes the three quality probes.' },
  { id: 'context', label: 'Context size', what: 'Loads increasing contexts and sends a long prompt at each; keeps the largest that answers within the 120-second budget.' },
  { id: 'drafting', label: 'Drafting', what: 'Compares speculative decoding (MTP or N-gram) with none and keeps it only if it is faster.' },
  { id: 'batch', label: 'Batch and micro-batch', what: 'Tries batch sizes for prompt reading speed.' },
] as const;

/** A rough wall-clock range for one model's full auto-tune: about a dozen model loads, whose
 *  time grows with file size, plus up to four long-context prompts at 30–120 s each. */
export function tuneMinutes(modelGib: number | null | undefined): { low: number; high: number } {
  const size = modelGib && modelGib > 0 ? modelGib : 8;
  const loads = 12;
  const low = (loads * (20 + size * 3) + 4 * 30) / 60, high = (loads * (40 + size * 8) + 4 * 120) / 60;
  return { low: Math.max(5, Math.round(low)), high: Math.max(10, Math.round(high)) };
}

// ── Roles ────────────────────────────────────────────────────────────────────────────────────
export type Role = 'chat' | 'vision' | 'routing' | 'embedding' | 'rerank';
export const ROLE_LABEL: Record<Role, string> = { chat: 'Chat', vision: 'Chat + vision', routing: 'Routing (system)', embedding: 'Embeddings', rerank: 'Reranking' };
export function roleOf(name: string, labels: readonly string[] = []): Role {
  if (isSystemModel(name)) return 'routing';
  const all = [name, ...labels].join(' ');
  if (/rerank/i.test(all)) return 'rerank';
  if (/embed/i.test(all)) return 'embedding';
  if (!isChatGenerationModel(name, labels)) return 'embedding';
  return labels.some((l) => /vision/i.test(l)) ? 'vision' : 'chat';
}
/** Chat and vision models are the only ones a prompt suite or auto-tune can measure. */
export const canPromptSuite = (role: Role) => role === 'chat' || role === 'vision';
export function groupByRole<T extends { name: string; labels: string[] }>(models: readonly T[]): { role: Role; models: T[] }[] {
  const order: Role[] = ['chat', 'vision', 'routing', 'embedding', 'rerank'];
  return order.map((role) => ({ role, models: models.filter((m) => roleOf(m.name, m.labels) === role) })).filter((g) => g.models.length);
}

// ── Recovery ─────────────────────────────────────────────────────────────────────────────────
export type Stuck = { kind: 'autotune' | 'calibration' | 'download'; id: string; model: string; status: string; detail: string; actions: ('cancel' | 'resume' | 'retry' | 'discover')[] };
type JobLike = { id?: string; model?: string; status?: string; error?: string; startedAt?: number; phase?: string; models?: unknown[] } | null | undefined;
type DownloadLike = { id: string; filename?: string; repo?: string; status: string; error?: string | null };
/** A running job older than this with no progress is shown as possibly stuck. */
export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

export function recoveryItems({ autotune, calibration, downloads, now }: { autotune: JobLike; calibration: JobLike; downloads: readonly DownloadLike[]; now: number }): Stuck[] {
  const out: Stuck[] = [];
  const job = (kind: 'autotune' | 'calibration', j: JobLike) => {
    if (!j?.status) return;
    const stale = j.status === 'running' && !!j.startedAt && now - j.startedAt > STUCK_AFTER_MS;
    if (j.status === 'running' && !stale) return;
    const resumable = kind === 'autotune' && Array.isArray(j.models) && j.status !== 'running';
    // A cancel someone chose is not a problem unless the run can pick up where it stopped.
    if (!['failed', 'interrupted', 'running'].includes(j.status) && !(j.status === 'cancelled' && resumable)) return;
    // Laya is never tuned or calibrated (#80/#81/#83): a stuck run can be cancelled, never retried.
    const system = isSystemModel(j.model || '');
    out.push({ kind, id: j.id || kind, model: j.model || '', status: stale ? 'running for over 2 hours' : j.status, detail: j.error || j.phase || '',
      actions: j.status === 'running' ? ['cancel'] : system ? [] : resumable ? ['resume'] : ['retry'] });
  };
  job('autotune', autotune); job('calibration', calibration);
  for (const d of downloads) if (d.status === 'error') out.push({ kind: 'download', id: d.id, model: d.filename || d.repo || d.id, status: 'failed', detail: d.error || '', actions: ['discover'] });
  return out;
}
