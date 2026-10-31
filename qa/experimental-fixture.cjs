'use strict';
// Synthetic UI fixture, real feature routes, memory-only settings. No model server.
const path = require('node:path'), fs = require('node:fs');
// noevia-core's server/ (QA_CORE_SERVER, else beside qa/ in the CI workspace, else a sibling noevia-core checkout) and its test oracles: the
// feature and decision-settings writers are the Rust front's now, and Core keeps the original Node behaviour as oracles (#2256).
const CORE = path.resolve(process.env.QA_CORE_SERVER || [path.join(__dirname, '../server'), path.join(__dirname, '../../noevia-core/server')].find((d) => fs.existsSync(path.join(d, 'decision-settings.cjs'))) || path.join(__dirname, '../server'));
process.env.QA_CORE_SERVER = CORE;
const coreOracle = (file) => require(path.join(CORE, '../tests/server/oracles', file));
const { createFixture } = require('./diary-fixture.cjs');
const { createFeatures } = coreOracle('features-legacy.cjs');
const { createFeatureRoutes } = coreOracle('feature-routes-legacy.cjs');
const fixture = createFixture(31240);
const original = fixture.server.listeners('request')[0];
fixture.server.removeAllListeners('request');
const values = new Map();
const store={get:k=>values.get(k),set:(k,v)=>values.set(k,v),delete:k=>values.delete(k)};
const decisionEnv = { COWORK_DECISION_URL: 'http://laya:8040' };
// The decision row's writer is the Rust front's: Core only reads it, so this stands in for that writer on the fixture's store.
const decisionSettings = { ...require(path.join(CORE, 'decision-settings.cjs')).createDecisionSettings({ store, env: decisionEnv, fetchImpl: async () => Response.json({ ready: true }) }),
  save(value) { values.set('decision:configuration', JSON.stringify({ url: String(value?.url || '').trim().replace(/\/+$/, ''), timeoutMs: value?.timeoutMs ?? 1500, ...(value?.model ? { model: value.model } : {}) })); return this.get(); },
  reset() { values.delete('decision:configuration'); return this.get(); },
  test: async () => ({ ready: true }) };
const features = createFeatures({env:{},store,availability:{stepSupervision:decisionSettings.unavailable,systemOneRouting:decisionSettings.unavailable,toolGate:decisionSettings.unavailable}});
const json = (res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); };
const routes = createFeatureRoutes({ features, decisionSettings, json, readJson: async req => { let raw = ''; for await (const chunk of req) raw += chunk; return JSON.parse(raw); } });
fixture.server.on('request', async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const user = { id:'synthetic-experiment-admin', username:'fixture', displayName:'Synthetic admin', role:'admin', diaryEnabled:false, onboarded:true };
  if (['/api/profile', '/api/auth/session'].includes(path)) return json(res, 200, { user, passkeys:[] });
  if (await routes(req, res, { path, authn:{ user } })) return;
  return original(req, res);
});
fixture.listen().then(() => console.log('Synthetic experiments UI: http://localhost:31240'));
process.on('SIGTERM', () => fixture.close().then(() => process.exit()));
