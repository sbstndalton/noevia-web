'use strict';
// Synthetic UI fixture, real feature routes, memory-only settings. No model server.
const { createFixture } = require('./diary-fixture.cjs');
const { createFeatures } = require('../server/features.cjs');
const { createFeatureRoutes } = require('../server/routes/features.cjs');
const fixture = createFixture(31240);
const original = fixture.server.listeners('request')[0];
fixture.server.removeAllListeners('request');
const values = new Map();
const features = createFeatures({ env: process.env.QA_UNCONFIGURED === '1' ? {} : { COWORK_SYSTEM_ONE_URL:'http://127.0.0.1:1' },
  store: { get:k => values.get(k), set:(k,v) => values.set(k,v) } });
const json = (res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); };
const routes = createFeatureRoutes({ features, json, readJson: async req => { let raw = ''; for await (const chunk of req) raw += chunk; return JSON.parse(raw); } });
fixture.server.on('request', async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const user = { id:'synthetic-experiment-admin', username:'fixture', displayName:'Synthetic admin', role:'admin', diaryEnabled:false, onboarded:true };
  if (['/api/profile', '/api/auth/session'].includes(path)) return json(res, 200, { user, passkeys:[] });
  if (await routes(req, res, { path, authn:{ user } })) return;
  return original(req, res);
});
fixture.listen().then(() => console.log('Synthetic experiments UI: http://localhost:31240'));
process.on('SIGTERM', () => fixture.close().then(() => process.exit()));
