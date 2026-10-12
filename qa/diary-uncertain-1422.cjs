// #1422 — Diary companion: a failure the server proves left nothing saved is worded as such and the
// message goes back in the composer; an "uncertain save" banner names the exchange, links to it, and
// can be dismissed (and stays dismissed after a reload). Synthetic APIs only. Usage:
//   QA_DIST=<dist> QA_PORT=31489 QA_CORE_SERVER=<noevia-core/server> \
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/diary-uncertain-1422.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = Number(process.env.QA_PORT || 31489);
const origin = `http://localhost:${PORT}`;
const ID = 'ex-uncertain-synthetic-1';
const MESSAGE = 'Synthetic note from an earlier exchange';

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const failures = [];
  const check = (ok, what) => { if (!ok) failures.push(what); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    page.setDefaultTimeout(8000);
    const exchanges = [{ id: ID, kind: 'capture', state: 'uncertain', message: MESSAGE, content: '', reasoning: '', startedAt: Date.now() - 90000, activity: ['Generating companion response…'], decision: null }];
    const dismissals = [];
    await page.route(/\/api\/diary\/exchanges/, (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        dismissals.push(body);
        const row = exchanges.find((e) => e.id === body.id);
        if (!row) return route.fulfill({ status: 404, json: { error: 'No such exchange.' } });
        row.acknowledgedAt = Date.now();
        return route.fulfill({ json: { exchange: { id: row.id, state: row.state, acknowledgedAt: row.acknowledgedAt } } });
      }
      return route.fulfill({ json: { exchanges } });
    });
    await page.route(/\/api\/chat$/, (route) => route.fulfill({
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
      body: ['Connecting to diary companion…', 'Opening diary context…', 'Generating companion response…'].map((text) => `data: ${JSON.stringify({ type: 'status', text })}\n\n`).join('')
        + `data: ${JSON.stringify({ type: 'error', code: 'modelFailed', saved: false, text: "Couldn't reach the local model — nothing was saved. You can resend." })}\n\n`,
    }));

    // 1. The banner names the exchange and offers three ways out.
    await page.goto(`${origin}/diary`);
    const banner = page.locator('.diary-uncertain');
    await banner.waitFor();
    const bannerText = (await banner.innerText()).replace(/\s+/g, ' ');
    check(/uncertain save outcome/.test(bannerText), `banner wording: ${bannerText}`);
    check(/\d{1,2}:\d{2}/.test(bannerText), `the banner names the time of the exchange: ${bannerText}`);
    for (const name of ['Show it', 'Put the message back in the composer', 'Dismiss']) check(await banner.getByRole('button', { name }).count() === 1, `banner button: ${name}`);

    // 2. "Show it" opens the day and focuses that exchange.
    await banner.getByRole('button', { name: 'Show it' }).click();
    await page.waitForFunction((id) => document.activeElement?.getAttribute('data-exchange-id') === id, ID).catch(() => {});
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-exchange-id') || null);
    check(focused === ID, `Show it focuses the exchange (focused: ${focused})`);

    // 3. Putting the message back dismisses the exchange and fills the composer.
    await page.locator('.diary-uncertain').getByRole('button', { name: 'Put the message back in the composer' }).click();
    await page.waitForFunction(() => !document.querySelector('.diary-uncertain'));
    check(await page.locator('#diary-draft').inputValue() === MESSAGE, 'the message is back in the composer');
    check(dismissals.length === 1 && dismissals[0].action === 'dismiss' && dismissals[0].id === ID, `one dismiss was sent: ${JSON.stringify(dismissals)}`);

    // 4. It stays dismissed after a reload.
    await page.reload();
    await page.locator('#diary-draft').waitFor();
    await page.waitForTimeout(700);
    check(await page.locator('.diary-uncertain').count() === 0, 'the banner does not come back after a reload');

    // 5. A failure the server proves left nothing saved: clear wording, no "uncertain", message restored.
    await page.locator('#diary-draft').fill('Synthetic message to send');
    await page.getByRole('button', { name: /send/i }).last().click();
    const alert = page.getByRole('alert').filter({ hasText: /nothing was saved|Nothing was saved/ });
    await alert.first().waitFor();
    const alertText = (await alert.first().innerText()).replace(/\s+/g, ' ');
    check(/Couldn.t reach the local model/.test(alertText), `failure wording: ${alertText}`);
    check(!/uncertain|may be incomplete/i.test(alertText), `no "uncertain" wording: ${alertText}`);
    check(await page.locator('#diary-draft').inputValue() === 'Synthetic message to send', 'the unsent message is back in the composer');
    console.log('diary-uncertain-1422:', JSON.stringify({ focused, dismissals: dismissals.length, alert: alertText }));
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  if (failures.length) { console.log('diary-uncertain-1422: FAIL'); failures.forEach((f) => console.log(' -', f)); process.exitCode = 1; }
  else console.log('diary-uncertain-1422: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
