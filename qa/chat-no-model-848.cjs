// #848 in a real browser against the built client. Synthetic APIs only.
//   A free chat whose own context is Manual on another provider with no model picked used to show the
//   loaded LOCAL model on the composer chip, and sending then answered 400. The chip must say that no
//   model is picked; a local-provider chat with no model still shows the loaded model (the server falls
//   back to it for that provider only).
//
// FAILS on origin/main (023ddcb5), PASSES with the fix.
// Run: npm run build -- --outDir /tmp/<name>-dist, then
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Brave or Chrome binary> QA_DIST=/tmp/<name>-dist \
//   node qa/chat-no-model-848.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = 31848, ORIGIN = `http://localhost:${PORT}`;
const now = Date.now();
const FREE_CHATS = [
  { id: 'free-cloud', title: 'Synthetic cloud chat', updatedAt: now - 1000, projectId: null },
  { id: 'free-local', title: 'Synthetic local chat', updatedAt: now - 2000, projectId: null },
];
const CONTEXTS = {
  'free-cloud': { id: 'ctx-free-cloud', name: 'Context cloud', routing: 'manual', provider: 'cloud-a', files: [], assets: [], toolboxes: ['core'], chats: [] },
  'free-local': { id: 'ctx-free-local', name: 'Context local', routing: 'manual', files: [], assets: [], toolboxes: ['core'], chats: [] },
};
const INSTALLED = [{ name: 'synthetic-local-model', labels: [], loaded: true, status: 'loaded', size: 1, sizeGB: 1 }];

async function open(browser, chat, sent) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: FREE_CHATS } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: r.request().method() === 'GET' ? { history: [] } : { ok: true, revision: 'r1' } }));
  await page.route('**/api/chats/*/context', (r) => {
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
    return r.fulfill({ json: { project: CONTEXTS[id] } });
  });
  await page.route('**/api/models/installed', (r) => r.fulfill({ json: INSTALLED }));
  await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: true, roles: { fast: 'synthetic-local-model', smart: 'synthetic-local-model' } } }));
  await page.route('**/api/providers', (r) => r.fulfill({ json: { providers: [{ id: 'default', label: 'Local', baseUrl: 'http://x', isDefault: true }, { id: 'cloud-a', label: 'Synthetic Cloud', baseUrl: 'https://cloud.invalid' }] } }));
  await page.route('**/api/chat', async (r) => {
    sent.push(r.request().postDataJSON());
    // What the server answers for a non-local provider with no model picked.
    return r.fulfill({ status: 400, json: { error: 'no model selected for Synthetic Cloud — pick one in the model popup' } });
  });
  await page.goto(`${ORIGIN}/c/${chat}`);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  return { ctx, page, errors };
}
const chip = (page) => page.locator('.chat-workspace .composer button.composer-model').first();
const chipText = (page) => chip(page).evaluate((el) => el.textContent.replace(/\s+/g, ' ').trim());
const waitChip = (page, fn) => page.waitForFunction(fn, undefined, { timeout: 8000 });

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const failures = [];
  const run = async (name, fn) => { try { await fn(); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };
  try {
    await run('#848 cloud provider, no model', async () => {
      const sent = [];
      const { ctx, page, errors } = await open(browser, 'free-cloud', sent);
      try {
        // Let the context and the model list settle, then read the chip.
        await page.waitForTimeout(1200);
        const text = await chipText(page);
        assert.ok(!text.includes('synthetic-local-model'), `#848: the chip borrows the loaded local model (reads "${text}")`);
        assert.match(text, /No model selected/, `#848: the chip does not say no model is picked (reads "${text}")`);
        const box = page.getByRole('textbox', { name: 'Message', exact: true });
        await box.fill('hello');
        await page.keyboard.press('Enter');
        await page.getByText(/no model selected for Synthetic Cloud/).first().waitFor({ timeout: 8000 });
        assert.equal(await page.getByText(/none loaded/).count(), 0, 'the error claims "none loaded" while a model is loaded');
        assert.deepEqual(errors, []);
        console.log('PASS #848: a cloud chat with no model reads "No model selected", and the send error names the provider');
      } finally { await ctx.close(); }
    });
    await run('#848 local provider keeps its fallback', async () => {
      const { ctx, page, errors } = await open(browser, 'free-local', []);
      try {
        await waitChip(page, () => document.querySelector('.chat-workspace .composer button.composer-model')?.textContent?.includes('synthetic-local-model'));
        assert.deepEqual(errors, []);
        console.log('PASS #848: a local-provider chat with no model still shows the loaded local model');
      } finally { await ctx.close(); }
    });
  } finally { await browser.close(); await fixture.close(); }
  if (failures.length) { console.error(`FAILED: ${failures.join(', ')}`); process.exitCode = 1; }
  else console.log('PASS #848 QA');
})().catch((e) => { console.error(e); process.exitCode = 1; });
