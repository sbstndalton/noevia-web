import { useState } from 'react';
import type { JSX } from 'react';
import { useModalDialog } from '../useModalDialog';
import { CloseButton } from '../CloseButton';
import { ShortcutReference } from './ShortcutReference';

export function ShortcutsDialog({ apple, onClose, onOpenSettings }: { apple: boolean; onClose: () => void; onOpenSettings?: () => void }): JSX.Element {
  const ref = useModalDialog();
  const [query, setQuery] = useState('');
  return <dialog ref={ref} className="confirm-dialog shortcuts-dialog aero dialog-sheet" aria-labelledby="shortcuts-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <header className="modal-head"><h2 id="shortcuts-title">Keyboard shortcuts</h2><CloseButton onClick={onClose} label="Close keyboard shortcuts" /></header>
    <ShortcutReference apple={apple} query={query} onQuery={setQuery} />
    {onOpenSettings && <p className="shortcuts-foot"><button className="btn btn-ghost btn-sm" onClick={onOpenSettings}>Change how Enter sends in Settings</button></p>}
  </dialog>;
}
