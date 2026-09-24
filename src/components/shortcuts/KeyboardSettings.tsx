import { useState } from 'react';
import type { JSX } from 'react';
import { SegmentedControl } from '../SegmentedControl';
import { savePreferences, useAccountPreferences } from '../../user-preferences';
import { keyNames, sendHintText, useT } from '../../i18n';
import type { SendKey } from '../../user-preferences';
import { isApple } from './shortcuts';
import { ShortcutReference } from './ShortcutReference';

/** Settings → Keyboard & input (#230): how Enter behaves in every composer, saved to the account,
 *  and the searchable reference of every shortcut noevia handles (the same list as the "?" overlay). */
export function KeyboardSettings(): JSX.Element {
  const apple = typeof navigator !== 'undefined' && isApple(navigator.platform || navigator.userAgent);
  const prefs = useAccountPreferences();
  const t = useT();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = async (sendKey: SendKey) => {
    setBusy(true); setError('');
    try { await savePreferences({ sendKey }); }
    catch (e) { setError(e instanceof Error ? e.message : t('common.saveFailed')); }
    finally { setBusy(false); }
  };
  return <>
    <div className="settings-title"><h1>{t('settings.section.keyboard')}</h1><p>{t('keyboard.intro')}</p></div>
    <section className="settings-section">
      <h2>{t('keyboard.sending')}</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{t('keyboard.sendWith')}</span><span className="set-row-desc">{t('keyboard.sendWithDesc', { hint: sendHintText(t, prefs.sendKey, apple) })}</span></div>
          <div className="set-row-control" aria-busy={busy || undefined}><SegmentedControl label={t('keyboard.sendWith')} value={prefs.sendKey} options={[['enter', keyNames(t, apple).enter], ['mod-enter', `${keyNames(t, apple).mod}${keyNames(t, apple).enter}`]]} onChange={(v) => void change(v)} /></div>
        </div>
      </div>
      {prefs.sendKey !== 'enter' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void change('enter')}>{t('keyboard.restoreDefault')}</button>}
      {error && <p className="modal-err" role="alert">{error}</p>}
    </section>
    <section className="settings-section">
      <h2>{t('keyboard.shortcuts')}</h2>
      <p className="set-row-desc">{apple ? t('keyboard.appleNote') : t('keyboard.otherNote')} {t('keyboard.browserWins')}</p>
      <ShortcutReference apple={apple} query={query} onQuery={setQuery} />
    </section>
  </>;
}
