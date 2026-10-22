'use strict';
// Shared by the #1761 / #1765 / #1795 / #1796 QA scripts: the Models page and Settings → Experimental
// over noevia-core's REAL model list, service overview and decision-settings code, fed synthetic
// inputs only (a fake model manager, a fake managed embedding service, an in-memory settings store).
// No model server, no decision service, no network: the page's /api/** calls are answered in-process.
//
// QA_CORE_SERVER names the noevia-core server/ directory to use, so a run against an older core shows
// the "before" state.
const path = require('node:path');

// Default: the CI workspace's server/ beside qa/, else a sibling noevia-core checkout (as diary-fixture.cjs).
const fs = require('node:fs');
const CORE = path.resolve(process.env.QA_CORE_SERVER || [path.join(__dirname, '../server'), path.join(__dirname, '../../noevia-core/server')].find((d) => fs.existsSync(path.join(d, 'decision-settings.cjs'))) || path.join(__dirname, '../server'));
process.env.QA_CORE_SERVER = CORE; // diary-fixture.cjs reads its route table from the same core
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const core = (file) => require(path.join(CORE, file));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);

const EMBED = 'embeddinggemma-2-Q8_0';
const STALE_LAYA = 'laya_multilingual_f16';
// The live deployment's shape (#1639): Kev answers the shared decisions, Laya the sensitivity check.
const ENV = {
  MODEL_LOADER_URL: 'http://model-loader.invalid', EMBEDDING_SERVICE_URL: 'http://embed.invalid:8080', EMBEDDING_MODEL: EMBED,
  COWORK_DECISION_URL: 'http://kev:11435', COWORK_DECISION_MODEL: 'kev-0.8b', COWORK_SENSITIVITY_DECISION_URL: 'http://laya:8040',
};
const ROLES = { fast: 'Qwen3.5-4B', smart: 'Qwen3.5-9B', code: 'Qwen3.5-9B', vision: 'gemma-4-12b-it' };
// #1665: the live reranker (core#121): the TEI gte sidecar, switched on by the deployment.
const RERANK_ENV = { NOEVIA_FEATURE_RAG_RERANK: 'true', RERANK_BACKEND: 'tei', RERANK_BASE_URL: 'http://rerank.invalid:8080', RERANK_MODEL: 'gte-multilingual-reranker-base' };

/**
 * One synthetic server state. `rerankModel` (#2114): the reranker's model id, for a long one. `embedLoaded`: whether the managed embedding service reports its model
 * loaded. `savedDecisionUrl`: a decision URL an administrator saved in Settings (or none).
 */
