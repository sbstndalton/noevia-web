// #1567: no blank pane and no empty-state copy while data loads. The sidebar shows a placeholder until the project
// list has loaded (the "Create a project" hint only for a confirmed zero, or after a failed load), and the Diary's
// own placeholder has the calendar's shape. Static renders only (react-dom/server); synthetic data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../src/styles/noevia.css'), 'utf8');
const components = fs.readFileSync(path.join(__dirname, '../../src/styles/system/components.css'), 'utf8');

async function withServer(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  try {
    global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { dataset: {} }, cookie: '', visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
    try {
      await fn(server, require('react'), require('react-dom/server').renderToStaticMarkup);
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
}

test('the placeholder classes are styled, and the shared shimmer they use is still defined', () => {
  for (const selector of ['.sidebar-skeleton {', '.diary-file-skeleton {', '.view-loading.diary-skeleton {', '.diary-skeleton-grid {']) {
    assert.ok(css.includes(selector), `${selector} is not styled`);
  }
  assert.match(components, /\.skeleton, \.coding-skeleton-block \{/, 'the shimmer block the placeholders use is still there');
});

test('the sidebar shows a placeholder while the project list loads, and the empty copy only once it has', () => withServer(async (server, React, renderToStaticMarkup) => {
  const { Sidebar } = await server.ssrLoadModule('/src/components/Sidebar.tsx');
  const noop = () => {};
  const render = (extra) => renderToStaticMarkup(React.createElement(Sidebar, {
    projects: [], chats: [], activeView: 'chat', activeProjectId: null, activeChatId: null, onNewChat: noop, onNewProjectChat: noop,
    onEnterCode: noop, onOpenPlugins: noop, onOpenProjects: noop, onOpenProject: noop, onOpenChat: noop, onDeleteChat: noop,
    onPatchChat: noop, streamingChats: {}, onPatchProject: noop, onEditProject: noop, onDeleteProject: noop, onOpenDiary: noop,
    diaryEnabled: true, onOpenSettings: noop, theme: 'dark', onToggleTheme: noop, ...extra,
  }));
  const loading = render({ projectsLoaded: false });
  assert.match(loading, /class="sidebar-skeleton"/, 'a placeholder shows while the list loads');
  assert.doesNotMatch(loading, /Create a project from the Projects page\./, 'no empty-state copy before the list has loaded');

  const confirmedEmpty = render({ projectsLoaded: true });
  assert.doesNotMatch(confirmedEmpty, /sidebar-skeleton/);
  assert.match(confirmedEmpty, /Create a project from the Projects page\./, 'a confirmed zero still shows the hint');

  // A failed load does not leave the placeholder up for ever: it falls back to the hint, as before.
  const failed = render({ projectsLoaded: false, projectsFailed: true });
  assert.doesNotMatch(failed, /sidebar-skeleton/);
  assert.match(failed, /Create a project from the Projects page\./);
}));

test('the Diary placeholder has the calendar shape, and keeps its words for screen readers', () => withServer(async (server, React, renderToStaticMarkup) => {
  const { ViewLoading } = await server.ssrLoadModule('/src/lazy-views.tsx');
  const html = renderToStaticMarkup(React.createElement(ViewLoading, { name: 'diary', active: true }));
  assert.match(html, /class="view-loading diary-skeleton" role="status" aria-busy="true"/);
  assert.equal((html.match(/diary-skeleton-grid/g) || []).length, 1);
  assert.equal((html.match(/class="skeleton"/g) || []).length, 2 + 35 + 4, 'title, month grid cells and side rows');
  assert.match(html, /<span class="sr-only">Loading Diary…<\/span>/, 'the announced text stays for assistive tech');
  const plain = renderToStaticMarkup(React.createElement(ViewLoading, { name: 'projects', active: true }));
  assert.doesNotMatch(plain, /diary-skeleton/);
  assert.match(plain, /class="view-loading" role="status"/);
}));
