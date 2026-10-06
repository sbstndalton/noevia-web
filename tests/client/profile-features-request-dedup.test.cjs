// #422: /api/profile was fetched independently by every component that needed it — App,
// Sidebar, AccountMenu, MtpControl, GeneralSettings, DiaryView, UsageView, SettingsShell,
// PluginsView — and /api/features the same way, both directly and through the
// useResearchAccess/useCodeAccess wrapper hooks, so one page load asked the server the same
// question three or four times with no caching between them.
//
// There is no jsdom in this repo, so the real fix (mount App + Sidebar + AccountMenu together
// and count network calls) is a Playwright job — see qa/profile-features-dedup.cjs, which drives
// a real page load against a synthetic fixture the way the issue describes. This test exercises
// the same shared cache (`src/request-cache.ts`) that fix depends on, loading the real
// `src/api.ts` and `src/components/features/api.ts` modules through Vite's SSR pipeline (same
// technique tests/client/settings-view-retrieval.test.cjs uses for components) with a synthetic
// `fetch`, so the dedup/TTL/invalidation logic itself is covered by a fast Node test rather than
// only by the slower browser proof.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function makeUser(overrides = {}) {
  return { id: 'synthetic-user', username: 'qa', displayName: 'Synthetic QA', role: 'member', disabled: false, diaryEnabled: false, ...overrides };
}

async function withApiModules(fn) {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  const calls = [];
  const state = { user: makeUser(), flags: { deepResearch: true, codeHarness: true }, profileStatus: 200 };
  global.window = Object.assign(new EventTarget(), {});
  global.document = { cookie: '' };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init.method || 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    if (url === '/api/profile' && method === 'GET') {
      if (state.profileStatus !== 200) return { ok: false, status: state.profileStatus, json: async () => ({ error: 'unauthorized' }) };
      return { ok: true, status: 200, json: async () => ({ user: state.user, passkeys: [] }) };
    }
    if (url === '/api/profile' && method === 'PATCH') {
      const body = JSON.parse(init.body);
      state.user = { ...state.user, displayName: body.displayName };
      return { ok: true, status: 200, json: async () => ({ user: state.user }) };
    }
    if (url === '/api/auth/logout' && method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url === '/api/features' && method === 'GET') return { ok: true, status: 200, json: async () => ({ flags: state.flags }) };
    throw new Error(`unexpected synthetic fetch: ${method} ${url}`);
  };
  try {
    const api = await server.ssrLoadModule('/src/api.ts');
    const features = await server.ssrLoadModule('/src/components/features/api.ts');
    return await fn({ api, features, calls, state });
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.fetch;
    await server.close();
  }
}

const count = (calls, needle) => calls.filter((c) => c === needle).length;

test('#422 four components mounting together and each calling fetchProfile() hit /api/profile once', () => withApiModules(async ({ api, calls }) => {
  // App.tsx, Sidebar.tsx, AccountMenu.tsx and MtpControl.tsx each call fetchProfile() from their
  // own mount effect — simulated here as four independent, concurrent callers.
  const [a, b, c, d] = await Promise.all([api.fetchProfile(), api.fetchProfile(), api.fetchProfile(), api.fetchProfile()]);
  assert.equal(count(calls, 'GET /api/profile'), 1, `expected exactly one /api/profile request, saw: ${calls.join(', ')}`);
  for (const p of [a, b, c, d]) assert.equal(p.user.id, 'synthetic-user');
}));

test('#422 useResearchAccess + useCodeAccess + App calling fetchFeatureFlags() hit /api/features once', () => withApiModules(async ({ features, calls }) => {
  const [a, b, c] = await Promise.all([features.fetchFeatureFlags(), features.fetchFeatureFlags(), features.fetchFeatureFlags()]);
  assert.equal(count(calls, 'GET /api/features'), 1, `expected exactly one /api/features request, saw: ${calls.join(', ')}`);
  assert.deepEqual(a, { deepResearch: true, codeHarness: true });
  assert.deepEqual(b, a); assert.deepEqual(c, a);
}));

test('#422 a later fetchProfile() within the TTL window is served from cache, not a second request', () => withApiModules(async ({ api, calls }) => {
  await api.fetchProfile();
  await api.fetchProfile();
  assert.equal(count(calls, 'GET /api/profile'), 1);
}));

test('#422 updateProfile() invalidates the cache so the very next read is never stale', () => withApiModules(async ({ api, calls, state }) => {
  const before = await api.fetchProfile();
  assert.equal(before.user.displayName, 'Synthetic QA');
  await api.updateProfile('Renamed QA');
  assert.equal(state.user.displayName, 'Renamed QA');
  const after = await api.fetchProfile();
  assert.equal(after.user.displayName, 'Renamed QA', 'fetchProfile() after a save must not replay the pre-save cached value');
  assert.equal(count(calls, 'GET /api/profile'), 2, 'the save must force a fresh read, not reuse the cached one');
}));

test('#422 logout() invalidates the profile cache', () => withApiModules(async ({ api, calls }) => {
  await api.fetchProfile();
  await api.logout();
  await api.fetchProfile();
  assert.equal(count(calls, 'GET /api/profile'), 2, 'a fetchProfile() after sign-out must not be served the signed-in cache entry');
}));

test('#422 a 401 does not poison the cache for the rest of the TTL window', () => withApiModules(async ({ api, state }) => {
  state.profileStatus = 401;
  await assert.rejects(() => api.fetchProfile());
  state.profileStatus = 200;
  const recovered = await api.fetchProfile();
  assert.equal(recovered.user.id, 'synthetic-user', 'a retry right after a failed read must not keep replaying the rejection');
}));

test('#422 the noevia:features-changed event invalidates the features cache for every mounted useFeatureFlags()', () => withApiModules(async ({ features, calls, state }) => {
  await features.fetchFeatureFlags();
  state.flags = { deepResearch: false, codeHarness: false };
  global.window.dispatchEvent(new Event(features.FEATURES_CHANGED));
  const after = await features.fetchFeatureFlags();
  assert.deepEqual(after, { deepResearch: false, codeHarness: false });
  assert.equal(count(calls, 'GET /api/features'), 2, 'the changed-features event must force a fresh read');
}));