async function createState({ embedLoaded = true, savedDecisionUrl = null, rerank = false, member = false, rerankSavedOutside = false, rerankModel = '' } = {}) {
  // #1665: `rerank` adds the live reranker environment; `member` signs in a member instead of the administrator.
  // #1817: `rerankSavedOutside` saves a llama.cpp reranker choice that the catalogue no longer offers (its address is configured).
  const env = { ...ENV, ...(rerank || rerankSavedOutside ? RERANK_ENV : {}), ...(rerankModel ? { RERANK_MODEL: rerankModel } : {}), ...(rerankSavedOutside ? { RERANK_LLAMACPP_BASE_URL: 'http://rerank-llama.invalid:8091' } : {}) };
  // Router rows as llama.cpp lists them: one chat model asleep after its idle time (#1747/#1758), one
  // loaded, one unloaded, the embedding model (the router's own status says nothing about the sidecar)
  // and the stale Laya preset (#1796).
  const rows = [
    { id: 'Qwen3.5-9B', status: { value: 'sleeping' } },
    { id: 'Qwen3.5-4B', status: { value: 'loaded' } },
    { id: 'gemma-4-12b-it', labels: ['vision'], status: { value: 'unloaded' } },
    { id: EMBED, labels: ['embedding'], status: { value: 'unloaded' } },
    { id: STALE_LAYA, status: { value: 'unloaded' } },
  ];
  const health = ['Qwen3.5-9B', 'Qwen3.5-4B']; // the llama.cpp adapter reports a sleeping model as available (#1758)
  const modelManager = {
    enabled: true, kind: 'llamacpp', capabilities: {}, requireEnabled() {},
    listModels: async () => ({ ok: true, status: 200, body: { data: rows } }),
    health: async () => ({ ok: true, body: { all_models_loaded: health.map((model_name) => ({ model_name, loaded: true })) } }),
  };
  // The model manager: its backend probe does not list the managed embed container; the embedding
  // service answers for it (#1668).
  const embedStatus = { managed: true, enabled: true, models: [{ model: EMBED, file: `embed/${EMBED}.gguf` }], previous: [],
    running: { reachable: true, loaded: embedLoaded ? [EMBED] : [], listed: [EMBED] } };
  const loaderFetch = async (url) => {
    if (url.endsWith('/api/v1/backends')) return { ok: true, status: 200, body: { backends: [] } };
    if (url.endsWith('/api/v1/embedding-service')) return { ok: true, status: 200, body: embedStatus };
    return { ok: false, status: 404, body: {} };
  };
  const embeddingService = core('embedding-service.cjs');
  const svc = embeddingService.createEmbeddingService({ env, fetchJson: loaderFetch, log: () => {} });
  embeddingService.install(svc);
  await svc.refresh();

  // The auto-roles go through core's real route over this in-memory workspace (#1667 saves a Creative role).
  const workspace = { userId: 'qa-admin', autoRoles: { ...ROLES }, saveAutoRoles() {} };
  const service = core('models.cjs').createModelService({ fetchJson: loaderFetch, env, modelManager, currentWorkspace: () => workspace, listWorkspaces: () => [] });

  const values = new Map();
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  const audits = [];
  if (rerankSavedOutside) values.set('rerank:configuration', JSON.stringify({ enabled: true, choice: 'llamacpp:synthetic-gone-reranker' }));
  const decisionSettings = core('decision-settings.cjs').createDecisionSettings({ store, env, fetchImpl: async () => Response.json({ ready: true }), audit: (...a) => audits.push(a) });
  if (savedDecisionUrl) decisionSettings.save({ url: savedDecisionUrl, timeoutMs: 1200 }, 'qa-admin');
  // #1665: the reranker switch, when this core has it (an older core shows the "before" state).
  const rerankSettings = fs.existsSync(path.join(CORE, 'rerank-settings.cjs')) ? core('rerank-settings.cjs').createRerankSettings({ store, env, audit: (...a) => audits.push(a) }) : null;
  const features = core('features.cjs').createFeatures({ store, env: {}, availability: { stepSupervision: decisionSettings.unavailable, systemOneRouting: decisionSettings.unavailable, toolGate: decisionSettings.unavailable } });

  const respond = (out) => (res, status, body) => { out.status = status; out.body = body; };
  const featureRoutes = (out) => core('routes/features.cjs').createFeatureRoutes({ features, decisionSettings, json: respond(out), readJson: async (req) => req.body });
  const modelRoutes = (out) => core('routes/models.cjs').createModelRoutes({
    servedEmbeddingModels: async () => [EMBED], json: respond(out), readBody: async (req) => (req.body === undefined ? '' : JSON.stringify(req.body)), readJson: async (req) => req.body || {},
    fetchJson: loaderFetch, env, modelManager, getProvider: () => ({}), providerHeaders: () => ({}), DEFAULT_PROVIDER_ID: 'default',
    createVisionProbe: () => async () => ({ supported: true }), reportedTokenRate: () => null, missingRoles: () => [],
    currentWorkspace: () => workspace, service, decisionSettings, ...(rerankSettings ? { rerankSettings } : {}),
  });
  const user = member ? { id: 'qa-member', username: 'qa-member', displayName: 'Synthetic member', role: 'member', diaryEnabled: true, onboarded: true }
    : { id: 'qa-admin', username: 'qa-admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true };
  const calls = [];

  /** Answers one API request through the real core routes, or null when no route here handles it. */
  async function handle(method, pathname, body) {
    const out = {};
    const req = { method, body, headers: {}, [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
    const ctx = { path: pathname, authn: { user }, url: new URL(`http://localhost${pathname}`) };
    calls.push([method, pathname]);
    if (pathname === '/api/profile' || pathname === '/api/auth/session') return { status: 200, body: { user, passkeys: [] } };
    if (pathname === '/api/models/capabilities') return { status: 200, body: { kind: 'llamacpp', admin: !member, presets: true, download: true, runtimeOptions: false, modelManagement: !member } };
    if (pathname.startsWith('/api/model-manager/')) {
      const r = pathname.slice('/api/model-manager/'.length);
      if (r === 'models') return { status: 200, body: { models: [], unregistered: [], revision: 'r1' } };
      if (r === 'overview') return { status: 200, body: { modelsDir: { disk: { total: 1e12, free: 5e11, usedPct: 50, totalH: '1 TB', freeH: '500 GB' } }, revision: 'r1' } };
      if (r === 'models/updates') return { status: 200, body: { status: {} } };
      if (r === 'sections') return { status: 200, body: { revision: 'r1', sections: [] } };
      return { status: 200, body: {} };
    }
    if (pathname === '/api/models/installed' || pathname === '/api/models/assignments' || pathname === '/api/models/reranker' || pathname === '/api/auto-roles') {
      await modelRoutes(out)(req, { setHeader() {} }, ctx);
      return out.status ? out : null;
    }
    if (pathname.startsWith('/api/admin/decision-settings') || pathname.startsWith('/api/admin/features') || pathname === '/api/features') {
      const handled = await featureRoutes(out)(req, { setHeader() {} }, ctx);
      return handled ? out : null;
    }
    if (pathname.startsWith('/api/models/')) return { status: 200, body: [] };
    return null;
  }
  return { handle, values, audits, calls, workspace, close: () => embeddingService.install(null) };
}

/** A page whose /api/** goes to `state` (everything else to the diary fixture's synthetic APIs). */
async function openPage(browser, state, { width, height, theme }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    let body; try { body = req.postDataJSON() ?? undefined; } catch { body = undefined; }
    const out = await state.handle(req.method(), url.pathname, body);
    if (!out) return route.continue();
    return route.fulfill({ status: out.status, json: out.body });
  });
  return { page, errors };
}

/** Runs `body(check, browser)` with a fixture on `port`, prints PASS/FAIL lines and sets the exit code. */
async function run(name, port, body) {
  const fixture = createFixture(port);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const results = [];
  const check = async (label, fn) => {
    try { await fn(); results.push([label, null]); console.log(`PASS ${name}: ${label}`); }
    catch (e) { results.push([label, e]); console.log(`FAIL ${name}: ${label}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try { await body(check, browser, `http://localhost:${port}`); }
  finally { await browser.close(); await fixture.close(); }
  const failed = results.filter(([, e]) => e);
  console.log(`\n${name}: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length || !results.length) process.exitCode = 1;
}

const VIEWS = [[2000, 1250, 'light'], [2000, 1250, 'dark'], [390, 844, 'light'], [390, 844, 'dark']];
const SHOTS = process.env.QA_SHOTS || '';
const TAG = process.env.QA_TAG || 'after';

module.exports = { createState, openPage, run, VIEWS, SHOTS, TAG, EMBED, STALE_LAYA, ROLES, CORE, RERANK_ENV };
