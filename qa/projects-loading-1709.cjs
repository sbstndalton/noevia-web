// #1709: /projects showed "No projects yet" + New project on first paint, before the workspace read
// resolved. The page now shows a skeleton until the first read; the empty state only after a read
// that returned no projects; a failed first read shows an error with a retry. Synthetic APIs only
// (qa/diary-fixture.cjs plus page.route); no real Diary data. Fails on the pre-fix build, where the
// empty state is on screen for the whole delay and a failed read also says "No projects yet".
// QA_SCREENSHOTS (default /tmp/projects-loading-1709) receives 2000px and 390px shots, light and dark.
// Run: PLAYWRIGHT_MODULE=<playwright> QA_DIST=<built dist> QA_SCREENSHOTS=<dir> QA_TAG=<tag> node qa/projects-loading-1709.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = 31709;
const origin = `http://localhost:${PORT}`;
const shots = process.env.QA_SCREENSHOTS || '/tmp/projects-loading-1709';
const tag = process.env.QA_TAG || 'run';
require('node:fs').mkdirSync(shots, { recursive: true });
const EMPTY = 'No projects yet';
const DELAY_MS = 2500;

const project = (id, name) => ({ id, name, model: 'synthetic', goal: '', instructions: '', memories: [], files: [], assets: [], chats: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, modes: ['chat'] });
const PROJECTS = [project('p1', 'QA synthetic alpha'), project('p2', 'QA synthetic beta')];

/** Polls the DOM for `ms`, recording whether `text` was ever on the page (a flash, not just the end state). */
async function watchFor(page, text, ms, stepMs = 30) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await page.evaluate((x) => !!document.body && document.body.innerText.includes(x), text)) return true;
    await page.waitForTimeout(stepMs);
  }
  return false;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const errors = [], failures = [];
  const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } };
  const open = async (width, theme) => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('cowork-theme', t), theme);
    return page;
  };
  try {
    for (const [width, theme] of [[2000, 'light'], [2000, 'dark'], [390, 'light'], [390, 'dark']]) {
      const at = `${width} ${theme}`;
      // (a) a slow read with projects: a skeleton the whole time, never the empty state.
      {
        const page = await open(width, theme);
        await page.route('**/api/workspace', async (r) => { await new Promise((res) => setTimeout(res, DELAY_MS)); await r.fulfill({ json: { projects: PROJECTS, freeChats: [] } }); });
        await page.goto(`${origin}/projects`);
        await page.locator('h1', { hasText: 'Projects' }).first().waitFor({ timeout: 5000 });
        let flashed = false;
        await check(`${at}: a loading state shows while the projects read is in flight`, async () => {
          await page.locator('.projects-workspace [aria-busy="true"]').waitFor({ timeout: 1500 });
        });
        await page.screenshot({ path: `${shots}/projects-loading-${tag}-${width}-${theme}.png` });
        flashed = await watchFor(page, EMPTY, DELAY_MS - 600);
        await check(`${at}: "${EMPTY}" never appears before the read resolves`, async () => assert.equal(flashed, false));
        await check(`${at}: the cards replace the skeleton once the read resolves`, async () => {
          await page.locator('.project-card-name', { hasText: 'QA synthetic alpha' }).waitFor({ timeout: 5000 });
          assert.equal(await page.locator('.projects-workspace [aria-busy="true"]').count(), 0);
          assert.equal(await page.getByText(EMPTY).count(), 0);
        });
        await check(`${at}: no horizontal overflow`, async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
        await page.screenshot({ path: `${shots}/projects-loaded-${tag}-${width}-${theme}.png` });
        await page.close();
      }
      // (b) a failed first read: an error with a retry, not the empty state; the retry recovers.
      {
        const page = await open(width, theme);
        let fail = true;
        await page.route('**/api/workspace', async (r) => fail ? r.fulfill({ status: 503, json: { error: 'synthetic outage' } }) : r.fulfill({ json: { projects: PROJECTS, freeChats: [] } }));
        await page.goto(`${origin}/projects`);
        await check(`${at}: a failed read says the projects could not be loaded`, async () => {
          await page.getByText('Couldn’t load projects').waitFor({ timeout: 5000 });
          assert.equal(await page.getByText(EMPTY).count(), 0);
        });
        await page.screenshot({ path: `${shots}/projects-error-${tag}-${width}-${theme}.png` });
        await check(`${at}: the error card is announced (role=alert)`, async () => assert.equal(await page.locator('.empty-state-card[role="alert"]').count(), 1));
        // Fail twice: each retry shows the skeleton while in flight, and the second failure brings the error back.
        let release;
        await page.unroute('**/api/workspace');
        await page.route('**/api/workspace', async (r) => { await new Promise((res) => { release = res; }); return fail ? r.fulfill({ status: 503, json: { error: 'synthetic outage' } }) : r.fulfill({ json: { projects: PROJECTS, freeChats: [] } }); });
        const retryOnce = async (label) => {
          release = null;
          await page.getByRole('button', { name: 'Try again' }).click();
          await check(`${at}: ${label}: the skeleton shows while the retry is in flight`, async () => {
            await page.locator('.projects-workspace [aria-busy="true"]').waitFor({ timeout: 2000 });
            assert.equal(await page.getByText('Couldn’t load projects').count(), 0);
          });
          for (let i = 0; !release && i < 100; i++) await page.waitForTimeout(20);
          release && release();
        };
        await retryOnce('retry 1');
        await check(`${at}: a second failure shows the error again`, async () => {
          await page.getByText('Couldn’t load projects').waitFor({ timeout: 5000 });
          assert.equal(await page.locator('.projects-workspace [aria-busy="true"]').count(), 0);
          assert.equal(await page.getByText(EMPTY).count(), 0);
        });
        fail = false;
        await retryOnce('retry 2');
        await check(`${at}: Try again loads the projects`, async () => {
          await page.locator('.project-card-name', { hasText: 'QA synthetic beta' }).waitFor({ timeout: 5000 });
        });
        await page.close();
      }
    }
    // (c) a read that really returns no projects still shows the empty state, once it resolves.
    {
      const page = await open(2000, 'light');
      let resolved = false;
      await page.route('**/api/workspace', async (r) => { await new Promise((res) => setTimeout(res, 1200)); resolved = true; await r.fulfill({ json: { projects: [], freeChats: [] } }); });
      await page.goto(`${origin}/projects`);
      await check(`zero projects: "${EMPTY}" shows only after the read resolved`, async () => {
        await page.getByText(EMPTY).waitFor({ timeout: 5000 });
        assert.equal(resolved, true);
        assert.equal(await page.getByRole('button', { name: 'New project' }).count(), 1);
      });
      await page.close();
    }
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally { await browser.close(); await fixture.close(); }
  if (failures.length) { console.log(`FAIL ${failures.length} check(s)`); process.exitCode = 1; } else console.log('PASS #1709 /projects shows a skeleton until the first read, an error with retry on failure, and the empty state only for a real empty list, 2000/390 light/dark.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
