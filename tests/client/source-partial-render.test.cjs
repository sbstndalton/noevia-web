'use strict';
// #700: a document with a page whose text came from the PDF's own text layer (Docling found none)
// must read as partially extracted in the Sources tab, with the reason, in the interface language
// — never as plain "ready". Render-level guard: the real ProjectView, loaded through Vite's SSR
// pipeline with the real catalogues, following projects-header-render.test.cjs. Synthetic project.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function render(locale, project) {
  const { createServer } = require('./vite-ssr-server.cjs');
  // No HMR socket: nothing is served, and a fixed HMR port collides with any other Vite in the run.
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true, hmr: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const set = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  try {
    set('window', { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { pathname: '/', search: '', hash: '' } });
    set('document', { documentElement: { dataset: {}, lang: '' } });
    set('localStorage', { getItem: (key) => (key === 'noevia:account-preferences' ? JSON.stringify({ locale }) : null), setItem() {}, removeItem() {} });
    // Node has a read-only global navigator; define over it and restore it afterwards.
    set('navigator', { language: locale, languages: [locale] });
    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    if (locale !== 'en-GB') {
      const name = locale.replace('-', '_').toUpperCase();
      core.registerCatalogue(locale, (await server.ssrLoadModule(`/src/i18n/${locale}.ts`))[name]);
    }
    const { ProjectView } = await server.ssrLoadModule('/src/components/ProjectView.tsx');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const noop = () => {};
    return renderToStaticMarkup(React.createElement(ProjectView, {
      project, requestedTab: 'sources', onNewChat: noop, onSendFirst: noop, onSave: async () => {}, onOpenChat: noop,
      onPatch: noop, onDeleteChat: noop, streamingChats: {}, onRefresh: noop, onOpenModels: noop, onEdit: noop, modelLabel: 'Synthetic model',
    }));
  } finally {
    delete globalThis.window; delete globalThis.document; delete globalThis.localStorage; delete globalThis.navigator;
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    await server.close();
  }
}

const project = (pageStatus, state) => ({
  id: 'p-700', name: 'Synthetic audit', updatedAt: 1000, assets: [], memories: [], instructions: '', goal: '', sourceFolders: [], toolboxes: ['core'], chats: [], modes: ['chat'],
  files: [{ name: 'widget-audit.pdf', content: '[Page 1]\nsynthetic', document: { version: 'v', byteHash: 'b', state, pages: pageStatus.length, pageStatus, indexing: 'ready' } }],
});
const fallback = project([{ number: 1, status: 'native' }, { number: 2, status: 'degraded', reason: 'native-fallback' }, { number: 3, status: 'blank' }], 'partial');

test('a native-fallback document renders as partially extracted with the reason (en-GB)', async () => {
  const html = await render('en-GB', fallback);
  const row = html.match(/<small class="source-status">([^<]*Partially extracted[^<]*)<\/small>/);
  assert.ok(row, 'the source row status renders: ' + html.slice(0, 300));
  assert.match(row[1], /^Partially extracted · 3 pages · check pages 2 · pages 2: layout analysis found no text, so the PDF’s own text layer was used/);
  assert.doesNotMatch(row[1], /ready/i);
});

test('the partial state and its reason are in the interface language (de-DE)', async () => {
  const html = await render('de-DE', fallback);
  assert.match(html, /Teilweise extrahiert/);
  assert.match(html, /Seiten 2: Die Layoutanalyse fand keinen Text/);
  assert.doesNotMatch(html, /Partially extracted|layout analysis found no text/);
});

test('a document whose only empty pages are blank still renders as ready', async () => {
  const html = await render('en-GB', project([{ number: 1, status: 'native' }, { number: 2, status: 'blank' }], 'ready'));
  assert.match(html, /<small class="source-status">Native text ready · 2 pages<\/small>/);
});
