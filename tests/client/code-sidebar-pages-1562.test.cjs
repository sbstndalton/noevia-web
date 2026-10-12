// #1562: the Code sidebar lists only destinations that work. Pull requests, Scheduled and Explore
// were interface previews with disabled controls, so they must not appear in the Code navigation.
// Renders the real Sidebar through Vite's SSR pipeline in code mode (effects do not run under SSR,
// so only the static navigation is checked here; the click path is in qa/shared-sidebar.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withSidebar(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    const mod = await server.ssrLoadModule('/src/components/Sidebar.tsx');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    return await fn(mod, React, renderToStaticMarkup);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

function codeNavLabels(html) {
  const nav = html.match(/<nav class="side-nav" aria-label="Coding navigation">([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'the Code navigation renders in code mode');
  return [...nav[1].matchAll(/aria-label="([^"]+)"/g)].map(m => m[1]);
}

const props = { projects: [], chats: [], activeView: 'chat', activeProjectId: null, activeChatId: null, mode: 'code', codePage: 'New task',
  onNewChat() {}, onNewProjectChat() {}, onEnterCode() {}, onOpenPlugins() {}, onOpenProjects() {}, onOpenProject() {}, onOpenChat() {},
  onDeleteChat() {}, onPatchChat() {}, streamingChats: {}, onPatchProject() {}, onEditProject() {}, onDeleteProject() {}, onOpenDiary() {},
  diaryEnabled: false, onOpenSettings() {}, health: {}, theme: 'light', onToggleTheme() {}, onCodePage() {}, showPreviews: true };

test('the Code sidebar lists its one live destination and no preview-only destinations', () => withSidebar((mod, React, render) => {
  const labels = codeNavLabels(render(React.createElement(mod.Sidebar, props)));
  // #1563 (b5) names the Code destination Customise; the 1562 list check follows that wording.
  assert.deepEqual(labels, ['Customise']);
}));

test('Pull requests, Scheduled and Explore are not offered anywhere in the Code navigation', () => withSidebar((mod, React, render) => {
  const html = render(React.createElement(mod.Sidebar, { ...props, codePage: 'Pull requests' }));
  for (const gone of ['Pull requests', 'Scheduled', 'Explore']) assert.doesNotMatch(html, new RegExp(`aria-label="${gone}"`));
}));
