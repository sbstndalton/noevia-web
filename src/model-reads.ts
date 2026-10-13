import { invalidateCached, invalidateCachedPrefix } from './request-cache';

// #1509 / #1461: the installed-model list, the Fast/Smart role config and the effort settings
// are asked for by many components on one page load (chat header, composer, every Models tab,
// Diary). Two things keep that from repeating the same slow server call:
//   - in-flight sharing: a read that is already on its way is joined, not sent again;
//   - a short TTL after it lands, so components that mount a moment apart still share it.
// Writes drop the slot: any successful non-GET under the model paths (apiFetch in api.ts), and
// every `notifyModelsChanged()` (models-changed.ts), so the next read is never older than the save.
export const INSTALLED_MODELS_KEY = 'noevia:models:installed';
export const AUTO_ROLES_KEY = 'noevia:models:auto-roles';
export const MODEL_READ_TTL_MS = 2000;
export const REASONING_KEY_PREFIX = 'noevia:reasoning:';
export const REASONING_TTL_MS = 1000;

/** Drop the cached model list and role config (after any model or role change). */
export function invalidateModelReads(): void {
  invalidateCached(INSTALLED_MODELS_KEY);
  invalidateCached(AUTO_ROLES_KEY);
}

/** Drop every cached effort-settings read (the deployment default or a project's level changed). */
export function invalidateReasoningSettings(): void {
  invalidateCachedPrefix(REASONING_KEY_PREFIX);
}

/** Paths whose successful writes change what the model reads return. */
export function isModelWritePath(path: string): boolean {
  return /^\/api\/(models|model-manager|auto-roles|routing-default)(\/|$|\?)/.test(path);
}

/** Paths whose successful writes change the effort settings: the deployment default and a project's config. */
export function isReasoningWritePath(path: string): boolean {
  return /^\/api\/(reasoning-settings|projects\/[^/]+\/config)(\/|$|\?)/.test(path);
}
