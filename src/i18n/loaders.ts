// Non-English catalogues as separate build chunks (#231). The maps are fixed: every entry is a literal
// import that Vite resolves at build time, so no path is ever built from a preference or the
// browser. An id outside a map loads nothing and the interface stays English.
import { CATALOGUES, SEGMENTS, activeSegments, registerCatalogue, registerSegment } from './core';
import type { Catalogue, Segment } from './core';

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

/** The Settings segment of each locale (#286). Requested only once the Settings or Customise code
 *  has loaded and registered its English part (settings/index.ts), never on the first screen. */
export const SETTINGS_LOADERS: Record<string, () => Promise<Catalogue>> = {
  'de-DE': () => import('./settings/de-DE').then((m) => m.DE_DE_SETTINGS),
  'es-ES': () => import('./settings/es-ES').then((m) => m.ES_ES_SETTINGS),
  'fr-FR': () => import('./settings/fr-FR').then((m) => m.FR_FR_SETTINGS),
  'it-IT': () => import('./settings/it-IT').then((m) => m.IT_IT_SETTINGS),
  'nb-NO': () => import('./settings/nb-NO').then((m) => m.NB_NO_SETTINGS),
  'nl-NL': () => import('./settings/nl-NL').then((m) => m.NL_NL_SETTINGS),
  'pt-BR': () => import('./settings/pt-BR').then((m) => m.PT_BR_SETTINGS),
  'sv-SE': () => import('./settings/sv-SE').then((m) => m.SV_SE_SETTINGS),
};
/** The Projects segment of each locale (#289). Requested only once ProjectsView has loaded and
 *  registered its English part (projects/index.ts), never on the first screen. */
export const PROJECTS_LOADERS: Record<string, () => Promise<Catalogue>> = {
  'de-DE': () => import('./projects/de-DE').then((m) => m.DE_DE_PROJECTS),
  'es-ES': () => import('./projects/es-ES').then((m) => m.ES_ES_PROJECTS),
  'fr-FR': () => import('./projects/fr-FR').then((m) => m.FR_FR_PROJECTS),
  'it-IT': () => import('./projects/it-IT').then((m) => m.IT_IT_PROJECTS),
  'nb-NO': () => import('./projects/nb-NO').then((m) => m.NB_NO_PROJECTS),
  'nl-NL': () => import('./projects/nl-NL').then((m) => m.NL_NL_PROJECTS),
  'pt-BR': () => import('./projects/pt-BR').then((m) => m.PT_BR_PROJECTS),
  'sv-SE': () => import('./projects/sv-SE').then((m) => m.SV_SE_PROJECTS),
};

/** The Diary segment of each locale (#289). Requested only once DiaryView has loaded and
 *  registered its English part (diary/index.ts), never on the first screen. */
export const DIARY_LOADERS: Record<string, () => Promise<Catalogue>> = {
  'de-DE': () => import('./diary/de-DE').then((m) => m.DE_DE_DIARY),
  'es-ES': () => import('./diary/es-ES').then((m) => m.ES_ES_DIARY),
  'fr-FR': () => import('./diary/fr-FR').then((m) => m.FR_FR_DIARY),
  'it-IT': () => import('./diary/it-IT').then((m) => m.IT_IT_DIARY),
  'nb-NO': () => import('./diary/nb-NO').then((m) => m.NB_NO_DIARY),
  'nl-NL': () => import('./diary/nl-NL').then((m) => m.NL_NL_DIARY),
  'pt-BR': () => import('./diary/pt-BR').then((m) => m.PT_BR_DIARY),
  'sv-SE': () => import('./diary/sv-SE').then((m) => m.SV_SE_DIARY),
};
const SEGMENT_LOADERS: Record<Segment, Record<string, () => Promise<Catalogue>>> = { settings: SETTINGS_LOADERS, projects: PROJECTS_LOADERS, diary: DIARY_LOADERS };

const pending = new Map<string, Promise<boolean>>();
const failed = new Set<string>();

function loadOnce(id: string, locale: string, have: Record<string, Catalogue>, loaders: Record<string, () => Promise<Catalogue>>, register: (c: Catalogue) => void): Promise<boolean> {
  if (Object.prototype.hasOwnProperty.call(have, locale)) return Promise.resolve(true);
  if (!Object.prototype.hasOwnProperty.call(loaders, locale) || failed.has(id)) return Promise.resolve(false);
  let job = pending.get(id);
  if (!job) {
    job = loaders[locale]().then((catalogue) => { register(catalogue); return true; }, (error: unknown) => {
      failed.add(id);
      console.warn(`Interface translation ${id} could not be loaded; showing English.`, error);
      return false;
    });
    pending.set(id, job);
  }
  return job;
}

/** Loads a locale's catalogue once. Resolves true when it is available (already or now), false
 *  when there is nothing to load or the chunk failed; a failure is logged once and not retried
 *  in this page, so the interface simply stays English. */
export function loadCatalogue(locale: string, loaders: Record<string, () => Promise<Catalogue>> = LOADERS): Promise<boolean> {
  return loadOnce(locale, locale, CATALOGUES, loaders, (c) => registerCatalogue(locale, c));
}

/** The same for one segment of a locale: cached, shared while in flight, logged once on failure,
 *  and a missing segment only means its keys fall back to English one at a time. */
export function loadSegment(segment: Segment, locale: string, loaders: Record<string, () => Promise<Catalogue>> = SEGMENT_LOADERS[segment] ?? {}): Promise<boolean> {
  if (!Object.prototype.hasOwnProperty.call(SEGMENTS, segment)) return Promise.resolve(false);
  return loadOnce(`${locale} ${segment}`, locale, SEGMENTS[segment], loaders, (c) => registerSegment(segment, locale, c));
}

/** Whether everything the locale needs right now is in memory, or has already failed for good
 *  (so a caller does not keep asking). English is always ready. */
export function catalogueSettled(locale: string): boolean {
  const done = (id: string, have: Record<string, Catalogue>, loaders: Record<string, () => Promise<Catalogue>>) =>
    Object.prototype.hasOwnProperty.call(have, locale) || !Object.prototype.hasOwnProperty.call(loaders, locale) || failed.has(id);
  return done(locale, CATALOGUES, LOADERS) && activeSegments().every((s) => done(`${locale} ${s}`, SEGMENTS[s], SEGMENT_LOADERS[s]));
}

/** Loads the base and every active segment for the locale; true when anything new arrived. */
export function loadEverything(locale: string): Promise<boolean> {
  const has = (table: Record<string, Catalogue>) => Object.prototype.hasOwnProperty.call(table, locale);
  const jobs = [has(CATALOGUES) ? Promise.resolve(false) : loadCatalogue(locale),
    ...activeSegments().map((s) => (has(SEGMENTS[s]) ? Promise.resolve(false) : loadSegment(s, locale)))];
  return Promise.all(jobs).then((results) => results.some(Boolean));
}
