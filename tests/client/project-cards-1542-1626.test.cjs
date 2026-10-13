// #1542: the project card's visible name keeps an identifier such as 20261012-0610 on one line, while its
// accessible name and tooltip keep the plain text. Render-level guard (SSR, the real component and catalogue).
// Layout (no line ends at the hyphen) and the Restore click are proven in a browser by
// qa/project-cards-1542-1626.cjs, because jsdom does not lay text out or hit-test overlays.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withModule(name, fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'] };
  try {
    const mod = await server.ssrLoadModule(name);
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    return await fn(mod, React, renderToStaticMarkup);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

const WJ = '⁠';
const NAME = 'QA Haiku 20261012-0610 renamed';
const PROJECT = { id: 'p1', name: NAME, updatedAt: 1000, files: [], assets: [], memories: [], instructions: '', goal: 'Synthetic goal', sourceFolders: [], toolboxes: ['core'], chats: [], modes: ['chat'], archived: true };
const noop = () => {};
const props = (overrides) => ({ projects: [], onOpenProject: noop, onPatch: noop, onCreate: async () => {}, onEdit: noop, onDelete: noop, ...overrides });

test('the grid card shows the identifier whole: the hyphen inside 20261012-0610 gets a word joiner', () => withModule('/src/components/ProjectsView.tsx', ({ ProjectsView }, React, render) => {
  const html = render(React.createElement(ProjectsView, props({ projects: [{ ...PROJECT, archived: false }] })));
  assert.match(html, new RegExp(`<button class="project-card-open"[^>]*>QA Haiku 20261012-${WJ}0610 renamed</button>`), 'the visible name carries the joiner');
  assert.match(html, /aria-label="Open project QA Haiku 20261012-0610 renamed"/, 'the accessible name keeps the plain text');
}));
