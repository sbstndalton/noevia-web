import { useState } from 'react';
import type { JSX } from 'react';
import { LOCALE_OPTIONS, resolveLocale, savePreferences, useAccountPreferences } from '../../user-preferences';

/** Settings → Appearance & language → Language and formats (#231). Two separate settings, named
 *  separately: the interface language (English is the only translation today, said plainly
 *  rather than offering a selector that changes half the screen), and the locale used for dates
 *  and numbers, saved to the account. The assistant's reply language lives in Assistant & style. */
export function LanguageSettings({ onOpen }: { onOpen?: (section: string) => void }): JSX.Element {
  const prefs = useAccountPreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sample = new Date(Date.UTC(2026, 8, 24, 14, 30));
  const locale = resolveLocale(prefs.locale);
  const change = async (next: string) => {
    setBusy(true); setError('');
    try { await savePreferences({ locale: next }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  let preview = '';
  try { preview = `${sample.toLocaleDateString(locale, { dateStyle: 'long' })} · ${sample.toLocaleTimeString(locale, { timeStyle: 'short' })} · ${(1234567.89).toLocaleString(locale)}`; } catch { preview = ''; }
  return <section className="settings-section">
    <h2>Language and formats</h2>
    <div className="set-rows">
      <div className="set-row">
        <div className="set-row-text"><span className="set-row-label">Interface language</span><span className="set-row-desc">English is the only interface language available so far. Menus, messages and dialogs stay in English until more translations exist.</span></div>
        <div className="set-row-control"><span className="set-row-value">English</span></div>
      </div>
      <div className="set-row">
        <div className="set-row-text"><span className="set-row-label">Dates and numbers</span><span className="set-row-desc">{preview ? `Shown like: ${preview}` : 'How dates, times and numbers are written.'} Saved to your account. Model names, file names and your content are never translated.</span></div>
        <div className="set-row-control">
          <select aria-label="Dates and numbers" value={prefs.locale} disabled={busy} onChange={(e) => void change(e.target.value)}>{LOCALE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          {prefs.locale !== 'system' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void change('system')}>Reset to browser</button>}
        </div>
      </div>
      <div className="set-row">
        <div className="set-row-text"><span className="set-row-label">Assistant’s reply language</span><span className="set-row-desc">Set separately, because you may read the interface in one language and want answers in another.</span></div>
        <div className="set-row-control"><button className="btn btn-secondary btn-sm" onClick={() => onOpen?.('personalization')}>Open Assistant &amp; style</button></div>
      </div>
    </div>
    {error && <p className="modal-err" role="alert">{error}</p>}
  </section>;
}
