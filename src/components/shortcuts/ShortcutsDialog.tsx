import type { JSX } from 'react';
import { useModalDialog } from '../useModalDialog';
import { CloseButton } from '../CloseButton';
import { SHORTCUTS, describe } from './shortcuts';

export function ShortcutsDialog({ apple, onClose }: { apple: boolean; onClose: () => void }): JSX.Element {
  const ref = useModalDialog();
  return <dialog ref={ref} className="confirm-dialog shortcuts-dialog aero dialog-sheet" aria-labelledby="shortcuts-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <header className="modal-head"><h2 id="shortcuts-title">Keyboard shortcuts</h2><CloseButton onClick={onClose} label="Close keyboard shortcuts" /></header>
    <dl className="shortcuts-list">
      {SHORTCUTS.map((s) => <div key={s.id}><dt>{s.label}</dt><dd><kbd>{describe(s, apple)}</kbd></dd></div>)}
      <div><dt>Send a message</dt><dd><kbd>Enter</kbd></dd></div>
      <div><dt>New line in a message</dt><dd><kbd>{apple ? '⇧Enter' : 'Shift+Enter'}</kbd></dd></div>
      <div><dt>Close a dialog or search</dt><dd><kbd>Esc</kbd></dd></div>
    </dl>
  </dialog>;
}
