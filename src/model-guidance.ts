/** Transparent planning estimates, not hardware detection or runtime qualification. */
export type MemoryPlan = { capacityGB: string; reserveGB: string; kind: 'gpu' | 'unified' | 'cpu' };
export type MemoryAssessment = {state:'unknown'|'over'|'tight'|'room'; label:string; detail:string; remainingGB:number|null};
export function memoryAssessment(sizeGB: number | null | undefined, plan: MemoryPlan): MemoryAssessment {
  const capacity=Number(plan.capacityGB), reserve=Number(plan.reserveGB);
  const unknown=(detail:string):MemoryAssessment=>({state:'unknown',label:'Fit unknown',detail,remainingGB:null});
  if(!plan.capacityGB.trim() || !plan.reserveGB.trim() || !Number.isFinite(capacity) || capacity<=0 || capacity>4096 || !Number.isFinite(reserve) || reserve<0 || reserve>=capacity) return unknown('Enter a valid inference-machine capacity and a reserve smaller than that capacity.');
  if(typeof sizeGB!=='number' || !Number.isFinite(sizeGB) || sizeGB<=0)return unknown('The model manager did not report a usable file size.');
  const remainingGB=capacity-reserve-sizeGB;
  if(remainingGB<0)return {state:'over',label:'Over planned budget',remainingGB,detail:`Weights exceed the remaining budget by ${(-remainingGB).toFixed(1)} GB. A different quantization or memory plan is needed.`};
  if(remainingGB<Math.max(1,capacity*.1))return {state:'tight',label:'Little headroom',remainingGB,detail:`${remainingGB.toFixed(1)} GB remains after weights and your reserve. Runtime fit needs verification.`};
  return {state:'room',label:'Room in planned budget',remainingGB,detail:`${remainingGB.toFixed(1)} GB remains after weights and your reserve. Runtime fit needs verification.`};
}
export type ModelUse = 'all'|'vision'|'reasoning'|'tools';
export function matchesModelUse(labels: string[], use: ModelUse): boolean {
  if(use==='all')return !labels.some(label=>/^(embedding|embeddings|rerank|reranking|reranker)$/i.test(label));
  const allowed={vision:/^(vision|multimodal)$/i,reasoning:/^(reasoning|thinking)$/i,tools:/^(tools|tool-use|tool_use|function-calling)$/i};
  return labels.some(label=>allowed[use].test(label));
}

/** modelChoiceLabel's fallback when nothing is loaded. This file is loaded in isolation by
 *  tests/model-guidance.test.cjs (no module resolution there), so it stays free of the i18n
 *  module; callers that display it to a person (StatsBar) translate this exact sentinel. */
export const LOCAL_MODEL_FALLBACK = 'local model';

/** Composer/header label for a project or chat's model choice. `installed` is
 *  null while the local catalogue is unknown (not fetched, manager disabled or
 *  failing) — only a successfully fetched list may declare a model missing.
 *  Models on a non-default provider aren't in that catalogue, so never flagged. */
export function modelChoiceLabel(
  choice: { routing?: string; model?: string; provider?: string } | null | undefined,
  installed: { name: string; loaded?: boolean }[] | null,
  // Whether Auto routing (Fast/Smart) is actually configured server-side (fetchAutoRoles().configured).
  // Defaults true: most callers (a project) never reach the branch this guards, and existing tests
  // exercise the null-choice case explicitly either way.
  autoRolesConfigured = true,
): string {
  if (choice?.routing === 'auto') return 'Auto (Fast/Smart)';
  if (choice?.model) {
    if (!choice.provider && installed && !installed.some(m => m.name === choice.model)) return 'No model selected';
    return choice.model;
  }
  // No choice at all means a free chat (no project): it starts on Auto rather than whatever
  // happens to be loaded (#305) — loading a specific model for every quick chat wastes a load
  // and energy, and it is not a choice the person made for this chat. But only when the server
  // would really route it that way: without Fast/Smart roles configured it falls back to the
  // loaded model server-side too (chat.cjs), and the label must not promise a routing decision
  // that will not happen.
  if (!choice) return autoRolesConfigured ? 'Auto (Fast/Smart)' : (installed?.find(m => m.loaded)?.name ?? LOCAL_MODEL_FALLBACK);
  return installed?.find(m => m.loaded)?.name ?? LOCAL_MODEL_FALLBACK;
}

/** On unified-memory GPUs (message is English; borrowGB/hostGB/capGB let the UI phrase it per locale) the kernel lets the GPU borrow system RAM (GTT) outside any container
 *  limit. When that ceiling leaves the host less than `reserveGB`, loading several models can
 *  starve the server itself (DaServer outage, 2026-09-17). Unknown host size never warns. */
export function sharedMemoryRisk({ unified, sharedTotalGB, hostTotalGB, reserveGB = 8 }: { unified: boolean; sharedTotalGB: number; hostTotalGB: number | null | undefined; reserveGB?: number }): { risky: boolean; leftGB: number | null; message: string; borrowGB?: number; hostGB?: number; capGB?: number } {
  if (!unified || typeof hostTotalGB !== 'number' || !Number.isFinite(hostTotalGB) || hostTotalGB <= 0 || !(sharedTotalGB > 0)) return { risky: false, leftGB: null, message: '' };
  const leftGB = Math.round((hostTotalGB - sharedTotalGB) * 10) / 10;
  if (leftGB >= reserveGB) return { risky: false, leftGB, message: '' };
  return { risky: true, leftGB, borrowGB: Math.round(sharedTotalGB), hostGB: Math.round(hostTotalGB), capGB: Math.round(hostTotalGB - reserveGB), message: `The GPU may borrow up to ${Math.round(sharedTotalGB)} GiB of this machine's ${Math.round(hostTotalGB)} GiB, leaving about ${Math.max(0, leftGB)} GiB for everything else. Several loaded models can make the server unresponsive: keep one model loaded, or cap GPU shared memory (GTT) below ${Math.round(hostTotalGB - reserveGB)} GiB.` };
}
