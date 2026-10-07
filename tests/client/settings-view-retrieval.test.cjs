// #340: Settings → Service status must not say "Project retrieval: Available" while the
// embedding endpoint is unreachable. SettingsView's 'status' section takes `health` as a plain
// prop (no internal fetch), so — unlike CapabilitiesCard's effect-driven fetch — it renders
// deterministically from a given HealthState with react-dom/server, the same real module graph
// approach customise-i18n-render.test.cjs uses (Vite SSR so JSX/CSS imports resolve exactly as
// the app does).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withSettingsView(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'] };
  try {
    // Registers the English Settings segment as a side effect, exactly as SettingsShell's real
    // lazy import of the segment does — without it, serviceStatus.* keys render as their own
    // literal key names (see i18n.test.cjs: "without the view code an unknown key renders as the
    // key"), which would make this test pass on a broken translation too.
    await server.ssrLoadModule('/src/i18n/settings/index.ts');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { SettingsView } = await server.ssrLoadModule('/src/components/SettingsView.tsx');
    const render = (health) => renderToStaticMarkup(React.createElement(SettingsView, {
      section: 'status', models: [], modelsError: null, health, stats: null,
      diaryEnabled: false, onDiaryEnabledChange: () => {}, onOpenModelManager: () => {},
    }));
    return await fn(render);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('#340 retrieval "degraded" renders "Degraded", the one-line note, and never "Available"', () => withSettingsView((render) => {
  const html = render({ inferenceUp: true, diaryUp: null, ragAvailable: true, retrieval: 'degraded' });
  assert.match(html, /Project retrieval/);
  assert.match(html, /Degraded/);
  assert.match(html, /small files and source excerpts still reach the model; semantic search does not/i);
  // The old boolean (ragAvailable: true) must not make this read as fully available.
  const retrievalRow = html.slice(html.indexOf('Project retrieval'), html.indexOf('Project retrieval') + 400);
  assert.doesNotMatch(retrievalRow, />available</, 'a degraded probe must not render as plain "available"');
}));

test('#340 retrieval "available" renders "available" and no degraded note', () => withSettingsView((render) => {
  const html = render({ inferenceUp: true, diaryUp: null, ragAvailable: true, retrieval: 'available' });
  assert.match(html, /Project retrieval/);
  const retrievalRow = html.slice(html.indexOf('Project retrieval'), html.indexOf('Project retrieval') + 400);
  assert.match(retrievalRow, />available</);
  assert.doesNotMatch(html, /semantic search does not/i);
}));

test('#340 retrieval "unavailable" (missing native deps) renders "unavailable"', () => withSettingsView((render) => {
  const html = render({ inferenceUp: true, diaryUp: null, ragAvailable: false, retrieval: 'unavailable' });
  const retrievalRow = html.slice(html.indexOf('Project retrieval'), html.indexOf('Project retrieval') + 400);
  assert.match(retrievalRow, />unavailable</);
  assert.doesNotMatch(html, /semantic search does not/i);
}));

test('#340 an older/mixed deployment sending only the boolean ragAvailable still reads truthfully', () => withSettingsView((render) => {
  // No `retrieval` field at all — SettingsView must fall back to the plain boolean rather than
  // crashing or silently treating it as unavailable/available with no signal.
  const up = render({ inferenceUp: true, diaryUp: null, ragAvailable: true });
  assert.match(up.slice(up.indexOf('Project retrieval'), up.indexOf('Project retrieval') + 400), />available</);
  const down = render({ inferenceUp: true, diaryUp: null, ragAvailable: false });
  assert.match(down.slice(down.indexOf('Project retrieval'), down.indexOf('Project retrieval') + 400), />unavailable</);
}));
