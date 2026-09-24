// Non-English catalogues as separate build chunks (#231). The map is fixed: every entry is a literal
// import that Vite resolves at build time, so no path is ever built from a preference or the
// browser. An id outside the map loads nothing and the interface stays English.
import { CATALOGUES, registerCatalogue } from './core';
import type { Catalogue } from './core';

export const LOADERS: Record<string, () => Promise<Catalogue>> = {
  'de-DE': () => import('./de-DE').then((m) => m.DE_DE),
  'es-ES': () => import('./es-ES').then((m) => m.ES_ES),
  'fr-FR': () => import('./fr-FR').then((m) => m.FR_FR),
  'it-IT': () => import('./it-IT').then((m) => m.IT_IT),
  'nb-NO': () => import('./nb-NO').then((m) => m.NB_NO),
  'nl-NL': () => import('./nl-NL').then((m) => m.NL_NL),
  'pt-BR': () => import('./pt-BR').then((m) => m.PT_BR),
  'sv-SE': () => import('./sv-SE').then((m) => m.SV_SE),
};

const pending = new Map<string, Promise<boolean>>();
const failed = new Set<string>();

/** Loads a locale's catalogue once. Resolves true when it is available (already or now), false
 *  when there is nothing to load or the chunk failed; a failure is logged once and not retried
 *  in this page, so the interface simply stays English. */
export function loadCatalogue(locale: string, loaders: Record<string, () => Promise<Catalogue>> = LOADERS): Promise<boolean> {
  if (Object.prototype.hasOwnProperty.call(CATALOGUES, locale)) return Promise.resolve(true);
  if (!Object.prototype.hasOwnProperty.call(loaders, locale) || failed.has(locale)) return Promise.resolve(false);
  let job = pending.get(locale);
  if (!job) {
    job = loaders[locale]().then((catalogue) => { registerCatalogue(locale, catalogue); return true; }, (error: unknown) => {
      failed.add(locale);
      console.warn(`Interface translation ${locale} could not be loaded; showing English.`, error);
      return false;
    });
    pending.set(locale, job);
  }
  return job;
}
