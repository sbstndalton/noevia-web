import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoragePicker } from '../../src/components/StoragePicker';
import { StorageFileBrowser } from '../../src/components/StorageFileBrowser';
import '../../src/styles/tokens.css';
import '../../src/styles/app.css';
import '../../src/styles/noevia.css';
import '../../src/styles/primitives.css';
import '../../src/styles/overlays.css';
function Fixture() {
  const [open, setOpen] = useState(false);
  return <main style={{maxWidth: 600, margin: 'auto'}}><h1>Synthetic storage QA</h1>
    <StoragePicker/><button onClick={() => setOpen(true)}>Browse storage</button>
    {open && <StorageFileBrowser onClose={() => setOpen(false)} onPick={() => {}}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
