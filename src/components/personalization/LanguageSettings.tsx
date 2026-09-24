import { useState } from 'react';
import type { JSX } from 'react';
import { LOCALE_OPTIONS, resolveLocale, savePreferences, useAccountPreferences } from '../../user-preferences';
import { useT } from '../../i18n';

/** Settings → Appearance & language → Language and formats (#231). One locale, saved to the
 *  account, drives both the interface text and how dates and numbers are written; screens without
 *  a translation yet fall back to English key by key, and the page says so. The assistant's reply
 *  language is a separate setting in Assistant & style. */
export function LanguageSettings({ onOpen }: { onOpen?: (section: string) => void }): JSX.Element {
  const prefs = useAccountPreferences();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sample = new Date(Date.UTC(2026, 8, 24, 14, 30));
  const locale = resolveLocale(prefs.locale);
  const change = async (next: string) => {
    setBusy(true); setError('');
    try { await savePreferences({ locale: next }); }
    catch (e) { setError(e instanceof Error ? e.message : t('common.saveFailed')); }
    finally { setBusy(false); }
  };
  let preview = '';
  try { preview = `${sample.toLocaleDateString(locale, { dateStyle: 'long' })} · ${sample.toLocaleTimeString(locale, { timeStyle: 'short' })} · ${(1234567.89).toLocaleString(locale)}`; } catch { preview = ''; }
  return <section className="settings-section">
    <h2>{t('language.heading')}</h2>
    <div className="set-rows">
      <div className="set-row">
        <div className="set-row-text"><span className="set-row-label">{t('language.label')}</span><span className="set-row-desc">{t('language.desc')} {preview ? t('language.preview', { sample: preview }) : t('language.previewFallback')}</span></div>
        <div className="set-row-control">
          {/* Language names stay in their own language so anyone can find theirs. */}
          <select aria-label={t('language.label')} value={prefs.locale} disabled={busy} onChange={(e) => void change(e.target.value)}>{LOCALE_OPTIONS.map(([id, label]) => <option key={id} value={id} lang={id === 'system' ? undefined : id}>{id === 'system' ? t('language.matchBrowser') : label}</option>)}</select>
          {prefs.locale !== 'system' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void change('system')}>{t('language.reset')}</button>}
        </div>
      </div>
      <div className="set-row">
        <div className="set-row-text"><span className="set-row-label">{t('language.reply')}</span><span className="set-row-desc">{t('language.replyDesc')}</span></div>
        <div className="set-row-control"><button className="btn btn-secondary btn-sm" onClick={() => onOpen?.('personalization')}>{t('language.openStyle')}</button></div>
      </div>
    </div>
    <p className="route-note">{t('language.untranslated')}</p>
    {error && <p className="modal-err" role="alert">{error}</p>}
  </section>;
}
