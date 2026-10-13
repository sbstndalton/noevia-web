'use strict';
// #1657: since noevia-core#88 (#1646), "Send to cloud" on the sensitive card also lets that one reply use
// private-data tools (project files, Drive, Nextcloud) on the cloud model. The card now says so in one plain
// sentence under the question. The two buttons keep their behaviour and wording.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
const SENTENCE = 'Sending to the cloud also lets this reply read your project files and connected storage.';
const FLAGS = ['diary', 'secret', 'iban', 'card', 'health', 'router', 'unavailable'];

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
  // Node 21+ exposes navigator as a getter-only accessor, and this file is strict, so a plain assignment throws.
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'], clipboard: { writeText: () => Promise.resolve() } }, configurable: true, writable: true });
  try {
    await run(server);
  } finally {
    delete global.window; delete global.document; delete global.localStorage;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
    await server.close();
  }
}

test('#1657 the sentence is one plain sentence about the cloud reading project files and connected storage', () => {
  assert.equal((SENTENCE.match(/[.!?](\s|$)/g) || []).length, 1, 'one sentence');
  assert.match(SENTENCE, /project files and connected storage\.$/);
  assert.doesNotMatch(SENTENCE, /Nextcloud|Drive|flag|tool|route/i, 'no product or internal jargon in the card');
});

test('#1657 the pending card renders the sentence under the question, before the buttons, for every flag', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { RoutePendingCard } = await server.ssrLoadModule('/src/components/RouteControls.tsx');
    for (const flag of FLAGS) {
      const html = renderToStaticMarkup(React.createElement(RoutePendingCard, { flag, onDecide() {} }));
      const question = html.indexOf('This looks sensitive (');
      const detail = html.indexOf(`data-testid="route-pending-detail">${SENTENCE}</p>`);
      const sendCloud = html.indexOf('>Send to cloud</button>');
      assert.ok(question > -1, `${flag}: the question is shown`);
      assert.ok(detail > question, `${flag}: the sentence comes after the question`);
      assert.ok(sendCloud > detail, `${flag}: the sentence comes before the buttons`);
    }
  });
});

test('#1657 the buttons keep their labels and their choices, and the card still has exactly two of them', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { RoutePendingCard } = await server.ssrLoadModule('/src/components/RouteControls.tsx');
    const html = renderToStaticMarkup(React.createElement(RoutePendingCard, { flag: 'secret', onDecide() {} }));
    assert.match(html, />Send to cloud<\/button>/);
    assert.match(html, />Keep local<\/button>/);
    assert.equal(html.split('<button').length - 1, 2, 'two decision buttons');
  });
});

test('#1657 the card reads the new key through t() and leaves the button handlers as they were', () => {
  const controls = read('components/RouteControls.tsx');
  assert.match(controls, /t\('chat\.routing\.pendingDetail'\)/);
  assert.match(controls, /onClick=\{\(\) => onDecide\('cloud', remember\)\}/);
  assert.match(controls, /onClick=\{\(\) => onDecide\('local', remember\)\}/);
});

test('#1657 every locale with the pending card also has a translated detail sentence', () => {
  const textFor = (locale, key) => {
    const m = read(`i18n/${locale}.ts`).match(new RegExp(`'${key.replace(/\./g, '\\.')}': "([^"]+)"`));
    return m ? m[1] : null;
  };
  const english = textFor('en-GB', 'chat.routing.pendingDetail');
  assert.equal(english, SENTENCE, 'the English sentence matches the card');
  const locales = fs.readdirSync(path.join(ROOT, 'src/i18n')).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f)).map((f) => f.replace(/\.ts$/, ''));
  let checked = 0;
  for (const locale of locales) {
    if (!textFor(locale, 'chat.routing.pending')) continue;
    checked += 1;
    const text = textFor(locale, 'chat.routing.pendingDetail');
    assert.ok(text, `${locale}.ts has no 'chat.routing.pendingDetail'`);
    if (locale !== 'en-GB') assert.notEqual(text, english, `${locale} reuses the English sentence`);
    assert.ok(text.length >= 40, `${locale} sentence is too short to be a sentence`);
    assert.match(text, /\.$/, `${locale} sentence ends with a full stop`);
  }
  assert.ok(checked >= 9, `expected the nine pending-card locales, found ${checked}`);
});
