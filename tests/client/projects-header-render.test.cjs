// #413: Projects reads the shared page-header pattern (.settings-title: a display title plus an
// intro paragraph) instead of its own oversized .projects-hero, and the "New project" action moved
// out of the title row into the tabs/search/sort row below it — no page title anywhere in the app
// carries an inline control. Render-level regression guard, loaded through Vite's SSR pipeline
// (so JSX and the real i18n catalogue resolve exactly as in the app), following the pattern in
// coding-workspace-code-link.test.cjs / customise-i18n-render.test.cjs.
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

const PROJECT = { id: 'p1', name: 'Garden planner', updatedAt: 1000, files: [], assets: [], memories: [], instructions: '', goal: 'Plan the garden', sourceFolders: [], toolboxes: ['core'], chats: [], modes: ['chat'] };
const noop = () => {};
const props = (overrides) => ({ projects: [], onOpenProject: noop, onPatch: noop, onCreate: async () => {}, onEdit: noop, onDelete: noop, ...overrides });

test('the page title uses .settings-title (the pattern Settings/Customise share), not .projects-hero', () => withModule('/src/components/ProjectsView.tsx', ({ ProjectsView }, React, render) => {
  const html = render(React.createElement(ProjectsView, props({ projects: [PROJECT] })));
  assert.match(html, /<div class="settings-title projects-title"><h1>Projects<\/h1>/);
  assert.doesNotMatch(html, /class="projects-hero/, 'the old hero container must not render');
}));

test('"New project" sits in the tabs row, not inside the title', () => withModule('/src/components/ProjectsView.tsx', ({ ProjectsView }, React, render) => {
  const html = render(React.createElement(ProjectsView, props({ projects: [PROJECT] })));
  const titleBlock = html.match(/<div class="settings-title projects-title">.*?<\/div>/s)[0];
  assert.doesNotMatch(titleBlock, /New project/, 'the title block must carry no inline control');
  const headRow = html.match(/<div class="projects-head">.*?New project.*?<\/div>/s);
  assert.ok(headRow, 'the New project button must be in .projects-head');
}));

test('with no projects, the title still renders and the primary action defers to the empty state', () => withModule('/src/components/ProjectsView.tsx', ({ ProjectsView }, React, render) => {
  const html = render(React.createElement(ProjectsView, props({ projects: [] })));
  assert.match(html, /<div class="settings-title projects-title"><h1>Projects<\/h1>/);
  // #413 only moves where the button lives when there are projects; the zero-projects empty
  // state keeps its own single "New project" action (unchanged behaviour).
  assert.match(html, /New project/);
}));
