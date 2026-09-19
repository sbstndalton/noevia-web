import { ChevronDown } from './Icons';
import { MiddleTruncate } from './MiddleTruncate';

export function ComposerModel({ label, onClick, disabled = false, hint }: {
  label: string; onClick?: () => void; disabled?: boolean; hint?: string;
}) {
  return <button type="button" className="model-pill composer-model glass glass-lens is-press" onClick={onClick} disabled={disabled}
    title={hint || `Choose model · ${label}`} aria-label={disabled ? label : `Choose model: ${label}`}>
    <MiddleTruncate className="model-pill-label" text={label}/>
    {!disabled && <ChevronDown />}
  </button>;
}
