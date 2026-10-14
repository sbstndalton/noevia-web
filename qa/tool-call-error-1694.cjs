// #1694: a tool call that returned an error shows its own state (an x in the danger colour, named
// "failed"), never the success check. Synthetic APIs only. Fails on the pre-fix build, where both rows
// carry the same check icon and colour. QA_SCREENSHOTS receives 2000px and 390px shots, light and dark.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const shots = process.env.QA_SCREENSHOTS || '/tmp/tool-call-error-1694';
const tag = process.env.QA_TAG || 'run';
require('node:fs').mkdirSync(shots, { recursive: true });

(async () => {
  const fixture = createFixture(31694);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const errors = [], failures = [];
  const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } };
  try {
    for (const [width, theme] of [[2000, 'light'], [2000, 'dark'], [390, 'light'], [390, 'dark']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((t) => localStorage.setItem('cowork-theme', t), theme);
      await page.goto('http://localhost:31694');
      const before = fixture.requests.length;
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('live synthetic'); await page.keyboard.press('Enter');
      for (let i = 0; fixture.requests.length === before && i < 100; i++) await page.waitForTimeout(20);
      await page.waitForTimeout(100);
      fixture.liveEvent({ type: 'tool', index: 0, name: 'synthetic_search', args: '{"query":"a"}' });
      fixture.liveEvent({ type: 'tool_result', index: 0, name: 'synthetic_search', text: JSON.stringify({ error: 'synthetic upstream failure' }) });
      fixture.liveEvent({ type: 'tool', index: 1, name: 'synthetic_search', args: '{"query":"b"}' });
      fixture.liveEvent({ type: 'tool_result', index: 1, name: 'synthetic_search', text: JSON.stringify({ success: false, error: 'synthetic rate limit' }) });
      fixture.liveEvent({ type: 'tool', index: 2, name: 'synthetic_research', args: '{"topic":"c"}' });
      fixture.liveEvent({ type: 'tool_result', index: 2, name: 'synthetic_research', text: 'Synthetic research summary.' });
      fixture.liveEvent({ type: 'delta', text: 'Synthetic answer after failed tools' });
      fixture.finishLive();
      await page.getByText('Synthetic answer after failed tools', { exact: true }).waitFor();
      const list = page.locator('.tool-calls').last();
      await list.locator(':scope > summary').click();
      const items = list.locator('.tool-call');
      await check(`${width} ${theme}: three rows`, async () => assert.equal(await items.count(), 3));
      const rows = await items.evaluateAll((els) => els.map((el) => {
        const state = el.querySelector('.tool-call-state');
        return { cls: el.className, label: state?.getAttribute('aria-label'), icon: state?.innerHTML || '', color: state ? getComputedStyle(state).color : '' };
      }));
      await check(`${width} ${theme}: failed calls are in the error state`, async () => {
        assert.match(rows[0].cls, /\bis-error\b/); assert.match(rows[1].cls, /\bis-error\b/); assert.match(rows[2].cls, /\bis-done\b/);
      });
      await check(`${width} ${theme}: failed calls are named "failed" for screen readers`, async () => {
        assert.equal(rows[0].label, 'failed'); assert.equal(rows[2].label, 'done');
      });
      await check(`${width} ${theme}: a failed call has a different icon from a success`, async () => assert.notEqual(rows[0].icon, rows[2].icon));
      await check(`${width} ${theme}: a failed call has a different colour from a success`, async () => assert.notEqual(rows[0].color, rows[2].color));
      await check(`${width} ${theme}: the row still says "Returned an error"`, async () => assert.equal((await items.nth(0).locator('.tool-call-preview').innerText()).trim(), 'Returned an error'));
      await check(`${width} ${theme}: no horizontal overflow`, async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
      await list.screenshot({ path: `${shots}/tool-call-error-${tag}-${width}-${theme}.png` });
      await page.close();
    }
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally { await browser.close(); await fixture.close(); }
  if (failures.length) { console.log(`FAIL ${failures.length} check(s)`); process.exitCode = 1; } else console.log('PASS #1694 failed tool calls show an x in the danger colour, distinct from the success check, 2000/390 light/dark.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
