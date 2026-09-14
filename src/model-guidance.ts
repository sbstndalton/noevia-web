/** Transparent planning estimates, not hardware detection or runtime qualification. */
export type MemoryPlan = { capacityGB: string; reserveGB: string; kind: 'gpu' | 'unified' | 'cpu' };
export const emptyMemoryPlan: MemoryPlan = {capacityGB:'',reserveGB:'4',kind:'gpu'};
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
  if(use==='all')return !labels.some(label=>/^(embedding|embeddings|reranking|reranker)$/i.test(label));
  const allowed={vision:/^(vision|multimodal)$/i,reasoning:/^(reasoning|thinking)$/i,tools:/^(tools|tool-use|tool_use|function-calling)$/i};
  return labels.some(label=>allowed[use].test(label));
}
