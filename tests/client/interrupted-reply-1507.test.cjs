// #1507 (web half): a reply the server saved partway (interrupted: true on the assistant history entry,
// the core side is draft b21) is shown after a reload as 'interrupted', with Retry and Continue. The flag
// must survive every transcript mapping, so a later save does not drop it. Pure helpers are tested
// directly; the mappings and the notice are checked by source contract (the reload itself is a browser
// check, left unverified here).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

async function loadFlags() {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  try {
    return await server.ssrLoadModule('/src/interrupted-reply.ts');
  } finally {
    await server.close();
  }
}

test('only a saved assistant turn with the flag reads as interrupted', async () => {
  const { storedInterrupted } = await loadFlags();
  assert.equal(storedInterrupted({ role: 'assistant', interrupted: true }), true);
  assert.equal(storedInterrupted({ role: 'assistant' }), false, 'a finished reply has no flag');
  assert.equal(storedInterrupted({ role: 'user', interrupted: true }), false, 'a question is never interrupted');
});

test('the flag is written back only for an interrupted assistant turn, so finished turns save as before', async () => {
  const { interruptedFlag } = await loadFlags();
  assert.equal(interruptedFlag({ role: 'assistant', interrupted: true }), true);
  assert.equal(interruptedFlag({ role: 'assistant' }), undefined);
  assert.equal(interruptedFlag({ role: 'assistant', interrupted: false }), undefined);
  assert.equal(interruptedFlag({ role: 'user', interrupted: true }), undefined);
});

test('the load, save and merged-transcript mappings all carry the flag', () => {
  const app = read('App.tsx');
  assert.match(app, /import \{ interruptedFlag, storedInterrupted \} from '\.\/interrupted-reply';/);
  assert.equal((app.match(/\.\.\.\(storedInterrupted\(h\) \? \{ interrupted: true \} : \{\}\)/g) || []).length, 2, 'loaded history and merged transcripts');
  assert.match(app, /      interrupted: interruptedFlag\(m\),\n    \}\)\);/, 'the save mapping writes it back');
});

test('Retry on an interrupted reply uses the same path as a failed one', () => {
  const app = read('App.tsx');
  assert.match(app, /const index = msgs\.findIndex\(m => m\.id === messageId && \(m\.error \|\| m\.interrupted\)\);/);
});

test('an interrupted reply shows its note with Retry and Continue, only as the last message and not while streaming', () => {
  const view = read('components/ChatView.tsx');
  const block = view.slice(view.indexOf('m.interrupted && isLast && !streaming'), view.indexOf('m.interrupted && isLast && !streaming') + 700);
  assert.match(block, /<div className="msg-interrupted" role="status">/);
  assert.match(block, /t\('chat\.interrupted\.note'\)/);
  assert.match(block, /onClick=\{\(\) => onRetry\(chatId, m\.id\)\}/);
  assert.match(block, /onClick=\{\(\) => onSend\(t\('chat\.interrupted\.continuePrompt'\)\)\}/);
  assert.match(block, /disabled=\{streaming \|\| actionBusy\}/);
});

test('every core catalogue carries the four interrupted-reply strings', () => {
  for (const file of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const src = read(`i18n/${file}.ts`);
    for (const key of ['chat.interrupted.note', 'chat.interrupted.retry', 'chat.interrupted.continue', 'chat.interrupted.continuePrompt']) {
      assert.match(src, new RegExp(`'${key.replace(/\./g, '\\.')}'`), `${file} ${key}`);
    }
  }
});
