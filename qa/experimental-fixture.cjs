'use strict';
// Synthetic UI fixture, real feature routes, memory-only settings. No model server.
const { createFixture } = require('./diary-fixture.cjs');
const { createFeatures } = require('../server/features.cjs');
const { createFeatureRoutes } = require('../server/routes/features.cjs');
const fixture = createFixture(31240);
const original = fixture.server.listeners('request')[0];
fixture.server.removeAllListeners('request');
const values = new Map();
const store={get:k=>values.get(k),set:(k,v)=>values.set(k,v)};
const decisionSettings=require('../server/decision-settings.cjs').createDecisionSettings({store,env:{COWORK_DECISION_URL:'http://laya:8040'},fetchImpl:async()=>Response.json({ready:true})});
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
