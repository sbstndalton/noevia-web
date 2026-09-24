import type { InstalledModel } from './types';

/** The Settings summary's "Installed" line. Reads the same `/api/models/installed`
 *  `loaded` flag as the model manager's cards, so the two agree when both lists are fresh. */
export function installedSummary(models: readonly Pick<InstalledModel, 'name' | 'loaded'>[]): string {
  const loaded = models.filter((m) => m.loaded).map((m) => m.name);
  return `${models.length} ${models.length === 1 ? 'model' : 'models'}${loaded.length ? ` · loaded: ${loaded.join(', ')}` : ' · none loaded'}`;
}
