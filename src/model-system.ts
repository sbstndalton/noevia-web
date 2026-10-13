// Mirrors server/model-system.cjs: Laya is noevia's internal multilingual routing model, never a
// chat model a person tunes or configures by hand. Kept in one place so the library grid and the
// auto-tune panel agree on what counts as "system".
//
// #1179/#1596: the marker is an explicit role in models.roles.json beside models.ini (not a key in
// models.ini, which llama-server also reads and rejects unknown keys of). Core sends `system` on each
// installed row, and fetchInstalledModels records those answers here (rememberSystemModels). The
// name rule is only a deprecated fallback for a name the list has not reported, and it is logged once.
const LAYA_PREFIX = /^laya(?:[_.-]|$)/i;
const explicitSystem = new Map<string, boolean>();
const nameRuleLogged = new Set<string>();

/** Records the explicit system kind of every installed row (replaces the previous list's answers). */
export function rememberSystemModels(rows: readonly { name: string; system?: boolean }[]): void {
  explicitSystem.clear();
  for (const row of rows) if (typeof row.system === 'boolean') explicitSystem.set(row.name, row.system);
}

/** True when `id` (a model/router id) identifies Laya, the internal routing model. */
export function isSystemModel(id: string): boolean {
  const name = String(id || '').trim();
  if (!name) return false;
  const explicit = explicitSystem.get(name);
  if (explicit !== undefined) return explicit;
  if (!LAYA_PREFIX.test(name)) return false;
  if (!nameRuleLogged.has(name)) {
    nameRuleLogged.add(name);
    console.warn(`[model-system] ${name} is treated as Laya by the deprecated name rule; the models list did not mark it with system; mark it in models.roles.json beside models.ini ({"${name}": "laya"}), not in models.ini (#1179, #1596)`);
  }
  return true;
}

export const SYSTEM_MODEL_LABEL = 'System · routing';
