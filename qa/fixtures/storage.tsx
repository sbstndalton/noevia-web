import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoragePicker } from '../../src/components/StoragePicker';
import { StorageFileBrowser } from '../../src/components/StorageFileBrowser';
import { FolderPicker } from '../../src/components/FolderPicker';
import '../../src/styles/tokens.css';
import '../../src/styles/app.css';
import '../../src/styles/diary-tab.css';
import '../../src/styles/popup.css';
import '../../src/styles/shell.css';
import '../../src/styles/noevia.css';
import '../../src/styles/shell-v2.css';
import '../../src/styles/primitives.css';
import '../../src/styles/overlays.css';
import '../../src/styles/phone.css';
import '../../src/styles/materials.css';

function WrapperDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="native-modal model-dialog-backdrop" aria-label="Synthetic wrapper"
    onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="mp-panel aero dialog-sheet">
      <h2>Wrapped panel</h2>
      <button className="btn btn-secondary" onClick={onClose}>Close wrapper</button>
    </div>
  </dialog>;
}
function Fixture() {
  const [open, setOpen] = useState<'storage' | 'folder' | 'wrapper' | null>(null);
  return <main style={{maxWidth: 600, margin: 'auto'}}><h1>Synthetic storage QA</h1>
    <StoragePicker/>
    <button onClick={() => setOpen('storage')}>Browse storage</button>
    <button onClick={() => setOpen('folder')}>Choose folder</button>
    <button onClick={() => setOpen('wrapper')}>Open wrapper</button>
    {open === 'storage' && <StorageFileBrowser onClose={() => setOpen(null)} onPick={() => {}}/>}
    {open === 'folder' && <FolderPicker onClose={() => setOpen(null)} onPick={() => setOpen(null)}/>}
    {open === 'wrapper' && <WrapperDialog onClose={() => setOpen(null)}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
