// #1009: a searchable model picker for the cloud role fields. The list is the selected provider's
// own model ids (the server fetches and caches them with the stored key); typing filters it, and
// anything typed that the list does not hold can still be used as a custom model id.
import { useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { useT } from '../../i18n';

const SHOWN_MAX = 60;

export function ModelCombobox({ label, value, options, disabled = false, onChange }: {
  label: string; value: string; options: string[]; disabled?: boolean; onChange: (value: string) => void;
}): JSX.Element {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const query = value.trim().toLowerCase();
  const matches = (query && !options.includes(value) ? options.filter((o) => o.toLowerCase().includes(query)) : options).slice(0, SHOWN_MAX);
  const custom = value.trim() && !options.includes(value.trim()) ? value.trim() : '';
  // Rows: the listed matches, then "Use what I typed" when it is not one of them.
  const rows = custom ? [...matches, custom] : matches;
  const pick = (next: string) => { onChange(next); setOpen(false); setActive(-1); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (active >= 0 && rows[active]) pick(rows[active]); else if (custom) pick(custom); else setOpen(false); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1); }
  };
  const listId = `${id}-list`;
  return <div className="model-combobox">
    <label htmlFor={`${id}-input`}>{label}</label>
    <input ref={input} id={`${id}-input`} type="text" role="combobox" aria-expanded={open && rows.length > 0} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
      value={value} disabled={disabled} spellCheck={false} autoComplete="off" placeholder={t('mm.rmode.modelSearch')}
      onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
      onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={onKey} />
    {open && rows.length > 0 && <ul id={listId} role="listbox" className="model-combobox-list overlay" aria-label={label}>
      {rows.map((row, i) => {
        const isCustom = !!custom && i === rows.length - 1;
        return <li key={`${isCustom ? 'custom:' : ''}${row}`} id={`${id}-opt-${i}`} role="option" aria-selected={i === active || (!isCustom && row === value)}
          className={`model-combobox-option${i === active ? ' is-active' : ''}${isCustom ? ' is-custom' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); pick(row); }}>
          {isCustom ? t('mm.rmode.useCustom', { model: row }) : row}
        </li>;
      })}
    </ul>}
  </div>;
}
