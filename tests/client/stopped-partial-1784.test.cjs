// #1784: a reply the person stopped after part of its answer had arrived is marked `stopped`. The mark
// must survive the save, the reload and the stored answers kept by Regenerate (#1517), and it must not
// leak onto a finished answer or a question. The note itself is checked in the browser
// (qa/chat-stopped-partial-1784.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function loadVariants() {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  try {
    return await server.ssrLoadModule('/src/transcript-variants.ts');
  } finally {
    await server.close();
  }
}

test('a stopped reply is saved and read back as stopped; a finished one and a question are not', async () => {
  const { messageFromEntry, entriesFor } = await loadVariants();
  const messages = [
    { id: 'u', role: 'user', content: 'Synthetic question', stopped: true },
    { id: 'a', role: 'assistant', content: 'Synthetic partial answer that stops at the', stopped: true },
  ];
  const saved = entriesFor(messages);
  assert.equal(saved[1].stopped, true, 'the stopped reply is saved with the mark');
  assert.equal(saved[0].stopped, undefined, 'a question never carries the mark');
  assert.equal(messageFromEntry(saved[1], 'a2').stopped, true, 'the mark comes back on load');
  assert.equal(messageFromEntry({ role: 'assistant', content: 'Synthetic finished answer' }, 'a3').stopped, undefined);
  assert.equal(messageFromEntry({ role: 'user', content: 'q', stopped: true }, 'u3').stopped, undefined);
  const finished = entriesFor([{ id: 'u', role: 'user', content: 'q' }, { id: 'a', role: 'assistant', content: 'Synthetic finished answer' }]);
  assert.equal(finished[1].stopped, undefined, 'a finished reply is saved without the mark');
});

test('a stored answer keeps its stopped mark, and showing another answer clears it', async () => {
  const { answerOf, answerFields } = await loadVariants();
  const stored = answerOf({ id: 'a', role: 'assistant', content: 'Synthetic partial', stopped: true });
  assert.equal(stored.stopped, true);
  assert.equal(answerFields(stored).stopped, true, 'switching back to the stopped answer shows it as stopped');
  const finished = answerOf({ id: 'a', role: 'assistant', content: 'Synthetic finished' });
  assert.equal(finished.stopped, undefined);
  assert.ok('stopped' in answerFields(finished) && answerFields(finished).stopped === undefined, 'a finished answer clears the mark');
});
