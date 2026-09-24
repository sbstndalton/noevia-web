import { apiFetch } from '../../api';

export type FeatureName = 'stepSupervision' | 'systemOneRouting' | 'previews' | 'diaryMcpWrite' | 'deepResearch' | 'offsiteBackup' | 'toolRouter' | 'codeHarness' | 'browserExecutor' | 'kiwix';
export type FeatureFlags = Partial<Record<FeatureName, boolean>>;
export interface FeatureInfo { name: FeatureName; label: string; description: string; enabled: boolean; source: 'default' | 'env' | 'admin'; locked: boolean; env: string; pendingRestart?: boolean; experimental?: boolean; unavailable?: string | null }

export const FEATURES_CHANGED = 'noevia:features-changed';

async function read<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let message = fallback;
    try { message = (await response.json()).error || fallback; } catch { /* keep fallback */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const fetchFeatureFlags = () => apiFetch('/api/features').then(r => read<{ flags: FeatureFlags }>(r, 'Could not load features')).then(b => b.flags);
export const fetchFeatureSettings = () => apiFetch('/api/admin/features').then(r => read<{ features: FeatureInfo[] }>(r, 'Could not load features')).then(b => b.features);
export const saveFeature = (name: FeatureName, enabled: boolean) => apiFetch(`/api/admin/features/${encodeURIComponent(name)}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
}).then(r => read<FeatureInfo>(r, 'Could not save the feature'));

export interface DecisionSettings { url: string; timeoutMs: number; source?: string }
export const fetchDecisionSettings = () => apiFetch('/api/admin/decision-settings').then(r => read<DecisionSettings>(r, 'Could not load decision settings'));
export const saveDecisionSettings = (value: DecisionSettings) => apiFetch('/api/admin/decision-settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value) }).then(r => read<DecisionSettings>(r, 'Could not save decision settings'));
export const testDecisionSettings = (value: DecisionSettings) => apiFetch('/api/admin/decision-settings/test', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value) }).then(r => read<{ok:boolean;message:string}>(r, 'Could not reach decision service'));
