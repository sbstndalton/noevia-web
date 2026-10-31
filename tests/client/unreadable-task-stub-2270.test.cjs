// #2270: the server lists a journal it cannot read as a bare stub ({ id, status: 'unreadable' }),
// with no capabilities, createdAt or updatedAt. The Code tab used to throw on it (capabilities.map,
// new Date(undefined).toISOString()) and the Browser card showed a blank status. Rendered here through
// Vite's SSR pipeline with the stub next to a normal task, in English and German.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const STUB = { id: 'journal-bad', status: 'unreadable' };
const GOOD = { id: 'ok', status: 'completed', stage: null, error: null, createdAt: 1000, updatedAt: 5000, task: 'Fix it', branch: 'b', capabilities: ['read_repository'], steps: [], plan: null, assistantOutput: null, approval: null, result: null };
const noop = () => {};

async function render(language) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({
    configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language, languages: [language] };
  try {
    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    core.registerCatalogue('de-DE', (await server.ssrLoadModule('/src/i18n/de-DE.ts')).DE_DE);
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { TaskCard } = await server.ssrLoadModule('/src/components/code/CodePanel.tsx');
    const { BrowserTaskCard } = await server.ssrLoadModule('/src/components/browser/BrowserPanel.tsx');
    const props = { busy: '', onDecide: noop, onCancel: noop };
    const html = (el) => renderToStaticMarkup(el);
    return {
      code: html(React.createElement(TaskCard, { task: STUB, ...props })),
      codeGood: html(React.createElement(TaskCard, { task: GOOD, ...props })),
      browser: html(React.createElement(BrowserTaskCard, { task: STUB, ...props })),
    };
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('an unreadable task renders a minimal card in both panels, with no actions', async () => {
  const { code, codeGood, browser } = await render('en-GB');
  for (const html of [code, browser]) {
    assert.match(html, /class="code-status">Unreadable</);
    assert.match(html, /task&#x27;s record can&#x27;t be read|task's record can't be read/);
    assert.doesNotMatch(html, /<button|<time|NaN|Invalid/);
  }
  assert.match(codeGood, /<time dateTime=/, 'a normal task still renders as before');
});

test('the label is translated', async () => {
  const { code } = await render('de-DE');
  assert.match(code, /class="code-status">Nicht lesbar</);
  assert.match(code, /kann nicht gelesen werden/);
});

test('every catalogue carries the two labels', () => {
  const fs = require('node:fs');
  for (const f of fs.readdirSync(path.join(__dirname, '../../src/i18n')).filter(n => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(n) && n !== 'en-US.ts')) {
    const src = fs.readFileSync(path.join(__dirname, '../../src/i18n', f), 'utf8');
    assert.match(src, /'code\.status\.unreadable':/, f);
    assert.match(src, /'code\.task\.unreadable':/, f);
  }
});
