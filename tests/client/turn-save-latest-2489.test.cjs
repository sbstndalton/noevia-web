'use strict';
// sbstndalton/noevia#2489: the end-of-turn history save read the messages of a render that did not hold
// the final text. When the last delta and 'done' reach the page in one task, the passive effect of the
// previous commit is still pending; it took the "save after commit" mark and saved the reply as "" (the
// server stores what it is sent). Rendered through the real hook in an isolated jsdom realm, synthetic data.
// TURN_SAVE_HOOK (a .ts path) swaps the implementation, to run the same scenarios against the old logic.
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');

const hookPath = process.env.TURN_SAVE_HOOK || path.resolve(__dirname, '../../src/use-save-after-commit.ts');
let bundle;
async function mount() {
  bundle ??= build({
    stdin: { contents: `import {StrictMode, useLayoutEffect, useState} from 'react'; import {createRoot, flushSync} from 'react-dom/client';
      import {flushSync as fs} from 'react-dom';
      import {useSaveAfterCommit} from ${JSON.stringify(hookPath)};
      let api; let commitHook=null;
      function Fixture({saves}){
        const [messagesByChat,set]=useState({c1:[{id:'u',role:'user',content:'qa hi'},{id:'r',role:'assistant',content:''}]});
        const marks=useSaveAfterCommit(messagesByChat,(id,msgs)=>saves.push({id,content:msgs[msgs.length-1].content,len:msgs.length}));
        api={set,marks,onCommit:(f)=>{commitHook=f;}};
        // Runs in the commit, before this render's passive effects: what the page does when the network read
        // lands while that effect is still pending.
        useLayoutEffect(()=>{const f=commitHook;commitHook=null;if(f)f();});
        return null;
      }
      export function start(saves,strict){const root=createRoot(document.getElementById('root'));
        root.render(strict?<StrictMode><Fixture saves={saves}/></StrictMode>:<Fixture saves={saves}/>);return root;}
      export const get=()=>api; export const sync=fs;`,
      resolveDir: path.resolve(__dirname, '../..'), loader: 'tsx' }, nodePaths: [path.resolve(__dirname, '../../node_modules')],
    jsx: 'automatic', bundle: true, write: false, format: 'iife', globalName: 'Fx', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  const code = (await bundle).outputFiles[0].text;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.IS_REACT_ACT_ENVIRONMENT = false;
  dom.window.eval(code);
  return dom;
}
const wait = (w, ms = 60) => new Promise((r) => w.setTimeout(r, ms));
const withText = (text, settled) => (prev) => ({ ...prev, c1: prev.c1.map((m) => (m.id === 'r' ? { ...m, content: text, ...(settled ? { settled: true } : {}) } : m)) });

for (const strict of [false, true]) {
  test(`a final delta and done in one task save the full text${strict ? ' (StrictMode)' : ''}`, async () => {
    const dom = await mount(); const { Fx } = dom.window;
    const saves = []; Fx.start(saves, strict); await wait(dom.window);
    // An earlier update (status line) commits; its passive effect is still pending when the burst arrives.
    Fx.get().onCommit(() => {
      // One task: the last delta, then 'done' (settle marks the chat, then updates it).
      Fx.get().set(withText('The finished sentence.'));
      Fx.get().marks.add('c1');
      Fx.get().set(withText('The finished sentence.', true));
    });
    Fx.get().set((p) => ({ ...p, c1: p.c1.map((m) => (m.id === 'r' ? { ...m, processingStatus: 'x' } : m)) }));
    await wait(dom.window);
    assert.deepEqual(saves.map((s) => s.content), ['The finished sentence.'], 'exactly one save, with the whole text');
  });
}

test('a turn that ends in a later task is saved once, with its text', async () => {
  const dom = await mount(); const { Fx } = dom.window;
  const saves = []; Fx.start(saves, false); await wait(dom.window);
  Fx.get().set(withText('Part one.')); await wait(dom.window);
  Fx.get().marks.add('c1'); Fx.get().set(withText('Part one.', true)); await wait(dom.window);
  await wait(dom.window);
  assert.deepEqual(saves.map((s) => s.content), ['Part one.']);
});

test('no mark, no save; a deleted chat mark is dropped', async () => {
  const dom = await mount(); const { Fx } = dom.window;
  const saves = []; Fx.start(saves, false); await wait(dom.window);
  Fx.get().set(withText('Streaming...')); await wait(dom.window);
  assert.equal(saves.length, 0);
  Fx.get().marks.add('c1'); Fx.get().marks.delete('c1'); Fx.get().set(withText('More')); await wait(dom.window);
  assert.equal(saves.length, 0);
});
