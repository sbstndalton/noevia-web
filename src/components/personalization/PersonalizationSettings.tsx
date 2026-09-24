import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { apiFetch } from '../../api';
import { SegmentedControl } from '../SegmentedControl';
import { ADVANCED, ADVANCED_DEFAULT, isDefaultStyle, normaliseStyle, styleLines } from '../../response-style';
import type { Advanced, AdvancedKey, Preset } from '../../response-style';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

type Saved = { text: string; style: Preset; advanced: Advanced; language: string; maxChars: number };
const STYLE_OPTIONS: [Preset, MessageKey, MessageKey][] = [['default', 'style.preset.default', 'style.preset.defaultHint'], ['concise', 'style.preset.concise', 'style.preset.conciseHint'], ['detailed', 'style.preset.detailed', 'style.preset.detailedHint']];
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
  const t = useT();
  // Option labels are translated for display; the values (and what the model is told) are not.
  const optionLabel = (id: string, fallback: string) => { const text = t(`style.option.${id}` as MessageKey); return text.startsWith('style.') ? fallback : text; };

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
    }).catch(() => { if (live) setError(t('style.loadError')); });
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
      if (!r.ok) throw Error(body.error || t('common.saveFailed'));
      adopt(body);
      setStatus(body.text || !isDefaultStyle(normaliseStyle(body)) ? t('style.savedStatus') : t('style.clearedStatus'));
    } catch (e) { setError(e instanceof Error ? e.message : t('common.saveFailed')); }
    finally { setBusy(false); }
  };
  const resetStyle = () => { setStyle('default'); setAdvanced(ADVANCED_DEFAULT); setLanguage(''); touched(); };
  const preview = [...styleLines(current), draft.trim()].filter(Boolean);
  // The Memory link sits wherever the language puts {memory} in the sentence.
  const memoryParts = t('style.customDesc').split('{memory}');

  return <>
    <div className="settings-title"><h1>{t('settings.section.personalization')}</h1><p>{t('style.intro')}</p></div>
    <section className="settings-section">
      <h2>{t('style.responseStyle')}</h2>
      <fieldset className="personal-style" disabled={saved === null || busy}>
        <legend className="set-row-label">{t('style.quickStart')}</legend>
        <div className="personal-style-options">
          {STYLE_OPTIONS.map(([id, label, hint]) => <label key={id} className={style === id ? 'is-selected' : ''}>
            <input type="radio" name="response-style" value={id} checked={style === id} onChange={() => { setStyle(id); touched(); }} />
            <span className="personal-style-label">{t(label)}</span><span className="personal-style-hint">{t(hint)}</span>
          </label>)}
        </div>
      </fieldset>
      <details className="personal-advanced" open={advancedCount > 0 || undefined}>
        <summary>{t('style.advanced')}{advancedCount ? ` · ${t('style.advancedSet', { count: advancedCount })}` : ''}</summary>
        <div className="set-rows">
          {KEYS.map((key) => <div className="set-row" key={key}>
            <div className="set-row-text"><span className="set-row-label">{t(`style.advanced.${key}`)}</span></div>
            <div className="set-row-control"><SegmentedControl label={t(`style.advanced.${key}`)} value={advanced[key]} options={ADVANCED[key].options.map(([id, label]): [string, string] => [id, optionLabel(id, label)])}
              onChange={(v) => { setAdvanced((a) => ({ ...a, [key]: v })); touched(); }} /></div>
          </div>)}
        </div>
      </details>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-row-text"><span className="set-row-label">{t('style.language')}</span><span className="set-row-desc">{t('style.languageDesc')}</span></div>
          <div className="set-row-control">
            <input className="personal-language" list="response-languages" aria-label={t('style.language')} placeholder={t('style.languagePlaceholder')} maxLength={40} value={language} disabled={saved === null || busy} onChange={(e) => { setLanguage(e.target.value); touched(); }} />
            <datalist id="response-languages">{LANGUAGE_SUGGESTIONS.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
        </div>
      </div>
    </section>
    <section className="settings-section">
      <div className="personal-instructions">
        <label className="set-row-label" htmlFor="custom-instructions">{t('style.custom')}</label>
        <span className="set-row-desc" id="custom-instructions-desc">{memoryParts[0]}<button type="button" className="link-button" onClick={() => onOpen?.('memory')}>{t('style.memory')}</button>{memoryParts[1]}</span>
        <textarea id="custom-instructions" aria-describedby="custom-instructions-desc" value={draft} maxLength={max} rows={6} disabled={saved === null || busy}
          placeholder={t('style.customPlaceholder')}
          onChange={(e) => { setDraft(e.target.value); touched(); }} />
      </div>
      <div className="personal-preview" aria-live="polite">
        <span className="set-row-label">{t('style.told')}</span>
        {preview.length ? <ul>{preview.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p className="set-row-desc">{t('style.toldNothing')}</p>}
        <p className="set-row-desc">{t('style.precedence')}</p>
      </div>
      <div className="personal-actions">
        <button className="modal-btn secondary" disabled={busy || isDefaultStyle(current)} onClick={resetStyle}>{t('style.reset')}</button>
        <span className="personal-count" aria-live="polite">{draft.length} / {max}</span>
        <button className="modal-btn primary" disabled={!changed || busy} onClick={() => void save()}>{busy ? t('common.saving') : t('common.save')}</button>
      </div>
      {status && <p className="route-note" role="status">{status}</p>}
      {error && <p className="modal-err" role="alert">{error}</p>}
    </section>
  </>;
}
