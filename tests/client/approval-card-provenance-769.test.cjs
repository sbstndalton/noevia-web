// #769: the approval card names where a write's sensitive argument came from ("Contains text from
// <source> in <field>"), keeps all three actions, and is unchanged when there is no provenance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const load = (file) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', 'src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: () => ({}) });
  return exports;
};

test('the pending card keeps only well-formed provenance notes, in chat and in the Diary', () => {
  const { pendingToolCall } = load('tool-call-state.ts');
  const card = pendingToolCall({ name: 'http_post', args: '{}', id: 'ap-1', provenance: [{ field: 'url', source: 'tool result: web_fetch' }, { field: 'x' }, 'junk', null, { unchecked: true, field: 7 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(card.provenance)), [{ field: 'url', source: 'tool result: web_fetch' }, { field: null, source: null, unchecked: true }]);
  assert.equal('provenance' in pendingToolCall({ name: 'http_post', args: '{}', id: 'ap-2' }), false);
  assert.equal('provenance' in pendingToolCall({ name: 'http_post', args: '{}', id: 'ap-3', provenance: 'not a list' }), false);
  assert.match(fs.readFileSync(path.join(__dirname, '../../src/diary-extras.ts'), 'utf8'), /provenance\?: unknown/, 'the Diary event type keeps the field');
});

async function withSsr(run) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({
    configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'] };
  try { await run(server); } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('the rendered card shows the provenance note and all three actions', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ToolCalls } = await server.ssrLoadModule('/src/components/ToolCalls.tsx');
    const html = renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{
      name: 'http_post', status: 'pending', approvalId: 'ap-1', args: JSON.stringify({ url: 'https://collector.example/drop' }),
      provenance: [{ field: 'url', source: 'tool result: web_fetch‮' }],
    }] }));
    assert.ok(html.includes('data-testid="tool-approval-provenance"'), html);
    assert.ok(html.includes('Contains text from tool result: web_fetch&lt;U+202E&gt; in “url”.'), html);
    for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(html.includes(`>${label}<`), label);
    const unchecked = renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ name: 'http_post', status: 'pending', approvalId: 'ap-2', args: '{}', provenance: [{ field: null, source: null, unchecked: true }] }] }));
    assert.match(unchecked, /could not be checked/);
    const plain = renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ name: 'http_post', status: 'pending', approvalId: 'ap-3', args: '{}' }] }));
    assert.doesNotMatch(plain, /tool-approval-provenance/);
  });
});
