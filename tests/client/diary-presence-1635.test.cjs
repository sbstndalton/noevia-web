'use strict';
// #1635: after sending a message in a new chat, a live tester's page-text read showed the Diary panel and no
// chat thread while the address stayed on the chat. App.tsx kept the Diary mounted behind every view with
// display:none, and a display:none element's innerText is its whole textContent, so a reader that takes the
// longest <main> picked the hidden Diary over a short chat. The Diary must be in the document only while it
// is the view on screen. This pins the presence rule (src/diary-presence.ts), the keep-alive-but-detached
// host (src/components/KeptOffDocument.tsx) in an isolated jsdom realm with a synthetic stand-in for the
// Diary, and App.tsx's wiring of the two. qa/diary-not-in-chat-1635.cjs proves it in a real browser.
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 20000 }, fn);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');

const ROOT = path.resolve(__dirname, '../..');
let bundle;
async function realm(t) {
  bundle ??= build({
    stdin: { contents: `import {act, useLayoutEffect, useRef, useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {KeptOffDocument} from './src/components/KeptOffDocument'; import {diaryOpened, diaryPresence} from './src/diary-presence';
      export const log = { mounts: 0, unmounts: 0, attachedAtMount: null, clicks: 0 };
      // Synthetic stand-in for the Diary: private text, an unsent draft held in state, a scroller, a button.
      function SyntheticDiary({ active }) {
        const [draft, setDraft] = useState('');
        const self = useRef(null);
        useLayoutEffect(() => { log.mounts++; log.attachedAtMount = document.contains(self.current); return () => { log.unmounts++; }; }, []);
        window.__setDraft = setDraft;
        return <main ref={self} className="main diary-workspace" role={active ? undefined : 'none'}>
          <p>Synthetic private diary text 1635</p><p data-draft>{draft}</p>
          <div className="scroller" style={{ overflow: 'auto' }}>scroll</div>
          <button onClick={() => { log.clicks++; }}>Synthetic diary action</button>
        </main>;
      }
      // The same shape as App.tsx: the opened latch, the presence rule, the kept-off-document host.
      function Shell({ enabled, viewKind, covered }) {
        const [was, setWas] = useState(false);
        const opened = diaryOpened(was, { enabled, viewKind });
        if (opened !== was) setWas(opened);
        const place = diaryPresence({ enabled, viewKind, opened, covered });
        return <div className="chat-views" style={{ display: 'contents' }}>
          {viewKind === 'chat' && <main className="main chat-workspace"><p>Synthetic chat</p></main>}
          {place !== 'absent' && <KeptOffDocument className="diary-mount" shown={place === 'shown'}><SyntheticDiary active={viewKind === 'diary'} /></KeptOffDocument>}
        </div>;
      }
      const root = createRoot(document.getElementById('root'));
      export async function show(props) { await act(async () => { root.render(<Shell {...props} />); }); }
      export async function setDraft(text) { await act(async () => { window.__setDraft(text); }); }
      export async function click(el) { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }
      export async function close() { await act(async () => root.unmount()); }
      export { diaryOpened, diaryPresence };`,
      resolveDir: ROOT, loader: 'tsx' },
    jsx: 'automatic', bundle: true, write: false, format: 'iife', globalName: 'Presence1635', platform: 'browser',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  const code = (await bundle).outputFiles[0].text;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.IS_REACT_ACT_ENVIRONMENT = true;
  w.MessageChannel = class { constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }; } };
  w.eval(code);
  t.after(async () => { await w.Presence1635.close(); w.close(); });
  return { w, doc: w.document, api: w.Presence1635 };
}

// The page-text rule that picked the hidden Diary: the longest innerText among the <main> elements. jsdom has no
// layout, so innerText is textContent here, which is exactly what a browser returns for a display:none element.
const longestMain = (doc) => [...doc.querySelectorAll('main')].sort((a, b) => b.textContent.length - a.textContent.length)[0] ?? null;

