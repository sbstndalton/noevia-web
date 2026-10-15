import type { fetchAutoRoles } from './api';
import type { MessageKey, Params } from './i18n/core';

export type AutoRoleInfo = Awaited<ReturnType<typeof fetchAutoRoles>>;
type T = (key: MessageKey, params?: Params) => string;
const ROLE_KEYS = {
  fast: 'modelPopup.autoRole.fast', smart: 'modelPopup.autoRole.smart',
  vision: 'modelPopup.autoRole.vision', code: 'modelPopup.autoRole.code', creative: 'modelPopup.autoRole.creative',
} as const;

/** Display only the five server roles, once each; this never changes routing policy. */
export function missingAutoRoles(info: AutoRoleInfo | null): NonNullable<AutoRoleInfo['missing']> {
  if (!info?.configured || !Array.isArray(info.missing)) return [];
  return (Object.keys(ROLE_KEYS) as (keyof typeof ROLE_KEYS)[]).flatMap((role) => {
    const entry = info.missing?.find((m) => m?.role === role && typeof m.model === 'string' && m.model.trim());
    return entry ? [{ role, model: entry.model.slice(0, 256) }] : [];
  });
}

export function missingAutoRolesText(missing: NonNullable<AutoRoleInfo['missing']>, t: T): string {
  return t(missing.length === 1 ? 'modelPopup.autoMissingOne' : 'modelPopup.autoMissingSeveral', {
    models: missing.map((m) => `${t(ROLE_KEYS[m.role])} (${m.model})`).join(', '),
  });
}
