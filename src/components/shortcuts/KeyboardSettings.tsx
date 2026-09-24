import { useState } from 'react';
import type { JSX } from 'react';
import { SegmentedControl } from '../SegmentedControl';
import { savePreferences, sendHint, useAccountPreferences } from '../../user-preferences';
import type { SendKey } from '../../user-preferences';
import { isApple } from './shortcuts';
import { ShortcutReference } from './ShortcutReference';

/** Settings → Keyboard & input (#230): how Enter behaves in every composer, saved to the account,
 *  and the searchable reference of every shortcut noevia handles (the same list as the "?" overlay). */
export function KeyboardSettings(): JSX.Element {
  const apple = typeof navigator !== 'undefined' && isApple(navigator.platform || navigator.userAgent);
  const prefs = useAccountPreferences();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mod = apple ? '⌘' : 'Ctrl+';
  const change = async (sendKey: SendKey) => {
    setBusy(true); setError('');
    try { await savePreferences({ sendKey }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  return <>
    <div className="settings-title"><h1>Keyboard &amp; input</h1><p>How the message box sends, and every shortcut noevia understands. Press ? outside a text field to see them anywhere.</p></div>
    <section className="settings-section">
      <h2>Sending messages</h2>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">Send with</span><span className="set-row-desc">{sendHint(prefs.sendKey, apple)}. Applies to chats, projects and the Diary, on every device you sign in to.</span></div>
          <div className="set-row-control" aria-busy={busy || undefined}><SegmentedControl label="Send with" value={prefs.sendKey} options={[['enter', 'Enter'], ['mod-enter', `${mod}Enter`]]} onChange={(v) => void change(v)} /></div>
        </div>
      </div>
      {prefs.sendKey !== 'enter' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void change('enter')}>Restore default</button>}
      {error && <p className="modal-err" role="alert">{error}</p>}
    </section>
    <section className="settings-section">
      <h2>Shortcuts</h2>
      <p className="set-row-desc">{apple ? '⌘ is the Command key.' : 'On macOS these use ⌘ instead of Ctrl.'} None of them replace a browser shortcut; if your browser already uses one, the browser wins.</p>
      <ShortcutReference apple={apple} query={query} onQuery={setQuery} />
    </section>
  </>;
}
