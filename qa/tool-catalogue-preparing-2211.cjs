'use strict';
// #2211: GET /api/toolboxes/permitted answers 503 + Retry-After + {"error":"The tool list is being prepared. Try again in a moment."}
// while the discovery snapshot is missing or stale (noevia-rs toolbox_routes.rs). The composer's tool catalogue showed that sentence as a
// hard error (role=alert) and never asked again, leaving the Tools menu empty until it was closed and reopened.
// Now: a calm "being prepared" status while the one retry (after Retry-After, capped) is pending; the tools appear when it succeeds;
// only a second refusal is shown, as before.
// Synthetic endpoint with the real 200 shape ({ mode, boxes[] }) and the real 503 headers/body.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/tool-catalogue-preparing-2211.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { openToolCatalogue } = require('./nav.cjs');
const { run, openPage, shot, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const BOXES = { mode: 'chat', boxes: [{ id: 'qa-box', label: 'QA files box', description: 'Synthetic tools for the check.', source: 'builtin', state: 'available', reason: null, active: false,
  tools: [{ name: 'qa_read', description: 'Read a synthetic file', write: false, permission: 'allowed', reason: null }] }] };
const PREPARING = { status: 503, headers: { 'Retry-After': '2' }, json: { error: 'The tool list is being prepared. Try again in a moment.' } };

/** Answers the first `refusals` requests with the 503, then the list; counts every request. */
const permitted = (refusals, counter) => async (page) => {
  // The catalogue exists only where the chat picks its tools by hand (toolsMode 'manual'); it opens from the + menu.
  await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project: { id: 'p-syn', name: 'Synthetic', routing: 'auto', files: [], assets: [], toolboxes: ['core'], toolsMode: 'manual' } } }));
  await page.route('**/api/toolboxes/permitted**', (r) => {
    counter.n += 1;
    return counter.n <= refusals ? r.fulfill(PREPARING) : r.fulfill({ json: BOXES });
  });
};

run('tool-catalogue-preparing-2211', Number(process.env.QA_PORT || 32211), async (check, browser, origin) => {
  for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const theme of ['light', 'dark']) {
      const tag = `${view.name} ${theme}`;
      await check(`${tag}: a 503 "being prepared" shows a calm status, retries once after Retry-After and then lists the tools`, async () => {
        const counter = { n: 0 };
        const { page, context, errors } = await openPage(browser, view, theme, { mock: permitted(1, counter) });
        await page.goto(origin);
        await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
        await openToolCatalogue(page);
        const panel = page.locator('.tool-catalogue-panel');
        const note = panel.locator('.tool-catalogue-note');
        // "Loading tools…" is the first line; the 503 turns it into "being prepared" (never into an alert).
        await Promise.race([note.filter({ hasText: /being prepared/i }).waitFor({ timeout: 6000 }), panel.getByRole('alert').waitFor({ timeout: 6000 })]).catch(() => undefined);
        assert.equal(await panel.getByRole('alert').count(), 0, 'a hard error (role=alert) is shown for the 503');
        assert.match(await note.first().textContent(), /being prepared/i);
        assert.equal(await panel.getByText(/Try again in a moment/).count(), 0, 'the server sentence is shown as an error');
        await shot(page, `2211-preparing-${view.name}-${theme}`);
        await panel.getByRole('option', { name: /QA files box/ }).waitFor({ timeout: 10000 });
        assert.equal(counter.n, 2, `${counter.n} requests: one refusal and exactly one retry`);
        assert.equal(await panel.getByRole('alert').count(), 0);
        assert.equal(await panel.locator('.tool-catalogue-note[role="status"]').count(), 0, 'the status line is gone once the list is in');
        await shot(page, `2211-tools-listed-${view.name}-${theme}`);
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
  await check('1440 light: two refusals in a row end in the server message as an alert (after exactly one retry)', async () => {
    const counter = { n: 0 };
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { mock: permitted(2, counter) });
    await page.goto(origin);
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
    await openToolCatalogue(page);
    const alert = page.locator('.tool-catalogue-panel').getByRole('alert');
    await alert.waitFor({ timeout: 10000 });
    assert.match(await alert.textContent(), /being prepared/i);
    await page.waitForTimeout(500);
    assert.equal(counter.n, 2, 'no third request');
    await shot(page, '2211-still-preparing-1440-light');
    await context.close();
  });
  await check('1440 light: closing the panel while the retry is pending cancels it', async () => {
    const counter = { n: 0 };
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { mock: permitted(5, counter) });
    await page.goto(origin);
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
    await openToolCatalogue(page);
    await page.locator('.tool-catalogue-panel .tool-catalogue-note').first().waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2600);
    assert.equal(counter.n, 1, `${counter.n} requests: the retry ran after the panel was closed`);
    await context.close();
  });
});
