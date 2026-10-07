// #368: the sidebar's Code workspace ("New task") is a hard-coded, always-disabled preview stub.
// An admin with the real Code harness (useCodeAccess, shared with ProjectView's working <CodePanel>)
// should be sent to a project's own Code tab instead of staring at "Interface preview · no
// execution" forever. useCodeAccess resolves through an effect (useFeatureFlags + a fetch), and
// react-dom/server's static renderer never runs effects (see customise-i18n-render.test.cjs) — so
// this covers what a plain Node test safely can: the exported, hook-free project picker
// (CodeProjectPicker) that CodingWorkspace switches to once access is granted, and the guarantee
// that the initial render — before that effect has resolved anything — is still the honest stub,
// unchanged, exactly as it is for a viewer who never gets access. The effect-driven "access flips
// to true" transition itself needs a real browser and belongs with the Playwright qa/ scripts.
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

test('CodeProjectPicker lists real projects and labels the way in, one per project', () => withModule('/src/components/CodingWorkspace.tsx', ({ CodeProjectPicker }, React, render) => {
  const html = render(React.createElement(CodeProjectPicker, { projects: [{ id: 'p1', name: 'Garden planner' }, { id: 'p2', name: 'Invoice bot' }], onOpen: () => {} }));
  assert.match(html, /Garden planner/);
  assert.match(html, /Invoice bot/);
  assert.match(html, /Open Code/);
  // The generic "not connected yet" stub language must not leak into the working path.
  assert.doesNotMatch(html, /Interface preview/);
  assert.doesNotMatch(html, /not connected yet/);
}));

test('CodeProjectPicker with no projects points at creating one instead of an empty list', () => withModule('/src/components/CodingWorkspace.tsx', ({ CodeProjectPicker }, React, render) => {
  const html = render(React.createElement(CodeProjectPicker, { projects: [], onOpen: () => {} }));
  assert.match(html, /Create a project/);
  assert.doesNotMatch(html, /Open Code/);
}));

test('the initial render — before useCodeAccess\' effect resolves anything — keeps the honest stub for every page, whether or not a navigation callback was even wired up', () => withModule('/src/components/CodingWorkspace.tsx', ({ CodingWorkspace }, React, render) => {
  for (const onOpenProjectCode of [undefined, () => {}]) {
    const html = render(React.createElement(CodingWorkspace, { page: 'New task', projects: [{ id: 'p1', name: 'Garden planner' }], onOpenProjectCode }));
    assert.match(html, /Interface preview · no execution/, 'the preview badge must not swap before access is known');
    assert.match(html, /What should we build next/);
    assert.match(html, /not connected yet/);
    assert.doesNotMatch(html, /Open Code/, 'the picker must not render before useCodeAccess resolves');
  }
}));

test('a viewer without a wired-up navigation callback always sees the stub, never the picker, regardless of page', () => withModule('/src/components/CodingWorkspace.tsx', ({ CodingWorkspace }, React, render) => {
  const html = render(React.createElement(CodingWorkspace, { page: 'Pull requests', projects: [] }));
  assert.match(html, /Interface preview · no execution/);
  assert.doesNotMatch(html, /Open Code/);
}));
