import { ChevronDown } from './Icons';

export function ComposerModel({ label, onClick, disabled = false, hint }: {
  label: string; onClick?: () => void; disabled?: boolean; hint?: string;
}) {
  return <button type="button" className="model-pill composer-model" onClick={onClick} disabled={disabled}
    title={hint || `Choose model · ${label}`} aria-label={disabled ? label : `Choose model: ${label}`}>
    <span className="model-pill-label">{label}</span>
    {!disabled && <ChevronDown />}
  </button>;
}
