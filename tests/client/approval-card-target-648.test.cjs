// #648 review: the approval card's resolved file path. The Diary builds its pending card the same
// way chat does, so it carries the path too; and invisible Unicode direction controls in a name,
// path or argument are shown as visible escapes, so what the card displays is what the edit does.
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

const CONTROLS = ['‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩'];

test('every bidi embedding, override, isolate and direction mark becomes a visible escape', () => {
  const { showDirectionControls } = load('visible-controls.ts');
  for (const c of CONTROLS) {
    const code = c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
    assert.equal(showDirectionControls(`a${c}b`), `a<U+${code}>b`);
  }
  // A name that would display as "notes.md" but ends in "exe" read left to right.
  assert.equal(showDirectionControls('noevia projects/Trip/Text/‮dm.exe'), 'noevia projects/Trip/Text/<U+202E>dm.exe');
  // Ordinary text, including accents and right-to-left letters themselves, is untouched.
  for (const s of ['notes.md', 'résumé.md', 'ملاحظات.md', 'noevia projects/QA 648/Text/qa.md', '']) assert.equal(showDirectionControls(s), s);
  const all = showDirectionControls(CONTROLS.join(''));
  assert.doesNotMatch(all, /[‎‏‪-‮⁦-⁩]/);
});

test('the pending card carries the resolved target, in chat and in the Diary', () => {
  const { pendingToolCall } = load('tool-call-state.ts');
  assert.deepEqual({ ...pendingToolCall({ type: 'tool_pending', name: 'project_append_file', args: '{"name":"n.md"}', id: 'ap-1', target: 'noevia projects/P/Text/n.md' }) },
    { name: 'project_append_file', args: '{"name":"n.md"}', status: 'pending', approvalId: 'ap-1', target: 'noevia projects/P/Text/n.md' });
  assert.equal('target' in pendingToolCall({ type: 'tool_pending', name: 'diary_append', args: '{}', id: 'ap-2' }), false);
  assert.equal('target' in pendingToolCall({ type: 'tool_pending', name: 'x', id: 'ap-3', target: '' }), false);
  // Both stream consumers build the card with it (the Diary used to drop `target`).
  const diary = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryView.tsx'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  assert.match(diary, /ev\.type === 'tool_pending' \? pendingToolCall\(ev\)/);
  assert.match(app, /tools\[at\] = pendingToolCall\(ev\);/);
  assert.match(fs.readFileSync(path.join(__dirname, '../../src/diary-extras.ts'), 'utf8'), /target\?: string/, 'the Diary event type keeps the field');
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

test('the rendered card shows the resolved path with direction controls escaped, and keeps all three actions', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ToolCalls } = await server.ssrLoadModule('/src/components/ToolCalls.tsx');
    const html = renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{
      name: 'project_append_file', status: 'pending', approvalId: 'ap-1',
      args: JSON.stringify({ name: '‮dm.exe', text: 'x⁦y' }),
      target: 'noevia projects/Trip/Text/‮dm.exe',
    }] }));
    assert.match(html, /File this changes:/);
    assert.ok(html.includes('noevia projects/Trip/Text/&lt;U+202E&gt;dm.exe'), html);
    assert.ok(html.includes('&lt;U+202E&gt;dm.exe&quot;') || html.includes('&lt;U+202E&gt;dm.exe"'), 'the raw argument is escaped too');
    assert.ok(html.includes('x&lt;U+2066&gt;y'));
    assert.doesNotMatch(html, /[‎‏‪-‮⁦-⁩]/, 'no raw direction control reaches the card');
    for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(html.includes(`>${label}<`), label);
    // Without a target the card is what it was.
    const plain = renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ name: 'diary_append', status: 'pending', approvalId: 'ap-2', args: '{"text":"hi"}' }] }));
    assert.doesNotMatch(plain, /File this changes:/);
  });
});