test('presence rule: only the Diary being the view opens it; nothing else mounts it', async (t) => {
  const { api } = await realm(t);
  let opened = false;
  // A new chat, a send, the reply finishing, a chat-list refresh: the view stays a chat throughout.
  for (const viewKind of ['chat', 'chat', 'chat', 'project', 'projects', 'plugins', 'models', 'archived', 'preview']) {
    opened = api.diaryOpened(opened, { enabled: true, viewKind });
    assert.equal(api.diaryPresence({ enabled: true, viewKind, opened }), 'absent', `${viewKind} must not mount the Diary`);
  }
  assert.equal(opened, false);
  opened = api.diaryOpened(opened, { enabled: true, viewKind: 'diary' });
  assert.equal(api.diaryPresence({ enabled: true, viewKind: 'diary', opened }), 'shown');
  opened = api.diaryOpened(opened, { enabled: true, viewKind: 'chat' });
  assert.equal(api.diaryPresence({ enabled: true, viewKind: 'chat', opened }), 'detached', 'a left Diary is kept but out of the document');
  // The Code workspace covers the chat views: a Diary still underneath is detached, not hidden in place.
  assert.equal(api.diaryPresence({ enabled: true, viewKind: 'diary', opened, covered: true }), 'detached');
  assert.equal(api.diaryPresence({ enabled: true, viewKind: 'diary', opened: false, covered: true }), 'detached');
  // Turning the Diary off drops it and forgets it was opened.
  assert.equal(api.diaryOpened(true, { enabled: false, viewKind: 'diary' }), false);
  assert.equal(api.diaryPresence({ enabled: false, viewKind: 'diary', opened: true }), 'absent');
});

test('a chat never has the Diary in its document; the page-text read gets the chat', async (t) => {
  const { doc, api } = await realm(t);
  for (let i = 0; i < 3; i++) await api.show({ enabled: true, viewKind: 'chat' }); // send, done, list refresh
  assert.equal(api.log.mounts, 0, 'the Diary mounted without being opened');
  assert.equal(doc.querySelectorAll('.diary-mount, .diary-workspace').length, 0);
  assert.ok(!doc.body.textContent.includes('Synthetic private diary text'), 'Diary text is in the chat page');
  assert.equal(longestMain(doc)?.className, 'main chat-workspace');
});

test('opened, left and reopened: kept alive, out of the document while left, draft and scroll kept', async (t) => {
  const { w, doc, api } = await realm(t);
  await api.show({ enabled: true, viewKind: 'chat' });
  await api.show({ enabled: true, viewKind: 'diary' });
  assert.equal(api.log.mounts, 1);
  assert.equal(api.log.attachedAtMount, true, 'the Diary must already be in the document when its layout effects run');
  assert.ok(doc.querySelector('.chat-views > div > .diary-mount > main.diary-workspace'), 'shown in place, inside the chat views');
  await api.setDraft('Synthetic unsent draft');
  const scroller = doc.querySelector('.scroller');
  scroller.scrollTop = 120;

  await api.show({ enabled: true, viewKind: 'chat' });
  assert.equal(api.log.unmounts, 0, 'leaving the Diary must not unmount it (the draft and in-flight saves live there)');
  assert.equal(doc.querySelectorAll('.diary-mount, .diary-workspace').length, 0, 'a left Diary must not stay in the document');
  assert.ok(!doc.body.textContent.includes('Synthetic unsent draft'), 'the unsent Diary draft is readable from the chat page');
  assert.equal(longestMain(doc)?.className, 'main chat-workspace', 'the page-text read picked the Diary over the chat');
  scroller.scrollTop = 0; // a browser drops the offset of a node that leaves the document

  await api.show({ enabled: true, viewKind: 'diary' });
  assert.equal(api.log.mounts, 1, 'reopening reuses the kept Diary');
  assert.equal(doc.querySelector('[data-draft]').textContent, 'Synthetic unsent draft');
  assert.equal(doc.querySelector('.scroller'), scroller);
  assert.equal(scroller.scrollTop, 120, 'the scroll offset is put back');
  await api.click(doc.querySelector('.diary-mount button'));
  assert.equal(api.log.clicks, 1, 'events still reach the reattached Diary');

  await api.show({ enabled: true, viewKind: 'diary', covered: true });
  assert.equal(doc.querySelectorAll('.diary-workspace').length, 0, 'under the Code workspace the Diary is detached');
  await api.show({ enabled: false, viewKind: 'chat' });
  assert.equal(api.log.unmounts, 1, 'turning the Diary off unmounts it');
  void w;
});

test('App.tsx mounts the Diary through the presence rule, never display:none behind the chat', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.doesNotMatch(src, /className="diary-mount" style=\{\{ display:/, 'the Diary is again kept in the document with display:none');
  assert.match(src, /const diaryOpenedNow = diaryOpened\(diaryWasOpened, \{ enabled: diaryEnabled, viewKind: view\.kind \}\);/);
  assert.match(src, /const diaryPlace = diaryPresence\(\{ enabled: diaryEnabled, viewKind: view\.kind, opened: diaryOpenedNow, covered: appMode === 'code' && showPreviews \}\);/);
  assert.match(src, /\{diaryPlace !== 'absent' && <KeptOffDocument className="diary-mount" shown=\{diaryPlace === 'shown'\}>/);
  assert.equal((src.match(/<Diary\.View\b/g) || []).length, 1, 'one Diary mount');
});
