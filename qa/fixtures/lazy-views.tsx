import { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { lazyView, ViewLoading } from '../../src/lazy-views';
import '../../src/styles/tokens.css';
import '../../src/styles/app.css';
import '../../src/styles/noevia.css';
import '../../src/styles/shell-v2.css';
const params = new URLSearchParams(location.search);
const name = params.get('name') || 'Diary';
let finish: () => void = () => {};
const view = lazyView(() => params.has('fail') ? Promise.reject(Error('synthetic import failure')) : new Promise(resolve => { finish = () => resolve(() => <h1 className={name === 'Settings' ? 'settings-stage' : ''}>Loaded {name}</h1>); }));
function Fixture() {
  const [active, setActive] = useState(!params.has('hidden'));
  return <div className="app"><nav aria-label="App navigation"><button onClick={() => setActive(true)}>Open view</button><button onClick={() => finish()}>Finish import</button></nav>
    <div className={`app-stack${name === 'Settings' ? ' has-settings' : ''}`} style={{minHeight:400, position:'relative'}}>
      <Suspense fallback={<ViewLoading name={name} active={active} settings={name === 'Settings'}/>}><view.View/></Suspense>
    </div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
