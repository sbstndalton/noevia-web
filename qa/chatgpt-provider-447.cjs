// #447: Settings → AI providers with Sign in with ChatGPT, against synthetic APIs only (the
// diary-fixture server plus page.route mocks). No real OpenAI account, token or network call.
//   flag off  the section is absent and nothing asks for /api/providers/chatgpt
//   flag on   Sign in → one-time code + OpenAI link → pending → connected (ONE card: masked
//             account, one External badge, limits note, model hint, Disconnect as the only way
//             out) → Disconnect → signed out; a "reconnect" account shows Reconnect needed.
//   model picker  a project on the ChatGPT provider lists the account's models to pick from;
//             free text only when that list cannot be loaded.
// Screenshots: 1440 light and 390 dark into $QA_SCREENSHOTS (default /tmp/noevia-qa-447/shots).
//
// Run: npm run build -- --outDir /tmp/noevia-447-dist
//      QA_DIST=/tmp/noevia-447-dist PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/chatgpt-provider-447.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31447;
const shots = process.env.QA_SCREENSHOTS || '/tmp/noevia-qa-447/shots';

async function openProviders(page) {
  await page.goto(`http://localhost:${PORT}/settings/providers`);
  await page.getByRole('heading', { name: 'AI providers', level: 1 }).waitFor();
}
async function shoot(page, name, { width, theme }) {
  await page.setViewportSize({ width, height: width < 600 ? 900 : 1000 });
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal overflow at ${width}`);
  await page.screenshot({ path: `${shots}/${name}-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
}

