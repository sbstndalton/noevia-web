// Synthetic browser check for #741 (the "Mirror chats to Diary" switch). No live account or Diary:
// the preference endpoint lives in this script.
//
//   npm run build -- --outDir /path/outside/sync
//   QA_DIST=/path/outside/sync PLAYWRIGHT_MODULE=/path/to/playwright [CHROME_EXECUTABLE=/path/to/chromium] \
//     node qa/chat-vault-mirror-741.cjs
//
// Settings → Personalisation: the switch is off by default and saves { enabled: true } when turned
// on; without the Diary add-on (available: false) it is not shown at all.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const port = 31742;

(async () => {
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const errors = [];
  const open = async (available) => {
    const state = { enabled: false, puts: [] };
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/features', (route) => route.fulfill({ json: { flags: { previews: false, chatFraming: true } } }));
    await page.route('**/api/chat-framing/preferences', (route) => route.fulfill({ json: { autoAccept: false } }));
    await page.route('**/api/chat-vault-mirror/preferences', (route) => {
      if (route.request().method() === 'PUT') { const body = route.request().postDataJSON(); state.puts.push(body); state.enabled = body.enabled === true; }
      return route.fulfill({ json: { enabled: state.enabled, available } });
    });
    await page.route('**/api/account/instructions', (route) => route.fulfill({ json: { text: '', style: 'default', advanced: {}, language: '', maxChars: 4000 } }));
    await page.goto(`http://localhost:${port}/settings/personalization`);
    await page.getByRole('switch', { name: 'Auto-accept chat frames' }).waitFor({ timeout: 10000 });
    return { page, state };
  };
  try {
    {
      const { page, state } = await open(true);
      const toggle = page.getByRole('switch', { name: 'Mirror chats to Diary' });
      await toggle.waitFor();
      assert.equal(await toggle.isChecked(), false, 'off by default');
      await toggle.click();
      await page.getByText('Chats are now mirrored to your Diary.').waitFor();
      assert.deepEqual(state.puts, [{ enabled: true }]);
      assert.equal(await toggle.isChecked(), true);
      if (process.env.QA_SCREENSHOTS) await page.locator('.settings-section').filter({ hasText: 'Mirror chats to Diary' }).screenshot({ path: require('node:path').join(process.env.QA_SCREENSHOTS, 'mirror-switch.png') });
      await toggle.click();
      await page.getByText('Chats are no longer mirrored. Notes already written stay in your Diary.').waitFor();
      assert.deepEqual(state.puts, [{ enabled: true }, { enabled: false }]);
      await page.close();
    }
    {
      const { page } = await open(false);
      await page.waitForTimeout(300);
      assert.equal(await page.getByRole('switch', { name: 'Mirror chats to Diary' }).count(), 0, 'hidden without the Diary add-on');
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('chat-vault-mirror-741: PASS');
  } catch (error) {
    console.error('chat-vault-mirror-741: FAIL', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await fixture.close?.();
    process.exit(process.exitCode || 0);
  }
})();
