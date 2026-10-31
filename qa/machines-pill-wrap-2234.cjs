'use strict';
// #2234: Settings → Inference machines on a phone: the red "Unreachable · Embeddings (projects and Diary): Connection refused"
// pill had white-space: nowrap and ran past the card edge (clipped by the card's overflow: hidden), so the reason could not be
// read. The status now wraps inside the row and is readable in full, at every width (longer sentences too).
// Synthetic /api/models/machines in the real route's shape (machines, services, health{machines,reasons,failing}).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/machines-pill-wrap-2234.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { run, openPage, shot, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const SERVICES = ['chatFast', 'chatSmart', 'chatCode', 'vision', 'decision', 'sensitivity', 'embedding', 'reranker', 'ocr', 'documents'];
const view = (machines) => ({
  machines: [{ id: 'local', builtIn: true, name: null, address: null, services: SERVICES }, ...machines.map((m) => ({ id: m.id, name: m.name, address: m.address, services: [] }))],
  services: SERVICES.map((id) => ({ id, mode: id.startsWith('chat') ? 'chat' : 'runtime', machine: 'local', enabled: true, url: null })),
  health: {
    services: { embedding: { state: 'unreachable', reason: 'refused' } },
    machines: { local: 'unreachable', ...Object.fromEntries(machines.map((m) => [m.id, 'unreachable'])) },
    reasons: { local: 'refused', ...Object.fromEntries(machines.map((m) => [m.id, 'timeout'])) },
    failing: { local: 'embedding' },
  },
});
const mock = (v) => (page) => page.route(/\/api\/models\/machines(\?.*)?$/, (r) => r.fulfill({ json: v }));

run('machines-pill-wrap-2234', Number(process.env.QA_PORT || 32234), async (check, browser, origin) => {
  const v = view([{ id: 'pi', name: 'QA Pi 5 with a rather long synthetic machine name', address: '192.168.1.50' }]);
  for (const view of [{ name: 'iphone', options: IPHONE }, { name: '1440', options: DESKTOP }]) {
    for (const theme of ['light', 'dark']) {
      await check(`${view.name} ${theme}: every machine's status pill is read in full inside its card`, async () => {
        const { page, context, errors } = await openPage(browser, view, theme, { mock: mock(v) });
        await page.goto(`${origin}/settings/machines`);
        const rows = page.locator('.machines-row');
        await rows.first().waitFor({ timeout: 15000 });
        const pills = rows.locator('.mm-state');
        assert.equal(await pills.count(), 2);
        for (let i = 0; i < 2; i++) {
          const pill = pills.nth(i);
          const m = await pill.evaluate((el) => {
            const r = el.getBoundingClientRect(), card = el.closest('.set-rows').getBoundingClientRect();
            // Every character of the text must be laid out inside the card (a clipped pill has its text box past the edge).
            const range = document.createRange(); range.selectNodeContents(el);
            const t = range.getBoundingClientRect();
            return { right: r.right, textRight: t.right, cardRight: card.right, cardLeft: card.left, left: r.left, vw: innerWidth, scrollW: el.scrollWidth, clientW: el.clientWidth, text: el.textContent };
          });
          assert.ok(m.right <= m.cardRight + 0.5, `pill ${i} (${m.text}) ends at ${Math.round(m.right)} px, past the card edge at ${Math.round(m.cardRight)} px`);
          assert.ok(m.textRight <= m.cardRight + 0.5, `pill ${i} text ends at ${Math.round(m.textRight)} px, past the card edge`);
          assert.ok(m.scrollW <= m.clientW + 1, `pill ${i} clips its own text`);
        }
        assert.match(await pills.first().textContent(), /Unreachable · Embeddings \(projects and Diary\): Connection refused/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways');
        // The Settings dialog fades in: photograph it once the transition has ended, not through the half-transparent page behind it.
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
        await page.waitForTimeout(700);
        await shot(page, `2234-machines-${view.name}-${theme}`, { fullPage: true });
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
});
