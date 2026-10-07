// #887: the approval card says which MCP server a write goes to ("via <server>") from the tool_pending
// event's `server`; all three actions and the full arguments are unchanged, and nothing shows without it.
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


test('the pending card keeps a string server id, in chat and in the Diary, and nothing else', () => {
  const { pendingToolCall } = load('tool-call-state.ts');
  assert.equal(pendingToolCall({ name: 'w', args: '{}', id: 'a1', server: 'dir-notes' }).server, 'dir-notes');
  for (const server of [undefined, '', 7, null, {}, ['x']]) assert.equal('server' in pendingToolCall({ name: 'w', args: '{}', id: 'a2', server }), false, JSON.stringify(server));
  assert.equal(pendingToolCall({ name: 'w', args: '{}', id: 'a3', server: 'x'.repeat(500) }).server.length, 200);
  assert.match(fs.readFileSync(path.join(__dirname, '../../src/diary-extras.ts'), 'utf8'), /server\?: string/, 'the Diary event type keeps the field');
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

test('the rendered card names the server, keeps all three actions and the full arguments, and shows no line without a server', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ToolCalls } = await server.ssrLoadModule('/src/components/ToolCalls.tsx');
    const args = JSON.stringify({ path: 'Synthetic/' + 'long-path-'.repeat(30), content: 'FULL ' + 'x'.repeat(3000) });
    const render = (extra) => renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ name: 'notes_write', status: 'pending', approvalId: 'ap-1', args, ...extra }] }));
    const withServer = render({ server: 'nextcloud' });
    assert.ok(withServer.includes('data-testid="tool-approval-server"'), withServer);
    assert.ok(withServer.includes('>via nextcloud<'), withServer);
    for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(withServer.includes(`>${label}<`), label);
    assert.ok(withServer.includes('FULL ' + 'x'.repeat(3000)), 'arguments are not truncated');
    // A direction-control character in an id is printed as a visible escape, like the tool name.
    assert.ok(render({ server: 'evil\u202Eid' }).includes('via evil&lt;U+202E&gt;id'));
    assert.doesNotMatch(render({}), /tool-approval-server/);
  });
});
