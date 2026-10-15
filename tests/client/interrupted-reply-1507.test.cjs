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
  // The mappings live in transcript-variants.ts (shared by the load, the save and the merged copy).
  const tv = read('transcript-variants.ts');
  assert.match(tv, /import \{ interruptedFlag, storedInterrupted \} from '\.\/interrupted-reply';/);
  assert.match(tv, /\.\.\.\(storedInterrupted\(h\) \? \{ interrupted: true \} : \{\}\)/, 'the load reads it');
  assert.match(tv, /interrupted: interruptedFlag\(m\),/, 'the save writes it back');
  const app = read('App.tsx');
  assert.match(app, /messageFromEntry\(h, uid\(\)\)/, 'loaded history uses the shared mapping');
  assert.match(app, /messageFromEntry\(h, id\)/, 'the merged copy uses the shared mapping');
  assert.match(app, /entriesFor\(msgs\)/, 'the save uses the shared mapping');
});

test('Retry on an interrupted reply uses the same path as a failed one', () => {
  const app = read('App.tsx');
  assert.match(app, /const index = msgs\.findIndex\(m => m\.id === messageId && \(m\.error \|\| m\.interrupted\)\);/);
});

test('an interrupted reply shows its note with Retry and Continue, only as the last message, not while streaming and never beside the Stopped note (#1784)', () => {
  const view = read('components/ChatView.tsx');
  const block = view.slice(view.indexOf('m.interrupted && !m.stopped && isLast && !streaming'), view.indexOf('m.interrupted && !m.stopped && isLast && !streaming') + 700);
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

// Core's shape (draft b21, server/chat-partial.cjs): GET /api/chats/:id/history returns the partial beside
// `history` as `partial`, flagged interrupted. The client adds it as the chat's last turn.
test('core\'s partial becomes the last turn, flagged interrupted; nothing else changes', async () => {
  const { withPartialTurn } = await loadFlags();
  const history = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'done' }];
  const partial = { role: 'assistant', content: 'half', reasoning: 'thinking' };
  const out = withPartialTurn(history, partial);
  assert.deepEqual(out.slice(0, 2), history);
  assert.deepEqual(out[2], { role: 'assistant', content: 'half', reasoning: 'thinking', interrupted: true });
  assert.equal(history.length, 2, 'the input is not changed');
});

test('no partial, or a partial that is not an assistant reply, leaves the history as it is', async () => {
  const { withPartialTurn } = await loadFlags();
  const history = [{ role: 'user', content: 'q' }];
  assert.equal(withPartialTurn(history, null), history);
  assert.equal(withPartialTurn(history, undefined), history);
  assert.equal(withPartialTurn(history, { role: 'user', content: 'x' }), history);
});

test('a stale partial that repeats the last saved reply is not shown twice', async () => {
  const { withPartialTurn } = await loadFlags();
  const history = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'half', reasoning: 'thinking' }];
  assert.equal(withPartialTurn(history, { role: 'assistant', content: 'half', reasoning: 'thinking' }), history);
  // A different answer to the same question is a real partial, not a repeat.
  assert.equal(withPartialTurn(history, { role: 'assistant', content: 'half more' }).length, 3);
});

test('the history fetch reads core\'s partial beside the history and adds it through withPartialTurn', () => {
  const api = read('api.ts');
  const fn = api.slice(api.indexOf('export function fetchChatHistoryRevision'), api.indexOf('// ── Free (non-project) chats'));
  assert.match(fn, /partial\?: HistoryEntry/, 'the response type names core\'s partial');
  assert.match(fn, /withPartialTurn\(Array\.isArray\(r\.history\) \? r\.history : \[\], r\.partial\)/);
  assert.match(api, /import \{ withPartialTurn \} from '\.\/interrupted-reply';/);
});
