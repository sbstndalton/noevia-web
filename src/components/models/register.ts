import { apiFetch } from '../../api';
import { errorText, mm } from './mm';
import { interfaceLocale, t } from '../../i18n';
import { translatePlural } from '../../i18n/core';

// Outside React: messages in the interface language at the moment the note is written.
const plural = (key: string, count: number, params?: Record<string, string | number>) => translatePlural(interfaceLocale(), key, count, params);

// A finished download gets conservative settings once (8k context, MTP only with a
// draft head beside it, the GGUF's own template and sampling), then the preset file
// is reloaded without unloading anything. A loaded model makes the reload wait; the
// new model is still registered and is picked up once the engine reloads.
export async function registerSafeDefaults(section: string): Promise<{ registered: boolean; text: string }> {
  let mtp = false;
  try { mtp = (await mm<{ mtp?: boolean }>(`sections/${encodeURIComponent(section)}/safe-defaults`, { body: {} })).mtp === true; }
  catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 409) return { registered: true, text: '' };
    if (status === 400) return { registered: false, text: '' };
    return { registered: false, text: t('mm.register.notWritten', { model: section, error: errorText(e, t('mm.unknownError')) }) };
  }
  const saved = t(mtp ? 'mm.register.savedMtp' : 'mm.register.saved', { model: section });
  try {
    const r = await apiFetch('/api/models/presets/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload: false }) });
    const v = await r.json().catch(() => ({})) as { loaded?: string[]; error?: string };
    if (r.status === 409 && Array.isArray(v.loaded)) return { registered: true, text: `${saved} ${t('mm.register.afterUnload', { models: v.loaded.join(', ') })}` };
    if (!r.ok) return { registered: true, text: `${saved} ${t('mm.register.noReload', { error: v.error || r.status })}` };
    return { registered: true, text: `${saved} ${t('mm.register.ready')}` };
  } catch (e) { return { registered: true, text: `${saved} ${t('mm.register.noReload', { error: errorText(e, t('mm.unknownError')) })}` }; }
}

// Files that appear in the models folder (downloaded elsewhere, copied in, or renamed) get the
// same safe defaults automatically, then ONE engine reload, so Your models, Auto routing and the
// chat picker list them without a manual "Create settings" per file. Each file is tried once per
// browser session: a file the server refuses (a stray head, a clash) is not retried in a loop.
const TRIED_KEY = 'noevia:models-folder-sync-tried';
const DISMISSED_KEY = 'noevia:models-folder-sync-dismissed';

/** Settings deleted on purpose (file kept) must not come straight back on the next visit. */
export function dismissFolderModel(stem: string): void {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    if (!list.includes(stem)) localStorage.setItem(DISMISSED_KEY, JSON.stringify([...list, stem].slice(-200)));
  } catch { /* optional */ }
}
export async function registerNewFolderModels(stems: string[]): Promise<{ added: string[]; text: string }> {
  let tried: string[] = [];
  try { tried = JSON.parse(sessionStorage.getItem(TRIED_KEY) || '[]'); } catch { tried = []; }
  let dismissed: string[] = [];
  try { dismissed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { dismissed = []; }
  const fresh = stems.filter((s) => !tried.includes(s) && !dismissed.includes(s));
  if (!fresh.length) return { added: [], text: '' };
  try { sessionStorage.setItem(TRIED_KEY, JSON.stringify([...tried, ...fresh].slice(-200))); } catch { /* optional */ }
  const added: string[] = [], mtp: string[] = [], failed: string[] = [];
  for (const stem of fresh) {
    try {
      const r = await mm<{ mtp?: boolean }>(`sections/${encodeURIComponent(stem)}/safe-defaults`, { body: {} });
      added.push(stem); if (r.mtp) mtp.push(stem);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== 409 && status !== 400) failed.push(`${stem} (${errorText(e, t('mm.register.error'))})`);
    }
  }
  if (!added.length) return { added, text: failed.length ? t('mm.register.failed', { files: failed.join(', ') }) : '' };
  let reload = ` ${t('mm.register.ready')}`;
  try {
    const r = await apiFetch('/api/models/presets/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload: false }) });
    const v = await r.json().catch(() => ({})) as { loaded?: string[]; error?: string };
    if (r.status === 409 && Array.isArray(v.loaded)) reload = ` ${t('mm.register.onceUnloaded', { models: v.loaded.join(', ') })}`;
    else if (!r.ok) reload = ` ${t('mm.register.noReload', { error: v.error || r.status })}`;
  } catch (e) { reload = ` ${t('mm.register.noReload', { error: errorText(e, t('mm.unknownError')) })}`; }
  const names = added.join(', ');
  const found = mtp.length ? plural('mm.register.foundMtp', added.length, { models: names, mtp: mtp.join(', ') }) : plural('mm.register.found', added.length, { models: names });
  return { added, text: `${found}${reload}${failed.length ? ` ${t('mm.register.notSetUp', { files: failed.join(', ') })}` : ''}` };
}
