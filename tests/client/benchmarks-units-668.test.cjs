// #668: Models -> Benchmarks used a hard-coded " tok/s" in the sweep table, the speed chart and the
// prompt-suite table. They now use the localized unit the rest of the app uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const RUN = {
  run: { id: 7, backend: 'llama', status: 'done', started_at: 1, finished_at: 2, reps: 1, max_tokens: 64, note: '' },
  variants: [],
  results: [{ id: 1, alias: 'alpha', prompt_name: 'p1', rep: 1, cold: 0, contended: 0, err: '', ttft_ms: 10, ttft_answer_ms: 10, total_ms: 100, prompt_n: 5, gen_n: 20, gen_tps: 42.5, draft_acc: null, peak_vram_json: '{}', truncated: 0, response_text: '' }],
  sweeps: [{ id: 1, alias: 'alpha', test: 'tg', n_prompt: 0, n_gen: 32, n_depth: 0, avg_ts: 55.5, stddev_ts: 1.5 }],
  badges: {},
  charts: { capacity_gb: 0, aliases: ['alpha'], gen: [{ label: 'p1', data: [42.5] }], ttft: [{ label: 'p1', data: [10] }], vram_labels: [], vram_measured: [], vram_predicted: [] },
};

async function render(locale, base, models) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: (k) => (k === 'noevia:account-preferences' ? JSON.stringify({ notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale }) : null), setItem() {}, removeItem() {} };
  global.navigator = { language: locale, languages: [locale] };
  try {
    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    core.registerCatalogue(locale, (await server.ssrLoadModule(`/src/i18n/${locale}.ts`))[base]);
    core.registerSegment('models', locale, (await server.ssrLoadModule(`/src/i18n/models/${locale}.ts`))[models]);
    const { RunView } = await server.ssrLoadModule('/src/components/models/BenchmarksTab.tsx');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    return renderToStaticMarkup(React.createElement(RunView, { id: 7, categories: [], initial: RUN }));
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('Benchmarks views show the localized tokens/s unit in French', async () => {
  const html = await render('fr-FR', 'FR_FR', 'FR_FR_MODELS');
  assert.doesNotMatch(html, /tok\/s/);
  assert.match(html, /55,5 ± 1,5 jetons\/s/, 'sweep cell');
  assert.match(html, /42,5 jetons\/s<small>/, 'prompt-suite cell');
  assert.match(html, /42,5 jetons\/s<\/b>/, 'chart label');
});

test('Benchmarks views show the localized tokens/s unit in German', async () => {
  const html = await render('de-DE', 'DE_DE', 'DE_DE_MODELS');
  assert.doesNotMatch(html, /tok\/s/);
  assert.match(html, /55,5 ± 1,5 Token\/s/);
  assert.match(html, /42,5 Token\/s<small>/);
});
