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


/** A handler that answers each request with the next entry of `plan` ({ ...fulfill options, delay? }), then the list. */
const planned = (plan, counter) => async (page) => {
  await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project: { id: 'p-syn', name: 'Synthetic', routing: 'auto', files: [], assets: [], toolboxes: ['core'], toolsMode: 'manual' } } }));
  await page.route('**/api/toolboxes/permitted**', async (r) => {
    const step = plan[counter.n] || { json: BOXES }; counter.n += 1;
    if (step.delay) await new Promise((res) => setTimeout(res, step.delay));
    return r.fulfill(step);
  });
};
const UNREADABLE = { status: 503, json: { error: 'The tool permissions could not be read. Try again in a moment.' } };

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
    await page.locator('.tool-catalogue-panel .tool-catalogue-note', { hasText: /being prepared/i }).waitFor({ timeout: 6000 });
    await page.waitForFunction(() => document.activeElement?.className === 'tool-catalogue-search');   // Escape works from the search box
    await page.keyboard.press('Escape');
    await page.locator('.tool-catalogue-panel').waitFor({ state: 'detached' });
    await page.waitForTimeout(2600);
    assert.equal(counter.n, 1, `${counter.n} requests: the retry ran after the panel was closed`);
    await context.close();
  });

  await check('1440 light: a 503 without Retry-After ("tool permissions could not be read") is shown as the failure it is, with no retry and no "being prepared"', async () => {
    const counter = { n: 0 };
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { mock: planned([UNREADABLE, UNREADABLE], counter) });
    await page.goto(origin);
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
    await openToolCatalogue(page);
    const panel = page.locator('.tool-catalogue-panel');
    const alert = panel.getByRole('alert');
    await alert.waitFor({ timeout: 6000 });
    assert.match(await alert.textContent(), /permissions could not be read/);
    assert.equal(await panel.getByText(/being prepared/i).count(), 0);
    await page.waitForTimeout(2600);
    assert.equal(counter.n, 1, `${counter.n} requests: a failure that is not "preparing" must not be retried`);
    await shot(page, '2211-unreadable-1440-light');
    await context.close();
  });
  await check('1440 light: reopening after a "being prepared" never flashes it while the new request is pending', async () => {
    const counter = { n: 0 };
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { mock: planned([PREPARING, { json: BOXES, delay: 1200 }], counter) });
    await page.goto(origin);
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
    await openToolCatalogue(page);
    await page.locator('.tool-catalogue-panel .tool-catalogue-note', { hasText: /being prepared/i }).waitFor({ timeout: 6000 });
    await page.waitForFunction(() => document.activeElement?.className === 'tool-catalogue-search');
    await page.keyboard.press('Escape');
    await page.locator('.tool-catalogue-panel').waitFor({ state: 'detached' });
    // Watch every text the panel shows from the moment it reopens.
    await page.evaluate(() => {
      window.__seen = [];
      new MutationObserver(() => { const p = document.querySelector('.tool-catalogue-panel'); if (p) window.__seen.push(p.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await openToolCatalogue(page);
    await page.locator('.tool-catalogue-panel').getByRole('option', { name: /QA files box/ }).waitFor({ timeout: 8000 });
    const seen = await page.evaluate(() => window.__seen);
    assert.ok(seen.some((t) => /Loading tools/.test(t)), 'the panel shows the loading line first');
    assert.ok(!seen.some((t) => /being prepared/i.test(t)), 'the reopened panel flashed "being prepared"');
    await context.close();
  });
  await check('1440 light: leaving the chat while the retry is pending cancels it (unmount)', async () => {
    const counter = { n: 0 };
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { mock: planned([PREPARING, PREPARING], counter) });
    await page.goto(origin);
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
    await openToolCatalogue(page);
    await page.locator('.tool-catalogue-panel .tool-catalogue-note', { hasText: /being prepared/i }).waitFor({ timeout: 6000 });
    await page.locator('.sidebar').getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ state: 'detached' });
    await page.waitForTimeout(2800);
    assert.equal(counter.n, 1, `${counter.n} requests: the retry ran after the catalogue was unmounted`);
    await context.close();
  });
});
