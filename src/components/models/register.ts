import { apiFetch } from '../../api';
import { errorText, mm } from './mm';

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
    return { registered: false, text: `${section} downloaded, but safe defaults were not written: ${errorText(e, 'unknown error')}. Use Set up this model.` };
  }
  const saved = `Registered ${section} with safe defaults (8K context${mtp ? ', MTP draft head' : ''}).`;
  try {
    const r = await apiFetch('/api/models/presets/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload: false }) });
    const v = await r.json().catch(() => ({})) as { loaded?: string[]; error?: string };
    if (r.status === 409 && Array.isArray(v.loaded)) return { registered: true, text: `${saved} ${v.loaded.join(', ')} is loaded, so the engine offers it after that model is unloaded.` };
    if (!r.ok) return { registered: true, text: `${saved} The engine did not reload yet: ${v.error || r.status}.` };
    return { registered: true, text: `${saved} Ready to load.` };
  } catch (e) { return { registered: true, text: `${saved} The engine did not reload yet: ${errorText(e, 'unknown error')}.` }; }
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
      if (status !== 409 && status !== 400) failed.push(`${stem} (${errorText(e, 'error')})`);
    }
  }
  if (!added.length) return { added, text: failed.length ? `New files could not be set up: ${failed.join(', ')}.` : '' };
  let reload = ' Ready to load.';
  try {
    const r = await apiFetch('/api/models/presets/reload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload: false }) });
    const v = await r.json().catch(() => ({})) as { loaded?: string[]; error?: string };
    if (r.status === 409 && Array.isArray(v.loaded)) reload = ` The engine offers them once ${v.loaded.join(', ')} is unloaded.`;
    else if (!r.ok) reload = ` The engine did not reload yet: ${v.error || r.status}.`;
  } catch (e) { reload = ` The engine did not reload yet: ${errorText(e, 'unknown error')}.`; }
  const names = added.join(', ');
  return { added, text: `Found ${added.length} new ${added.length === 1 ? 'model' : 'models'} in the models folder and added ${added.length === 1 ? 'it' : 'them'} with safe defaults (8K context${mtp.length ? `, MTP for ${mtp.join(', ')}` : ''}): ${names}.${reload}${failed.length ? ` Not set up: ${failed.join(', ')}.` : ''}` };
}
