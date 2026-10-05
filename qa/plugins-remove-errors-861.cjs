// #861: removing an MCP key or disconnecting a sign-in must not say it worked when the server
// refused (4xx/5xx) or the request never arrived (a network error used to escape as an unhandled
// rejection). Synthetic routes only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(0); await fixture.listen();
  const origin = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME_PATH || undefined, channel: process.env.QA_CHROME_PATH ? undefined : 'chrome' });
  const errors = [];
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    page.on('pageerror', (e) => errors.push(e.message));
    const user = { id: 'u1', username: 'member', displayName: 'Synthetic member', role: 'member', disabled: false, diaryEnabled: false, onboarded: true };
    let mode = 'http500';
    const calls = { key: 0, oauth: 0 };
    const answer = (route, kind) => {
      calls[kind]++;
      if (mode === 'network') return route.abort('failed');
      if (mode === 'http500') return route.fulfill({ status: 500, json: { error: `Synthetic ${kind} failure` } });
      return route.fulfill({ json: { ok: true } });
    };
    await page.route('**/api/**', (route) => {
      const req = route.request(), p = new URL(req.url()).pathname;
      if (p === '/api/auth/session' || p === '/api/profile') return route.fulfill({ json: { user, passkeys: [], sessions: [] } });
      if (p === '/api/mcp-keys/servers') return route.fulfill({ json: { servers: [{ id: 'k1', title: 'Synthetic key server', headers: [], hasKey: true }] } });
      if (p === '/api/mcp-oauth/servers') return route.fulfill({ json: { servers: [{ id: 'o1', title: 'Synthetic sign-in server', connected: true }] } });
      if (req.method() === 'DELETE' && p === '/api/mcp-keys/k1') return answer(route, 'key');
      if (req.method() === 'DELETE' && p === '/api/mcp-oauth/o1') return answer(route, 'oauth');
      return route.continue();
    });
    await page.goto(`${origin}/customise`);
    await page.getByRole('radio', { name: 'Plugins' }).click();
    const removeKey = page.getByRole('button', { name: 'Remove your key for Synthetic key server', exact: true });
    const disconnect = page.getByRole('button', { name: 'Disconnect Synthetic sign-in server', exact: true });
    const note = (kind) => page.getByRole('region', { name: kind === 'key' ? 'MCP servers that use your own key' : 'MCP servers you sign in to' }).locator('small[role]');
    await removeKey.waitFor({ timeout: 5000 }); await disconnect.waitFor();

    // 1) server refusal
    await removeKey.click();
    await note('key').filter({ hasText: 'Synthetic key failure' }).waitFor({ timeout: 3000 });
    assert.equal(await page.getByText('Key removed.').count(), 0, 'a 500 is not reported as a removed key');
    assert.equal(await note('key').getAttribute('role'), 'alert');
    await disconnect.click();
    await note('oauth').filter({ hasText: 'Synthetic oauth failure' }).waitFor({ timeout: 3000 });
    assert.equal(await page.getByText('Disconnected').count(), 0, 'a 500 is not reported as disconnected');
    console.log('PASS 5xx shows the server error, no success message');

    // 2) request never arrives
    mode = 'network';
    await removeKey.click();
    await note('key').filter({ hasText: 'Could not remove the key' }).waitFor({ timeout: 3000 });
    await disconnect.click();
    await note('oauth').filter({ hasText: 'Could not disconnect' }).waitFor({ timeout: 3000 });
    await page.waitForTimeout(200);
    assert.deepEqual(errors, [], 'a network error is handled, not an unhandled rejection');
    console.log('PASS network failure shows a clear error and raises no unhandled rejection');

    // 3) success still says so
    mode = 'ok';
    await removeKey.click();
    await page.getByText('Key removed.').waitFor({ timeout: 3000 });
    await disconnect.click();
    await page.getByText(/^Disconnected/).first().waitFor({ timeout: 3000 });
    assert.equal(calls.key, 3); assert.equal(calls.oauth, 3);
    console.log('PASS 2xx reports success');
  } finally { await browser.close(); await fixture.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
