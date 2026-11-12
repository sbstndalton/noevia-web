import { useId, useState } from 'react';
import type { JSX } from 'react';
import { useT } from '../../i18n';
import '../../i18n/coworkers';
import { useModalDialog } from '../useModalDialog';
import { SPACE_NAME_MAX } from '../../spaces-limits';

/** Name a Space (create or rename). The limit is shown as a count, never as a silent cut-off. */
export function NameDialog({ title, confirmLabel, initial, onSubmit, onClose }: {
  title: string; confirmLabel: string; initial: string;
  onSubmit: (name: string) => Promise<void>; onClose: () => void;
}): JSX.Element {
  const t = useT();
  const dialog = useModalDialog();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useId();
  const length = [...name.trim()].length;
  const invalid = length === 0 ? t('spaces.nameRequired') : length > SPACE_NAME_MAX ? t('spaces.nameTooLong', { max: SPACE_NAME_MAX }) : '';
  const submit = async () => {
    if (invalid || busy) { setError(invalid); return; }
    setBusy(true); setError('');
    try { await onSubmit(name.trim()); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : t('spaces.actionFailed')); setBusy(false); }
  };
  return (
    <dialog ref={dialog} className="modal-overlay native-modal" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={onClose}>
      <form className="modal-card aero dialog-sheet space-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="modal-head"><h2>{title}</h2></div>
        <label htmlFor={field}>{t('spaces.nameLabel')}</label>
        <input id={field} value={name} disabled={busy} aria-invalid={!!error} aria-describedby={`${field}-hint`} onChange={(e) => { setName(e.target.value); setError(''); }} />
        <p id={`${field}-hint`} className={`space-hint${length > SPACE_NAME_MAX ? ' is-over' : ''}`}>{t('spaces.nameCount', { count: length, max: SPACE_NAME_MAX })}</p>
        {error && <p className="space-note is-error" role="alert">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('spaces.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
