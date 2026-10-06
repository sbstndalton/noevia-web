// Issue #341: Hardware said "no model loaded" whenever the model-loader could not probe the
// llama container (unknown port, refused, timeout), indistinguishable from a genuinely idle
// engine. This is a render-level regression guard for EngineCard's model-state note, loaded
// through Vite's SSR pipeline (so JSX and the real i18n catalogue resolve exactly as in the
// app), following the pattern in customise-i18n-render.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const BASE_BACKEND = {
  name: 'cowork-llama-1',
  found: true,
  status: 'running',
  image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',
  uptime: '2h 5m',
  started_at: '2026-09-25 10:00',
  last_restart_error: null,
  stats: { ok: true, error: null, gpu: null, container: null },
  history: [],
};

// #603: only a running engine shows an uptime. A stopped one reads its state; an older model
// manager that still sends the time since it last started must not be shown as a duration.
test('EngineCard shows uptime for a running engine only, and "Stopped" instead of a duration otherwise', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: path.resolve(__dirname, '../..'),
    server: { middlewareMode: true },
    appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  try {
    global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { dataset: {} } };
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    global.navigator = { language: 'en-GB', languages: ['en-GB'] };
    try {
      await server.ssrLoadModule('/src/i18n/models/index.ts');
      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const { EngineCard } = await server.ssrLoadModule('/src/components/models/HardwareTab.tsx');
      const render = (backend) => renderToStaticMarkup(React.createElement(EngineCard, { backend: { ...BASE_BACKEND, loaded_model: null, probe_error: null, ...backend } }));

      const running = render({ uptime: '2h 5m', uptime_s: 7500 });
      assert.match(running, /up 2 hr,? 5 min|up 2h 5m/, `a running engine shows its uptime: ${running}`);

      // The service now sends null; an older one sent the span since StartedAt (1,182,937 s).
      for (const sent of [{ uptime: null, uptime_s: null }, { uptime: '13d 16h', uptime_s: 1182937 }]) {
        const stopped = render({ status: 'exited', ...sent });
        assert.match(stopped, /· Stopped ·/, `a stopped engine reads "Stopped" in the note: ${stopped}`);
        assert.doesNotMatch(stopped, /\bup \d/, `no uptime for a stopped engine (${JSON.stringify(sent)}): ${stopped}`);
        assert.doesNotMatch(stopped, /13d|1,182,937|1182937/, 'the time since it last started is not shown');
      }
      assert.doesNotMatch(render({ status: 'created', uptime: null, uptime_s: null }), /\bup \d/);
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
});

test('EngineCard model-state note: serving, unavailable-with-reason, and genuinely no model loaded', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: path.resolve(__dirname, '../..'),
    server: { middlewareMode: true },
    appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  try {
    // Minimal browser globals useT()/useAccountPreferences() touch. English is the default
    // (system) locale, so no catalogue chunk needs registering for the base strings -- but the
    // "models" segment (mm.hw.*) is only populated once its index module runs, same as the
    // real app's ModelManagerPage chunk does.
    global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { dataset: {} } };
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    global.navigator = { language: 'en-GB', languages: ['en-GB'] };
    try {
      await server.ssrLoadModule('/src/i18n/models/index.ts');
      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const { EngineCard } = await server.ssrLoadModule('/src/components/models/HardwareTab.tsx');

      const render = (backend) => renderToStaticMarkup(React.createElement(EngineCard, { backend }));

      const loaded = render({ ...BASE_BACKEND, loaded_model: 'gemma-e2b', probe_error: null });
      assert.match(loaded, /serving gemma-e2b/, `expected "serving gemma-e2b": ${loaded}`);
      assert.doesNotMatch(loaded, /no model loaded/);
      assert.doesNotMatch(loaded, /unavailable/i);

      const unavailable = render({ ...BASE_BACKEND, loaded_model: null, probe_error: 'connection refused' });
      assert.match(unavailable, /Model state unavailable: connection refused/, `expected the unavailable note with reason: ${unavailable}`);
      assert.doesNotMatch(unavailable, /no model loaded/, 'a skipped/failed probe must never render as a confident "no model loaded"');

      const portUnknown = render({ ...BASE_BACKEND, loaded_model: null, probe_error: 'port unknown' });
      assert.match(portUnknown, /Model state unavailable: port unknown/);
      assert.doesNotMatch(portUnknown, /no model loaded/);

      const noModel = render({ ...BASE_BACKEND, loaded_model: null, probe_error: null });
      assert.match(noModel, /no model loaded/, `expected "no model loaded" after a successful empty probe: ${noModel}`);
      assert.doesNotMatch(noModel, /unavailable/i);
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
});
