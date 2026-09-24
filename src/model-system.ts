// Mirrors server/model-system.cjs: Laya is noevia's internal multilingual routing model, never a
// chat model a person tunes or configures by hand. Kept in one place so the library grid and the
// auto-tune panel agree on what counts as "system".
const LAYA_PREFIX = /^laya(?:[_.-]|$)/i;

/** True when `id` (a model/router id) identifies Laya, the internal routing model. */
export function isSystemModel(id: string): boolean {
  return LAYA_PREFIX.test(String(id || '').trim());
}

export const SYSTEM_MODEL_LABEL = 'System · routing';
