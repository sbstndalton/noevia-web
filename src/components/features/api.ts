import { apiFetch } from '../../api';
import { cached, invalidateCached } from '../../request-cache';

export type FeatureName = 'stepSupervision' | 'systemOneRouting' | 'toolGate' | 'previews' | 'diaryMcpWrite' | 'deepResearch' | 'offsiteBackup' | 'toolRouter' | 'codeHarness' | 'browserExecutor' | 'kiwix';
export type FeatureFlags = Partial<Record<FeatureName, boolean>>;
export interface FeatureInfo { name: FeatureName; label: string; description: string; enabled: boolean; source: 'default' | 'env' | 'admin'; locked: boolean; env: string; pendingRestart?: boolean; experimental?: boolean; unavailable?: string | null }

export const FEATURES_CHANGED = 'noevia:features-changed';

// #422: `useFeatureFlags()` is consumed directly (App) and through two further wrapper hooks
// (useResearchAccess, useCodeAccess) that each mount their own instance, so one project view can
// ask for the flags three times on the same load. `FEATURES_KEY` is the shared cache slot (see
// request-cache.ts); the listener below invalidates it the moment an admin save fires the
// existing `FEATURES_CHANGED` event, so every mounted `useFeatureFlags()` still gets the fresh
// answer it already re-fetches on that event, instead of the one still sitting in cache. A 401
// (`cowork:unauthorized`) means this browser's flags may no longer be this session's to read.
const FEATURES_KEY = 'noevia:features';
if (typeof window !== 'undefined') {
  window.addEventListener(FEATURES_CHANGED, () => invalidateCached(FEATURES_KEY));
  window.addEventListener('cowork:unauthorized', () => invalidateCached(FEATURES_KEY));
}

async function read<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let message = fallback;
    try { message = (await response.json()).error || fallback; } catch { /* keep fallback */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const fetchFeatureFlags = () => cached(FEATURES_KEY, () => apiFetch('/api/features').then(r => read<{ flags: FeatureFlags }>(r, 'Could not load features')).then(b => b.flags));
export const fetchFeatureSettings = () => apiFetch('/api/admin/features').then(r => read<{ features: FeatureInfo[] }>(r, 'Could not load features')).then(b => b.features);
export const saveFeature = (name: FeatureName, enabled: boolean) => apiFetch(`/api/admin/features/${encodeURIComponent(name)}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
}).then(r => read<FeatureInfo>(r, 'Could not save the feature')).then(v => { invalidateCached(FEATURES_KEY); return v; });

export interface DecisionSettings { url: string; timeoutMs: number; source?: string }
export const fetchDecisionSettings = () => apiFetch('/api/admin/decision-settings').then(r => read<DecisionSettings>(r, 'Could not load decision settings'));
export const saveDecisionSettings = (value: DecisionSettings) => apiFetch('/api/admin/decision-settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value) }).then(r => read<DecisionSettings>(r, 'Could not save decision settings'));
export const testDecisionSettings = (value: DecisionSettings) => apiFetch('/api/admin/decision-settings/test', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value) }).then(r => read<{ok:boolean;message:string}>(r, 'Could not reach decision service'));