/** page.route mocks for the flag and the ChatGPT endpoints; `state` drives what the server "has". */
async function mockApis(page, { flag, state, models = ['gpt-synthetic-1', 'gpt-synthetic-mini'] }) {
  const seen = [];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (p.startsWith('/api/providers')) seen.push(`${req.method()} ${p}`);
    if (p === '/api/features') return json({ flags: { previews: false, chatgptOAuth: flag } });
    const account = { email: 's…@example.test', plan: 'plus' };
    const row = { id: 'chatgpt-oauth', label: 'ChatGPT', baseUrl: 'https://chatgpt.com/backend-api/codex', apiKeyMasked: null, isDefault: false, managed: false, shared: false, kind: 'chatgpt-oauth', external: true, connection: state.connection };
    if (p === '/api/providers' && req.method() === 'GET') {
      const local = { id: 'default', label: 'Local engine', baseUrl: 'http://engine.fixture.invalid/v1', apiKeyMasked: null, isDefault: true, managed: true, shared: true };
      return json({ providers: flag && state.connection !== 'disconnected' ? [local, row] : [local] });
    }
    if (!p.startsWith('/api/providers/chatgpt')) return route.continue();
    if (!flag) return json({ error: 'Sign in with ChatGPT is turned off on this server.' }, 404);
    if (p === '/api/providers/chatgpt' && req.method() === 'GET') return json({ state: state.connection, ...(state.connection === 'connected' ? { account } : {}), providerId: 'chatgpt-oauth', external: true });
    if (p === '/api/providers/chatgpt' && req.method() === 'DELETE') { state.connection = 'disconnected'; return json({ ok: true, state: 'disconnected' }); }
    if (p === '/api/providers/chatgpt/device') return json({ loginId: 'qa-login', userCode: 'QA12-3456', verificationUrl: 'https://auth.openai.com/codex/device', interval: 1, expiresAt: Date.now() + 900000 });
    if (p === '/api/providers/chatgpt/device/poll') {
      state.polls += 1;
      if (state.polls < state.pendingPolls) return json({ state: 'pending', interval: 1 });
      state.connection = 'connected';
      return json({ state: 'connected', account });
    }
    if (p === '/api/providers/chatgpt/device/cancel') return json({ ok: true });
    if (p === '/api/providers/chatgpt/models') return models ? json({ models }) : json({ error: 'ChatGPT returned 503' }, 502);
    return json({ error: 'unexpected' }, 500);
  });
  return seen;
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    // ── flag off: no ChatGPT option anywhere on the page, and it never asks the server ──
    {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 1000 } }));
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const seen = await mockApis(page, { flag: false, state: { connection: 'connected', polls: 0, pendingPolls: 2 } });
      await openProviders(page);
      await page.getByText('Local engine').waitFor();
      assert.equal(await page.getByText('Sign in with ChatGPT').count(), 0, 'flag off: no sign-in option');
      assert.equal(await page.getByText('ChatGPT', { exact: true }).count(), 0, 'flag off: no ChatGPT row');
      assert.equal(seen.some((s) => s.includes('/api/providers/chatgpt')), false, 'flag off: no ChatGPT request');
      await shoot(page, 'flag-off', { width: 1440, theme: 'light' });
      await shoot(page, 'flag-off', { width: 390, theme: 'dark' });
      assert.deepEqual(errors, []);
      await page.close();
    }

    // ── flag on: sign in, pending code, connected, disconnect ──
    {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 1000 } }));
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const state = { connection: 'disconnected', polls: 0, pendingPolls: 3 };
      await mockApis(page, { flag: true, state });
      await openProviders(page);
      const card = page.getByRole('region', { name: 'Sign in with ChatGPT' });
      await card.waitFor();
      await card.getByText('Chats on this provider are sent to OpenAI').waitFor();
      await card.getByText('It uses your ChatGPT plan’s usage limits, and OpenAI may block use from third-party apps like this one.').waitFor();
      await card.getByText('External', { exact: true }).waitFor();
      await shoot(page, 'flag-on-signed-out', { width: 1440, theme: 'light' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await card.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).click();
      await card.getByText('QA12-3456', { exact: true }).waitFor();
      const link = card.getByRole('link', { name: 'https://auth.openai.com/codex/device' });
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.match(await link.getAttribute('rel'), /noopener/);
      await card.getByText('OpenAI shows this as a Codex sign-in').waitFor();
      await shoot(page, 'flag-on-code', { width: 1440, theme: 'light' });
      await shoot(page, 'flag-on-code', { width: 390, theme: 'dark' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await card.getByText('Connected as s…@example.test · plus').waitFor({ timeout: 15000 });
      assert.ok(state.polls >= 3, 'the card kept polling until the account connected');
      await card.getByText('Models on your account: gpt-synthetic-1, gpt-synthetic-mini').waitFor();
      // One card for the connection: no second "ChatGPT" provider row with its own remove (X) button.
      assert.equal(await page.locator('.model-row', { hasText: 'https://chatgpt.com/backend-api/codex' }).count(), 0, 'no duplicate provider row');
      assert.equal(await page.getByRole('button', { name: 'Remove ChatGPT' }).count(), 0, 'Disconnect is the only way to remove it');
      assert.equal(await page.getByText('External', { exact: true }).count(), 1, 'one External badge');
      assert.equal(await page.getByText(/AT-|RT-|access_token|refresh_token/).count(), 0, 'no token text on the page');
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await shoot(page, 'flag-on-connected', { width: 1440, theme: 'light' });
      await shoot(page, 'flag-on-connected', { width: 390, theme: 'dark' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await card.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).waitFor();
      assert.equal(state.connection, 'disconnected');
      assert.deepEqual(errors, []);
      await page.close();
    }

    // ── flag on, refresh refused earlier: Reconnect needed ──
    {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 1000 } }));
      const state = { connection: 'reconnect', polls: 0, pendingPolls: 1 };
      await mockApis(page, { flag: true, state });
      await openProviders(page);
      const card = page.getByRole('region', { name: 'Sign in with ChatGPT' });
      await card.getByText('Reconnect needed', { exact: true }).waitFor();
      await card.getByRole('button', { name: 'Sign in again', exact: true }).waitFor();
      await card.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
      await shoot(page, 'flag-on-reconnect', { width: 1440, theme: 'light' });
      await shoot(page, 'flag-on-reconnect', { width: 390, theme: 'dark' });
      await page.close();
    }
    // ── the model picker lists the account's models for a project on ChatGPT ──
    for (const listed of [true, false]) {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await mockApis(page, { flag: true, state: { connection: 'connected', polls: 0, pendingPolls: 1 }, models: listed ? ['gpt-synthetic-1', 'gpt-synthetic-mini'] : null });
      const project = { id: 'p1', name: 'Synthetic', model: '', routing: 'manual', provider: 'chatgpt-oauth', files: [], assets: [], toolboxes: ['core'] };
      const saved = [];
      await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project } }));
      await page.route('**/api/models/installed', (r) => r.fulfill({ json: [] }));
      await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: false, roles: null } }));
      await page.route('**/api/models/capabilities', (r) => r.fulfill({ json: { modelManagement: false } }));
      await page.route('**/api/projects/*/config', async (r) => { const b = r.request().postDataJSON(); saved.push(b); Object.assign(project, b); await r.fulfill({ json: { project } }); });
      await page.goto(`http://localhost:${PORT}`);
      await page.getByRole('button', { name: 'Choose model' }).click();
      const dialog = page.getByRole('dialog', { name: 'Model' });
      await dialog.waitFor();
      if (listed) {
        const pick = dialog.getByRole('button', { name: /gpt-synthetic-mini/ });
        await pick.waitFor();
        assert.equal(await dialog.getByPlaceholder(/model/i).count(), 0, 'no free-text box when the list loads');
        await shoot(page, 'model-picker', { width: 1440, theme: 'light' });
        await shoot(page, 'model-picker', { width: 390, theme: 'dark' });
        await page.setViewportSize({ width: 1440, height: 900 });
        await pick.click();
        await page.waitForFunction(() => true);
        assert.deepEqual(saved.at(-1), { model: 'gpt-synthetic-mini', routing: 'manual' });
      } else {
        await dialog.getByRole('textbox').first().waitFor();
        await shoot(page, 'model-picker-fallback', { width: 1440, theme: 'light' });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(`PASS #447 Sign in with ChatGPT settings: hidden with the flag off; sign-in code, polling, connected, disconnect and reconnect with it on. Shots in ${shots}`);
  } finally {
    await browser.close();
    await fixture.close?.();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
