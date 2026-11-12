// #2446 slice 4b: a coworker's `space_page_save`. The card for it shows the title, the destination and the whole draft with
// "Approve & save" and "Decline" (no "Allow for this chat"); a finished save renders a chip that opens the page. Synthetic data only.
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


const SPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('the pending call keeps `once` only when the server sent exactly true', () => {
  const { pendingToolCall } = load('tool-call-state.ts');
  assert.equal(pendingToolCall({ name: 'space_page_save', args: '{}', id: 'a1', once: true }).once, true);
  for (const once of [undefined, false, 'true', 1, null]) assert.equal('once' in pendingToolCall({ name: 'w', args: '{}', id: 'a2', once }), false, JSON.stringify(once));
});

test('the draft and the saved page are read only in their expected shapes', async () => {
  await withSsr(async (server) => {
  const { parsePageDraft, parseSavedPage } = await server.ssrLoadModule('/src/coworker-conversation.ts');
  assert.deepEqual({ ...parsePageDraft('{"title":"QA t","content":"# body","spaceId":"s"}') }, { title: 'QA t', content: '# body', spaceId: 's' });
  assert.equal(parsePageDraft('{"title":"QA t","content":"x"}').spaceId, null);
  for (const bad of ['', 'not json', '[]', 'null', '{"title":1,"content":"x"}', '{"title":"t"}', '{"title":"t","content":"x","spaceId":5}']) assert.equal(parsePageDraft(bad), null, bad);
  const ok = JSON.stringify({ pageId: PAGE, spaceId: SPACE, title: 'QA t', link: `/spaces/${SPACE}/${PAGE}` });
  assert.deepEqual({ ...parseSavedPage(ok) }, { title: 'QA t', link: `/spaces/${SPACE}/${PAGE}` });
  for (const link of ['https://evil.example/x', `//evil.example/spaces/${SPACE}/${PAGE}`, `/spaces/${SPACE}`, `/spaces/${SPACE}/${PAGE}/x`, `/spaces/../${PAGE}`, 'javascript:alert(1)'])
    assert.equal(parseSavedPage(JSON.stringify({ title: 't', link })), null, link);
  assert.equal(parseSavedPage(undefined), null);
  assert.equal(parseSavedPage('ERROR: nothing was saved.'), null);
  });
});

test('the card has no chat-wide button for a call the server asks about every time, and keeps it for the others', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ToolCalls } = await server.ssrLoadModule('/src/components/ToolCalls.tsx');
    const render = (extra) => renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ name: 'notes_write', status: 'pending', approvalId: 'ap-1', args: '{}', ...extra }] }));
    assert.ok(render({}).includes('>Allow for this chat<'));
    const once = render({ once: true });
    assert.ok(!once.includes('Allow for this chat'));
    for (const label of ['Allow once', 'Decline']) assert.ok(once.includes(`>${label}<`), label);
  });
});

test('outside a coworker conversation the page save is the plain card, arguments in full', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ToolCalls } = await server.ssrLoadModule('/src/components/ToolCalls.tsx');
    const args = JSON.stringify({ title: 'QA t', content: 'FULL ' + 'x'.repeat(3000) });
    const html = renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ name: 'space_page_save', status: 'pending', approvalId: 'ap-1', args, once: true }] }));
    assert.ok(!html.includes('page-save-approval'));
    assert.ok(html.includes('FULL ' + 'x'.repeat(3000)));
  });
});

test('the page-save card shows the title and the whole draft, with Approve & save and Decline only', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { PageSaveApproval } = await server.ssrLoadModule('/src/components/coworkers/PageSaveApproval.tsx');
    const draft = { title: 'QA <plan>', content: '# Heading\n' + 'line '.repeat(800), spaceId: null };
    const html = renderToStaticMarkup(React.createElement(PageSaveApproval, { draft, coworkerId: 'cc', locked: false, sent: false, err: null, onDecide() {}, containerRef: { current: null } }));
    assert.ok(html.includes('data-testid="page-save-approval"'));
    assert.ok(html.includes('QA &lt;plan&gt;'), 'the title, escaped');
    assert.ok(html.includes('line '.repeat(800)), 'the draft in full');
    assert.ok(html.includes('>Approve &amp; save<') && html.includes('>Decline<'));
    assert.ok(html.includes('data-testid="page-save-checking"'), 'until the destination is known the card says it is checking');
    assert.match(html, /<button[^>]*disabled=""[^>]*>Approve &amp; save<\/button>/, 'and Approve & save waits');
    assert.ok(!html.includes('Allow for this chat') && !html.includes('Allow once'));
    const sent = renderToStaticMarkup(React.createElement(PageSaveApproval, { draft, coworkerId: 'cc', locked: true, sent: true, err: 'Could not send', onDecide() {}, containerRef: { current: null } }));
    assert.equal((sent.match(/disabled/g) || []).length, 2);
    assert.ok(sent.includes('Decision sent') && sent.includes('Could not send'));
  });
});

