import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { SegmentedControl } from '../SegmentedControl';
import { ADVANCED, ADVANCED_DEFAULT, isDefaultStyle, normaliseStyle, styleLines } from '../../response-style';
import type { Advanced, AdvancedKey, Preset } from '../../response-style';

type Saved = { text: string; style: Preset; advanced: Advanced; language: string; maxChars: number };
const STYLE_OPTIONS: [Preset, string, string][] = [['default', 'Default', 'The model decides'], ['concise', 'Concise', 'Short, direct answers'], ['detailed', 'Detailed', 'Thorough explanations']];
const LANGUAGE_SUGGESTIONS = ['English', 'British English', 'American English', 'Norwegian', 'Swedish', 'Danish', 'German', 'French', 'Spanish', 'Italian', 'Dutch', 'Portuguese', 'Polish', 'Japanese', 'Chinese'];
const KEYS = Object.keys(ADVANCED) as AdvancedKey[];

/** Settings → Assistant & style (#229, #231). A quick preset, an optional advanced panel, the
 *  default response language and free-text custom instructions — all one account record, saved
 *  together. Memory has its own page; this is how noevia answers, not what it knows. */
export function PersonalizationSettings({ onOpen }: { onOpen?: (section: string) => void } = {}): JSX.Element {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState('');
  const [style, setStyle] = useState<Preset>('default');
  const [advanced, setAdvanced] = useState<Advanced>(ADVANCED_DEFAULT);
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const adopt = (body: Record<string, unknown>) => {
    const s = normaliseStyle(body);
    const text = typeof body.text === 'string' ? body.text : '';
    setSaved({ ...s, text, maxChars: typeof body.maxChars === 'number' ? body.maxChars : 4000 });
    setDraft(text); setStyle(s.style); setAdvanced(s.advanced); setLanguage(s.language);
  };

  useEffect(() => {
    let live = true;
    apiFetch('/api/account/instructions').then(async (r) => {
      if (!r.ok) throw Error();
      const body = await r.json();
      if (live) adopt(body);
    }).catch(() => { if (live) setError('Your response settings could not be loaded.'); });
    return () => { live = false; };
  }, []);

  const max = saved?.maxChars ?? 4000;
  const current = { style, advanced, language };
  const changed = saved !== null && (draft.trim() !== saved.text || style !== saved.style || language.trim() !== saved.language || KEYS.some((k) => advanced[k] !== saved.advanced[k]));
  const advancedCount = KEYS.filter((k) => advanced[k] !== 'auto').length;
  const touched = () => setStatus('');

  const save = async () => {
    setBusy(true); setStatus(''); setError('');
    try {
      const r = await apiFetch('/api/account/instructions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: draft, style, advanced, language: language.trim() }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || 'Could not save. Try again.');
      adopt(body);
      setStatus(body.text || !isDefaultStyle(normaliseStyle(body)) ? 'Saved. New messages use these settings.' : 'Cleared. Chats no longer get custom instructions.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  const resetStyle = () => { setStyle('default'); setAdvanced(ADVANCED_DEFAULT); setLanguage(''); touched(); };
  const preview = [...styleLines(current), draft.trim()].filter(Boolean);

  return <>
    <div className="settings-title"><h1>Assistant &amp; style</h1><p>How noevia answers you in every chat. The Diary keeps its own style.</p></div>
    <section className="settings-section">
      <h2>Response style</h2>
      <fieldset className="personal-style" disabled={saved === null || busy}>
        <legend className="set-row-label">Quick start</legend>
        <div className="personal-style-options">
          {STYLE_OPTIONS.map(([id, label, hint]) => <label key={id} className={style === id ? 'is-selected' : ''}>
            <input type="radio" name="response-style" value={id} checked={style === id} onChange={() => { setStyle(id); touched(); }} />
            <span className="personal-style-label">{label}</span><span className="personal-style-hint">{hint}</span>
          </label>)}
        </div>
      </fieldset>
      <details className="personal-advanced" open={advancedCount > 0 || undefined}>
        <summary>Advanced style{advancedCount ? ` · ${advancedCount} set` : ''}</summary>
        <div className="set-rows">
          {KEYS.map((key) => <div className="set-row" key={key}>
            <div className="set-row-text"><span className="set-row-label">{ADVANCED[key].label}</span></div>
            <div className="set-row-control"><SegmentedControl label={ADVANCED[key].label} value={advanced[key]} options={ADVANCED[key].options}
              onChange={(v) => { setAdvanced((a) => ({ ...a, [key]: v })); touched(); }} /></div>
          </div>)}
        </div>
      </details>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">Response language</span><span className="set-row-desc">The language replies use by default. Writing in another language, or asking for one, still wins. Separate from the interface language in Appearance &amp; language.</span></div>
          <div className="set-row-control">
            <input className="personal-language" list="response-languages" aria-label="Response language" placeholder="Match my message" maxLength={40} value={language} disabled={saved === null || busy} onChange={(e) => { setLanguage(e.target.value); touched(); }} />
            <datalist id="response-languages">{LANGUAGE_SUGGESTIONS.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
        </div>
      </div>
    </section>
    <section className="settings-section">
      <div className="personal-instructions">
        <label className="set-row-label" htmlFor="custom-instructions">Custom instructions</label>
        <span className="set-row-desc" id="custom-instructions-desc">Rules for how to respond, for example units or spelling. Facts about you belong in <button type="button" className="link-button" onClick={() => onOpen?.('memory')}>Memory</button>.</span>
        <textarea id="custom-instructions" aria-describedby="custom-instructions-desc" value={draft} maxLength={max} rows={6} disabled={saved === null || busy}
          placeholder="Prefer metric units. Use British spelling."
          onChange={(e) => { setDraft(e.target.value); touched(); }} />
      </div>
      <div className="personal-preview" aria-live="polite">
        <span className="set-row-label">What noevia is told</span>
        {preview.length ? <ul>{preview.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p className="set-row-desc">Nothing: the model uses its own defaults.</p>}
        <p className="set-row-desc">Order of precedence: what you ask for in a message (including an exact format such as JSON) first, then the project’s instructions, then these account settings.</p>
      </div>
      <div className="personal-actions">
        <button className="modal-btn secondary" disabled={busy || isDefaultStyle(current)} onClick={resetStyle}>Reset style to default</button>
        <span className="personal-count" aria-live="polite">{draft.length} / {max}</span>
        <button className="modal-btn primary" disabled={!changed || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {status && <p className="route-note" role="status">{status}</p>}
      {error && <p className="modal-err" role="alert">{error}</p>}
    </section>
  </>;
}
