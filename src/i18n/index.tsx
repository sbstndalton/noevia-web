// The React side of the interface language (#231). The locale is the account preference
// (user-preferences.ts), so every component using useT() re-renders when it is saved, in this tab
// or after the account record loads. `t()` is for code outside React (a class boundary, a toast).
import { useEffect, useMemo, useState } from 'react';
import { PREFERENCES_CHANGED, currentPreferences, useAccountPreferences } from '../user-preferences';
import { CATALOGUES, resolveInterfaceLocale, translate, translatePlural } from './core';
import { loadCatalogue } from './loaders';

/** Fired when a catalogue chunk arrives, so everything using useT() swaps from English. */
export const CATALOGUE_LOADED = 'noevia:catalogue-loaded';
function ensureCatalogue(locale: string): void {
  if (CATALOGUES[locale]) return;
  void loadCatalogue(locale).then((ok) => { if (ok && typeof window !== 'undefined') window.dispatchEvent(new Event(CATALOGUE_LOADED)); });
}
import type { MessageKey, Params } from './core';

export type { MessageKey, Params };
export type Translate = ((key: MessageKey, params?: Params) => string) & { plural: (key: string, count: number, params?: Params) => string; locale: string };

const browserLanguages = (): readonly string[] => (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

/** The locale the interface is shown in right now. */
export function interfaceLocale(preference = currentPreferences().locale): string {
  return resolveInterfaceLocale(preference, browserLanguages());
}

function bind(locale: string): Translate {
  const fn = ((key: MessageKey, params?: Params) => translate(locale, key, params)) as Translate;
  fn.plural = (key, count, params) => translatePlural(locale, key, count, params);
  fn.locale = locale;
  return fn;
}

/** Outside React: the current locale, read at call time. */
export function t(key: MessageKey, params?: Params): string { return translate(interfaceLocale(), key, params); }

/** Inside React: a translator that changes identity when the locale does. */
export function useT(): Translate {
  const { locale: preference } = useAccountPreferences();
  const [, setTick] = useState(0);
  // 'system' follows the browser, which can change its language while the page is open.
  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    window.addEventListener('languagechange', again);
    window.addEventListener(CATALOGUE_LOADED, again);
    return () => { window.removeEventListener('languagechange', again); window.removeEventListener(CATALOGUE_LOADED, again); };
  }, []);
  const locale = interfaceLocale(preference);
  // English renders at once; the locale's chunk swaps in when it resolves (cached afterwards).
  const ready = !!CATALOGUES[locale];
  useEffect(() => { if (!ready) ensureCatalogue(locale); }, [locale, ready]);
  return useMemo(() => bind(locale), [locale, ready]);
}

/** Keeps <html lang> on the interface locale, so screen readers, hyphenation and spellcheck
 *  follow it. Called once at start-up. */
export function startInterfaceLanguage(): void {
  if (typeof document === 'undefined') return;
  const apply = () => { const locale = interfaceLocale(); document.documentElement.lang = locale; ensureCatalogue(locale); };
  apply();
  window.addEventListener(PREFERENCES_CHANGED, apply);
  window.addEventListener('languagechange', apply);
}

/** Key names as printed on this locale's keyboards (Strg, Maj, Intro…); Apple uses symbols. */
export function keyNames(t: Translate, apple: boolean): { mod: string; newline: string; enter: string } {
  const enter = t('keys.enter');
  return apple ? { mod: '⌘', newline: `⇧${enter}`, enter } : { mod: `${t('keys.ctrl')}+`, newline: `${t('keys.shift')}+${enter}`, enter };
}

/** Rewrites an English key combination (Ctrl+Shift+K, Shift+Enter) with the locale's key names. */
export function localiseKeys(t: Translate, keys: string): string {
  return keys.replace(/\bCtrl\+/g, `${t('keys.ctrl')}+`).replace(/\bShift\+/g, `${t('keys.shift')}+`).replace(/\bEnter\b/g, t('keys.enter'));
}

/** The composer's send hint in the interface language, with the locale's key names. */
export function sendHintText(t: Translate, sendKey: 'enter' | 'mod-enter', apple: boolean): string {
  const k = keyNames(t, apple);
  return sendKey === 'enter' ? t('composer.hintEnter', { newline: k.newline }) : t('composer.hintMod', { mod: k.mod });
}
