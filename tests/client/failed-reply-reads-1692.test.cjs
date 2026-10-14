// #1692: a reply that failed before its answer keeps no text, so the next turn's history carries the reads it did
// finish (bounded), and the server folds them in under its own note. Writes keep their #658/#666 entries, failed
// reads and a reply that has an answer add nothing. Synthetic transcripts only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function load(name) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  try { return await server.ssrLoadModule(name); } finally { await server.close(); }
}

const read = (name, result, extra = {}) => ({ name, args: '{}', status: 'done', result, ...extra });

test('#1692: the finished reads of a failed reply are sent; failed reads, writes and answered replies are not', async () => {
  const aw = await load('/src/applied-writes.ts');
  const history = aw.modelHistory([
    { id: 'u1', role: 'user', content: 'Search the web for the synthetic release.' },
    { id: 'a1', role: 'assistant', content: '', error: true, toolCalls: [
      read('tavily_search', 'ERROR: tavily_search was rate limited by its provider (HTTP 429).'),
      read('tavily_research', 'Synthetic release 1.2.3, https://example.invalid/notes'),
      read('tavily_extract', '', { status: 'stopped' }),
    ] },
    { id: 'u2', role: 'user', content: 'How many days ago was that?' },
    { id: 'a2', role: 'assistant', content: 'Ten days. Source: https://example.invalid/notes', toolCalls: [read('get_current_time', 'synthetic time')] },
  ]);
  assert.deepEqual(history, [
    { role: 'user', content: 'Search the web for the synthetic release.' },
    { role: 'tool', name: 'tavily_research', content: 'Synthetic release 1.2.3, https://example.invalid/notes' },
    { role: 'user', content: 'How many days ago was that?' },
    { role: 'assistant', content: 'Ten days. Source: https://example.invalid/notes' },
  ]);
});

test('#1692: an applied write in a failed reply keeps its #658 entry and is not repeated as a read', async () => {
  const aw = await load('/src/applied-writes.ts');
  const history = aw.modelHistory([
    { id: 'u1', role: 'user', content: 'Append a line.' },
    { id: 'a1', role: 'assistant', content: '', error: true, toolCalls: [read('project_append_file', 'appended', { applied: true, target: 'notes.md' })] },
  ]);
  assert.equal(history.filter((h) => h.role === 'tool').length, 1);
  assert.equal(history[1].applied, true);
});

test('#1692: at most FAILED_REPLY_READS reads are sent for one reply', async () => {
  const aw = await load('/src/applied-writes.ts');
  const calls = Array.from({ length: 9 }, (_, i) => read(`synthetic_read_${i}`, `result ${i}`));
  const history = aw.modelHistory([{ id: 'u1', role: 'user', content: 'Go.' }, { id: 'a1', role: 'assistant', content: '', error: true, toolCalls: calls }]);
  assert.equal(history.filter((h) => h.role === 'tool').length, aw.FAILED_REPLY_READS);
});
