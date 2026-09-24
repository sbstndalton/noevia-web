// The interface-language core (#231), free of React and the DOM so node tests can load it.
// Catalogues are static modules bundled at build time: nothing is fetched, and no import path
// is ever built from a preference or a browser value.
import { EN_GB } from './en-GB';
import type { Catalogue, MessageKey } from './en-GB';
import { EN_US } from './en-US';

export type { Catalogue, MessageKey };
export type Params = Record<string, string | number>;

export const BASE_LOCALE = 'en-GB';
/** Every interface locale, fixed at build time (matches the server's LOCALES). */
export const SUPPORTED: readonly string[] = ['en-GB', 'en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE'];
/** Catalogues in memory. English ships in the main bundle; the rest arrive through loaders.ts
 *  (a fixed map of build-time chunks) and are registered here once loaded. */
export const CATALOGUES: Record<string, Catalogue> = { 'en-GB': EN_GB, 'en-US': EN_US };

/** Adds a loaded catalogue; ignored for anything that is not a supported locale. */
export function registerCatalogue(locale: string, catalogue: Catalogue): void {
  if (SUPPORTED.includes(locale)) CATALOGUES[locale] = catalogue;
}

// A bare language picks the locale noevia has for it; Norwegian's three codes all read Bokmål.
const BY_LANGUAGE: Record<string, string> = { en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', nb: 'nb-NO', no: 'nb-NO', nn: 'nb-NO', nl: 'nl-NL', pt: 'pt-BR', sv: 'sv-SE' };
// English regions that write American spelling; every other English region gets British.
const US_ENGLISH = new Set(['US', 'PR', 'PH', 'UM', 'AS', 'GU', 'MP', 'VI']);

/** One browser language tag to a supported locale, or null when noevia has nothing close. */
export function matchLanguage(tag: string): string | null {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  const [language = '', ...rest] = tag.trim().replace(/_/g, '-').split('-');
  const lang = language.toLowerCase();
  const region = rest.find((part) => /^[A-Za-z]{2}$|^\d{3}$/.test(part))?.toUpperCase();
  const exact = SUPPORTED.find((id) => id.toLowerCase() === `${lang}-${(region || '').toLowerCase()}`);
  if (exact) return exact;
  if (lang === 'en') return region && US_ENGLISH.has(region) ? 'en-US' : 'en-GB';
  return BY_LANGUAGE[lang] ?? null;
}

/** The interface locale: a saved choice wins; 'system' walks the browser's languages in order
 *  of preference and takes the first noevia supports; otherwise English. */
export function resolveInterfaceLocale(preference: string | undefined, languages: readonly string[] = []): string {
  if (preference && preference !== 'system' && SUPPORTED.includes(preference)) return preference;
  for (const tag of languages) { const found = matchLanguage(tag); if (found) return found; }
  return BASE_LOCALE;
}

/** {name} placeholders; an unknown one is left visible rather than silently dropped. */
export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole));
}

/** A message in the locale, falling back key by key to English (and then to the key itself). */
export function translate(locale: string, key: MessageKey, params?: Params): string {
  const own = Object.prototype.hasOwnProperty.call(CATALOGUES, locale) ? CATALOGUES[locale][key] : undefined;
  const text = typeof own === 'string' && own ? own : (EN_GB as Record<string, string>)[key] ?? key;
  return interpolate(text, params);
}

/** A plural pair: `${key}.one` or `${key}.other`, chosen by the locale's own rules. */
export function translatePlural(locale: string, key: string, count: number, params?: Params): string {
  let form = 'other';
  try { form = new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other'; } catch { form = count === 1 ? 'one' : 'other'; }
  return translate(locale, `${key}.${form}` as MessageKey, { count, ...params });
}

export type Coverage = { locale: string; translated: number; total: number; missing: string[]; extra: string[]; placeholderMismatch: string[] };

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

/** How complete a catalogue is against English, and anything it has that English does not. */
export function coverage(locale: string): Coverage {
  const base = EN_GB as Record<string, string>;
  const own = (CATALOGUES[locale] ?? {}) as Record<string, string>;
  const keys = Object.keys(base);
  return {
    locale,
    translated: keys.filter((k) => typeof own[k] === 'string' && own[k] !== '').length,
    total: keys.length,
    missing: keys.filter((k) => typeof own[k] !== 'string' || own[k] === ''),
    extra: Object.keys(own).filter((k) => !(k in base)),
    placeholderMismatch: Object.keys(own).filter((k) => k in base && placeholders(own[k]) !== placeholders(base[k])),
  };
}
