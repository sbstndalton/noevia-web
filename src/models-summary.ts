import type { InstalledModel } from './types';

/** The Settings summary's "Installed" line. Reads the same `/api/models/installed`
 *  `loaded` flag as the model manager's cards, so the two agree when both lists are fresh. */
export type SummaryWords = { count: (n: number) => string; loaded: (names: string) => string; noneLoaded: string };
const ENGLISH: SummaryWords = { count: (n) => `${n} ${n === 1 ? 'model' : 'models'}`, loaded: (names) => `loaded: ${names}`, noneLoaded: 'none loaded' };
/** `words` puts it in the interface language (ModelsSummary passes translations). */
export function installedSummary(models: readonly Pick<InstalledModel, 'name' | 'loaded'>[], words: SummaryWords = ENGLISH): string {
  const loaded = models.filter((m) => m.loaded).map((m) => m.name);
  return `${words.count(models.length)} · ${loaded.length ? words.loaded(loaded.join(', ')) : words.noneLoaded}`;
}
