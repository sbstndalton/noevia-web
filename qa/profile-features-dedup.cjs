// #422 — real-page-load proof (synthetic APIs only, no inference/model/diary network calls).
// The issue: /api/profile fetched independently by every mounted component that needs it
// (App, Sidebar, AccountMenu, MtpControl, GeneralSettings, DiaryView, UsageView, SettingsShell,
// PluginsView…) and /api/features the same way, directly and through the
// useResearchAccess/useCodeAccess wrapper hooks — no shared cache, so a plain page load asked
// the server the same question three or four times.
//
// This script drives a real headless Chrome page against a synthetic fixture (no jsdom
// involved) and counts actual network requests:
//   - a bare home load mounts App + Sidebar + AccountMenu, each with their own fetchProfile()
//     call on mount (AccountMenu's runs even before the popover opens — its effect has no early
//     return on `open`), so this alone reproduced the bug's ">1 /api/profile" symptom without
//     needing Settings open.
//   - opening a project mounts ProjectView, which mounts both useResearchAccess and
//     useCodeAccess — each calls useFeatureFlags() independently — on top of App's own call,
//     reproducing the issue's "opening a project fires 3x /api/features".
//
// Usage:
//   QA_DIST=/tmp/some-dist QA_PORT=31484 \
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/profile-features-dedup.cjs
// Exits non-zero when either count is not exactly 1, printing every request URL seen in that
// window.
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { withLocale } = require('./qa-locale.cjs');
const PORT = Number(process.env.QA_PORT || 31484);

async function run() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage(withLocale({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }));
  page.setDefaultTimeout(8000);
  await page.addInitScript(() => {
    localStorage.removeItem('noevia:last-view'); sessionStorage.removeItem('noevia-models-tab');
  });
  const user = { id: 'synthetic-dedup-qa', username: 'dedupqa', displayName: 'Synthetic Dedup QA', role: 'admin', diaryEnabled: true, onboarded: true };
  const project = { id: 'p1', name: 'Synthetic research', updatedAt: 1000, files: [], assets: [], memories: [], instructions: '', goal: '', sourceFolders: [], toolboxes: ['core'], chats: [] };
  const seen = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname === '/api/profile' || u.pathname === '/api/features') seen.push(u.pathname);
  });
  await page.route(/\/api\/(auth\/session|profile)$/, (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { deepResearch: true, codeHarness: true } } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats: [] } }));
  await page.route('**/api/health', (r) => r.fulfill({ json: { inferenceUp: true, diaryUp: true } }));
  await page.route('**/api/models/installed', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: false, roles: null } }));
  await page.route('**/api/stats', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/toolboxes', (r) => r.fulfill({ json: { toolboxes: [], mcp: { enabled: false } } }));
  await page.route('**/api/projects/p1/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/projects/p1/context', (r) => r.fulfill({ json: { context: [] } }));
  await page.route(/\/api\/projects\/p1\/(sources|assets)$/, (r) => r.fulfill({ json: { sources: [], assets: [] } }));

  const results = {};
  try {
    // Window 1: a bare home load. App, Sidebar and AccountMenu each mount their own
    // fetchProfile() caller.
    await page.goto(`http://localhost:${PORT}`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    await page.waitForTimeout(600);
    results.profileOnHomeLoad = seen.filter((p) => p === '/api/profile').length;

    // Window 2: opening a project mounts ProjectView -> useResearchAccess + useCodeAccess, each
    // an independent useFeatureFlags() caller, on top of App's own.
    seen.length = 0;
    await page.goto(`http://localhost:${PORT}/p/p1`);
    await page.getByRole('tab', { name: /Chats/ }).first().waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    results.featuresOnProjectOpen = seen.filter((p) => p === '/api/features').length;
  } finally {
    await page.close();
    await browser.close();
  }
  return results;
}

(async () => {
  const fs = require('node:fs'), path = require('node:path');
  const { createFixture } = require('./diary-fixture.cjs');
  const fixture = createFixture(PORT); await fixture.listen();
  let results;
  try {
    results = await run();
  } finally {
    await fixture.close?.();
  }
  console.log('profile-features-dedup:', JSON.stringify(results));
  const failures = [];
  if (results.profileOnHomeLoad !== 1) failures.push(`expected exactly 1 /api/profile request on a bare home load, saw ${results.profileOnHomeLoad}`);
  if (results.featuresOnProjectOpen !== 1) failures.push(`expected exactly 1 /api/features request when opening a project, saw ${results.featuresOnProjectOpen}`);
  if (failures.length) {
    console.log('profile-features-dedup: FAIL');
    for (const f of failures) console.log(' -', f);
    process.exitCode = 1;
  } else {
    console.log('profile-features-dedup: ok — one /api/profile and one /api/features request per load');
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
