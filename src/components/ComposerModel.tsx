import { ChevronDown } from './Icons';
import { MiddleTruncate } from './MiddleTruncate';
import { useT } from '../i18n';

const AUTO_LABEL = 'Auto (Fast/Smart)';

export function ComposerModel({ label, onClick, disabled = false, hint, compact }: {
  label: string; onClick?: () => void; disabled?: boolean; hint?: string;
  /** #527, the phone composer: one plain-text button for the model and the thinking level
   *  ("Auto · Auto") that opens the model sheet, with a small live dot while a reply generates. */
  compact?: { thinking: string | null; live: boolean };
}) {
  const t = useT();
  // #510: in phone-sized space the Auto router reads "Auto"; the full name stays the tooltip and
  // the accessible name. Only this known label is shortened — a model's own name is never cut.
  const short = label === AUTO_LABEL ? 'Auto' : '';
  if (compact) {
    const name = t('composer.chooseModel', { name: label }) + (compact.thinking ? ` · ${t('composer.thinking.label')}: ${compact.thinking}` : '');
    return <button type="button" className={`composer-model is-compact${compact.live ? ' is-live' : ''}`} onClick={onClick} disabled={disabled}
      title={hint || t('composer.chooseModelTitle', { name: label })} aria-label={name} aria-haspopup="dialog">
      {compact.live && <span className="composer-model-live" aria-hidden="true"/>}
      {short ? <span className="composer-model-name">{short}</span> : <MiddleTruncate className="composer-model-name" text={label}/>}
      {compact.thinking && <span className="composer-model-thinking" aria-hidden="true">· {compact.thinking}</span>}
    </button>;
  }
  return <button type="button" className="model-pill composer-model glass glass-lens is-press" onClick={onClick} disabled={disabled}
    title={hint || t('composer.chooseModelTitle', { name: label })} aria-label={disabled ? label : t('composer.chooseModel', { name: label })}>
    <MiddleTruncate className={`model-pill-label${short && short !== label ? ' has-short' : ''}`} text={label}/>
    {short && short !== label && <span className="model-pill-label model-pill-short" aria-hidden="true">{short}</span>}
    {!disabled && <ChevronDown />}
  </button>;
}
