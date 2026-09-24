import { ChevronDown } from './Icons';
import { MiddleTruncate } from './MiddleTruncate';
import { useT } from '../i18n';

export function ComposerModel({ label, onClick, disabled = false, hint }: {
  label: string; onClick?: () => void; disabled?: boolean; hint?: string;
}) {
  const t = useT();
  return <button type="button" className="model-pill composer-model glass glass-lens is-press" onClick={onClick} disabled={disabled}
    title={hint || t('composer.chooseModelTitle', { name: label })} aria-label={disabled ? label : t('composer.chooseModel', { name: label })}>
    <MiddleTruncate className="model-pill-label" text={label}/>
    {!disabled && <ChevronDown />}
  </button>;
}