test('a finished save shows a chip that opens the page; an error or a foreign link shows none', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ToolCalls } = await server.ssrLoadModule('/src/components/ToolCalls.tsx');
    const render = (result) => renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ name: 'space_page_save', status: 'done', args: '{}', result }] }));
    const good = render(JSON.stringify({ pageId: PAGE, spaceId: SPACE, title: 'QA plan', link: `/spaces/${SPACE}/${PAGE}` }));
    assert.ok(good.includes(`data-testid="saved-page-chip"`) && good.includes(`href="/spaces/${SPACE}/${PAGE}"`) && good.includes('>QA plan<'), good);
    assert.doesNotMatch(render('ERROR: That Space is not one this coworker may save to; nothing was saved.'), /saved-page-chip/);
    assert.doesNotMatch(render(JSON.stringify({ title: 'x', link: 'https://evil.example/' })), /saved-page-chip/);
    // Another tool with the same result shape gets no chip.
    const other = renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ name: 'notes_write', status: 'done', args: '{}', result: JSON.stringify({ title: 'x', link: `/spaces/${SPACE}/${PAGE}` }) }] }));
    assert.doesNotMatch(other, /saved-page-chip/);
  });
});

test('every shipped locale words the card', () => {
  const dir = path.join(__dirname, '../../src/i18n/coworkers');
  const keys = ['pageSave.titleLabel', 'pageSave.draftLabel', 'pageSave.ask', 'pageSave.notGranted', 'pageSave.approve', 'pageSave.decline', 'pageSave.group', 'pageSave.checking', 'pageSave.unverified'];
  for (const file of fs.readdirSync(dir).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f) && f !== 'en-US.ts')) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const key of keys) assert.ok(text.includes(`'${key}':`), `${file} lacks ${key}`);
  }
});

test('the destination follows the server\'s rule and says so when it cannot be checked', async () => {
  await withSsr(async (server) => {
    const { destinationOf } = await server.ssrLoadModule('/src/components/coworkers/PageSaveApproval.tsx');
    const co = { spaces: ['s1', 's2'], defaultSpace: 's1' };
    const spaces = [{ id: 's1', name: 'QA notes' }, { id: 's2', name: 'QA notes' }, { id: 's3', name: 'QA other' }];
    const d = (spaceId) => ({ title: 't', content: 'c', spaceId });
    assert.deepEqual({ ...destinationOf(d(null), co, spaces, false) }, { kind: 'ok', name: 'QA notes' });
    assert.deepEqual({ ...destinationOf(d('s2'), co, spaces, false) }, { kind: 'ok', name: 'QA notes' });
    assert.equal(destinationOf(d('s3'), co, spaces, false).kind, 'notGranted', 'a Space outside the grant');
    assert.equal(destinationOf(d(null), { spaces: ['s1'], defaultSpace: null }, spaces, false).kind, 'notGranted', 'no default and none named');
    assert.equal(destinationOf(d(null), null, null, false).kind, 'checking');
    assert.equal(destinationOf(d(null), co, null, false).kind, 'checking');
    assert.deepEqual({ ...destinationOf(d('s9'), co, spaces, true) }, { kind: 'unverified', spaceId: 's9' }, 'a failed read is not "will be refused"');
    assert.deepEqual({ ...destinationOf(d(null), co, spaces.filter((x) => x.id !== 's1'), false) }, { kind: 'unverified', spaceId: 's1' }, 'granted but not in the list');
  });
});

test('inside a coworker conversation the plain card stands in while the page-save card loads, and an MCP tool of that name keeps the plain card', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ToolCalls } = await server.ssrLoadModule('/src/components/ToolCalls.tsx');
    const { CoworkerConversation } = await server.ssrLoadModule('/src/coworker-conversation.ts');
    const args = JSON.stringify({ title: 'QA t', content: 'FULL ' + 'x'.repeat(2000) });
    const render = (extra) => renderToStaticMarkup(React.createElement(CoworkerConversation.Provider, { value: 'cc' }, React.createElement(ToolCalls, { calls: [{ name: 'space_page_save', status: 'pending', approvalId: 'ap-1', args, once: true, ...extra }] })));
    const loading = render({});
    assert.ok(loading.includes('>Allow once<') && loading.includes('>Decline<'), 'an approval is never left without its buttons');
    assert.ok(!loading.includes('Allow for this chat'));
    assert.ok(loading.includes('FULL ' + 'x'.repeat(2000)), 'and the draft in full');
    const mcp = render({ server: 'notes-server' });
    assert.ok(mcp.includes('>via notes-server<') && !mcp.includes('page-save-approval'));
  });
});
