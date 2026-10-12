// #1397: the chat model popup names Auto role models the server reports as missing.
// Synthetic only: the shared loopback fixture serves the build; every /api read below is stubbed, any
// non-GET or off-origin request is aborted. Fails on a build without the ModelPopup change.
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=../dist-after node qa/auto-availability-1397.cjs
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const roles = { fast: 'synthetic-fast', smart: 'synthetic-smart', vision: 'synthetic-vision', code: 'synthetic-code' };
const scenarios = [
  { name: 'auto, two roles missing', routing: 'auto', missing: [{ role: 'fast', model: roles.fast }, { role: 'code', model: roles.code }], warn: true },
  { name: 'auto, nothing missing', routing: 'auto', missing: [], warn: false },
  { name: 'manual, roles missing', routing: 'manual', missing: [{ role: 'fast', model: roles.fast }], warn: false },
];

async function run(browser, origin, s) {
  const page = await browser.newPage(withLocale({ viewport: { width: 1280, height: 860 } }));
  page.setDefaultTimeout(8000);
  const errors = [], blocked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const project = { id: 'qa-auto', name: 'Synthetic project', routing: s.routing, model: 'synthetic-pin', files: [], assets: [], toolboxes: [], memories: [], instructions: '',
    chats: [{ id: 'qa-chat', title: 'Synthetic chat', updatedAt: 1 }], createdAt: 1, updatedAt: 1 };
  try {
    await page.route('**/*', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      if (url.origin !== origin || req.method() !== 'GET') { blocked.push(`${req.method()} ${p}`); return route.abort('blockedbyclient'); }
      if (!p.startsWith('/api/')) return route.continue();
      const json = (v) => route.fulfill({ json: v });
      const user = { id: 'qa-auto', username: 'synthetic', role: 'member', diaryEnabled: false, onboarded: true };
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user, passkeys: [] });
      if (p === '/api/account/preferences') return json({ notifications: { replyFinished: false, approvalNeeded: false }, sendKey: 'enter', locale: 'en-GB' });
      if (p === '/api/profile/appearance') return json({ theme: 'light', light: 'iris', dark: 'iris' });
      if (p === '/api/projects/qa-auto/skills') return json({ skills: [] });
      if (p === '/api/workspace') return json({ projects: [project], freeChats: [] });
      if (p === '/api/chats/qa-chat/context') return json({ project });
      if (p === '/api/chats/qa-chat/history') return json({ history: [] });
      if (p === '/api/auto-roles') return json({ configured: true, roles, missing: s.missing });
      if (p === '/api/models/installed') return json([{ name: 'synthetic-pin', labels: [], status: 'unloaded', loaded: false }]);
      return route.continue(); // the shared fixture's synthetic defaults
    });
    // Direct /c/<chat> would mount ChatView without project context: go Projects -> project -> chat.
    await page.goto(`${origin}/projects`);
    await page.locator('.project-card-open').click();
    await page.locator('.chat-index-row').filter({ hasText: 'Synthetic chat' }).click();
    await page.locator('.composer .composer-model').click();
    const dialog = page.locator('dialog.model-dialog-backdrop[open]');
    await dialog.waitFor();
    await dialog.locator(`.mp-mode-btn[aria-pressed="true"]`).filter({ hasText: s.routing === 'auto' ? 'Auto' : 'Manual' }).waitFor();
    // Settle: Auto shows its role summary only after /api/auto-roles has answered.
    if (s.routing === 'auto') await dialog.locator('.mp-roles').waitFor();
    else await dialog.locator('.mp-model[aria-pressed="true"]').waitFor();
    const warning = dialog.locator('.mp-note.mm-warn[role="alert"]');
    if (s.warn) {
      await warning.waitFor(); // lazy copy arrives after the first paint
      const text = await warning.textContent();
      assert.match(text, /^Auto can't answer until/);
      for (const m of s.missing) assert.ok(text.includes(m.model), `${m.model} named`);
    } else {
      await page.waitForTimeout(400); // negative case: let the lazy copy have time to (wrongly) appear
      assert.equal(await warning.count(), 0, 'no warning');
    }
    assert.deepEqual(blocked, [], 'no non-GET or off-origin request');
    assert.deepEqual(errors, [], 'no page errors');
  } finally { await page.close(); }
}

(async () => {
  const fixture = createFixture(0);
  let browser = null, failed = 0;
  try {
    await fixture.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
    const origin = `http://127.0.0.1:${fixture.server.address().port}`;
    for (const s of scenarios) {
      try { await run(browser, origin, s); console.log(`PASS auto-availability-1397: ${s.name}`); }
      catch (e) { failed++; console.log(`FAIL auto-availability-1397: ${s.name}\n  ${String(e.message).split('\n').slice(0, 3).join('\n  ')}`); }
    }
  } finally {
    await Promise.allSettled([browser?.close(), fixture.close()]);
  }
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
