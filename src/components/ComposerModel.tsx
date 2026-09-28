import { ChevronDown } from './Icons';
import { MiddleTruncate } from './MiddleTruncate';
import { useT } from '../i18n';

const AUTO_LABEL = 'Auto (Fast/Smart)';

export function ComposerModel({ label, onClick, disabled = false, hint }: {
  label: string; onClick?: () => void; disabled?: boolean; hint?: string;
}) {
  const t = useT();
  // #510: in phone-sized space the Auto router reads "Auto"; the full name stays the tooltip and
  // the accessible name. Only this known label is shortened — a model's own name is never cut.
  const short = label === AUTO_LABEL ? 'Auto' : '';
  return <button type="button" className="model-pill composer-model glass glass-lens is-press" onClick={onClick} disabled={disabled}
    title={hint || t('composer.chooseModelTitle', { name: label })} aria-label={disabled ? label : t('composer.chooseModel', { name: label })}>
    <MiddleTruncate className={`model-pill-label${short && short !== label ? ' has-short' : ''}`} text={label}/>
    {short && short !== label && <span className="model-pill-label model-pill-short" aria-hidden="true">{short}</span>}
    {!disabled && <ChevronDown />}
  </button>;
}
