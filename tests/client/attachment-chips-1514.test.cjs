// #1514: attached files had no chips in the composer or on the sent message; only a status line named them.
// The names now show as chips in the composer, and the message they were sent with keeps them. Pure helper
// and the chip markup are tested directly; the wiring (upload reports saved names, the send carries them,
// the message renders them) is checked in source, since the upload needs the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, { exports: exports_, Object, Array, console,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const { addAttachedNames } = load('attached-files');

test('#1514 the attached list keeps order and never lists a name twice', () => {
  // The module runs in its own realm, so compare as JSON rather than by array prototype.
  const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  same(addAttachedNames([], ['a.pdf', 'b.csv']), ['a.pdf', 'b.csv']);
  same(addAttachedNames(['a.pdf'], ['b.csv', 'a.pdf']), ['a.pdf', 'b.csv']);
  same(addAttachedNames(['a.pdf'], []), ['a.pdf']);
});

async function withSsr(run) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({
    configFile: false,
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'], clipboard: { writeText: () => Promise.resolve() } };
  try {
    await run(server);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('#1514 each attached file is a named chip with its own label; nothing renders with no files', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { FileChips } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const html = renderToStaticMarkup(React.createElement(FileChips, {
      names: ['qa_two_page.pdf', 'qa_sales.csv'], label: 'Attached to this message', className: 'composer-file-chips',
    }));
    assert.match(html, /<ul class="composer-file-chips" aria-label="Attached to this message">/);
    assert.match(html, /<li class="chip file-chip"[^>]*>(?:<svg[\s\S]*?<\/svg>)<span>qa_two_page\.pdf<\/span><\/li>/);
    assert.match(html, /<span>qa_sales\.csv<\/span>/);
    const none = renderToStaticMarkup(React.createElement(FileChips, { names: [], label: 'x', className: 'msg-file-chips' }));
    assert.equal(none, '');
  });
});

test('#1514 an upload reports the names it saved before its refresh, so a failed refresh still shows them', () => {
  const src = read('src/components/ComposerActions.tsx');
  const body = src.slice(src.indexOf('export async function uploadAttachments'), src.indexOf('/** True only for a drag carrying files'));
  assert.match(body, /saved\.push\(file\.name\);/, 'only uploads that saved are named');
  assert.match(body, /if \(saved\.length\) onSaved\?\.\(saved\);\s*\n\s*\/\/ #905[\s\S]*?await onChanged\(\)/, 'reported before onChanged');
});

test('#1514 the send carries the attached files, and the sent message keeps them; the composer then clears', () => {
  const chat = read('src/components/ChatView.tsx');
  assert.match(chat, /\.\.\.\(attached\.length \? \{ files: attached \} : \{\}\)/, 'submit sends the files');
  assert.match(chat, /if \(attached\.length\) setAttachedByChat\(current => \{ const next = \{ \.\.\.current \}; delete next\[chatId\]/, 'composer list cleared after the send');
  const app = read('src/App.tsx');
  // #1512 (turnImageIds) and #1517 (variantFields) sit on the same user turn as the files.
  assert.match(app, /const userMsg: Message = \{ id: uid\(\), role: 'user', content: text, \.\.\.\(sentPin \? \{ skill: sentPin \} : \{\}\), \.\.\.\(sentImages\.length \? \{ turnImageIds: sentImages \} : \{\}\), \.\.\.\(sentFiles \? \{ files: sentFiles \} : \{\}\), \.\.\.variantFields \};/);
  assert.match(chat, /<FileChips names=\{m\.files \?\? \[\]\} label=\{t\('chat\.files\.label'\)\} className="msg-file-chips" \/>/);
});

test('#1514 the composer and message chip styles exist and wrap', () => {
  const css = read('src/styles/noevia.css');
  assert.match(css, /\.composer-file-chips, \.msg-file-chips \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.file-chip > span \{[^}]*overflow-wrap: anywhere/);
});
