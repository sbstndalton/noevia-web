// #1542 / #1626: project cards in the Projects library, the project header and the sidebar.
//   #1542: a name whose identifier is "20261012-0610" must not break at the hyphen. No rendered line of the
//          name may end with "-", and the identifier stays on one line.
//   #1626: on an archived card, the Restore button restores the project (its config request is sent) and
//          does not open it. The card itself still opens when clicked.
// Synthetic fixture only: every API is a stub (diary-fixture.cjs, plus the routes below); no real data.
//   PLAYWRIGHT_MODULE=<playwright> QA_SCREENSHOTS=<dir> node qa/project-cards-1542-1626.cjs
// Fails on a build without the fix, passes with it.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { navClick } = require('./nav.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31626);
const SHOTS = process.env.QA_SCREENSHOTS || path.join(process.env.HOME || '', 'noevia-work', 'web-fixC-shots');
const NAME = 'QA Haiku 20261012-0610 renamed';
const WIDTHS = [[1440, 900], [809, 900], [375, 812]];
const THEMES = ['light', 'dark'];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const base = { goal: 'Synthetic goal for the card.', instructions: '', memories: [], sourceFolders: [], modes: ['chat'], files: [], chats: [], assets: [], toolboxes: [], pinned: false, createdAt: 1, updatedAt: Date.now() };
const freshProjects = () => [
  { ...base, id: 'p-active', name: NAME, archived: false },
  { ...base, id: 'p-archived', name: NAME, archived: true },
];

// The rendered lines of an element's text. Each visible character's client rect is grouped by its top edge;
// the word joiner (U+2060) is invisible and left out. Runs inside the page through locator.evaluate.
const LINES = (el) => {
  const lines = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '⁠') continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      if (!rect || !rect.width) continue;
      let line = lines[lines.length - 1];
      if (!line || Math.abs(rect.top - line.top) > 4) { line = { top: rect.top, text: '' }; lines.push(line); }
      line.text += ch;
    }
  }
  return lines.map((l) => l.text.trim());
};

const assertNameOnLines = (lines, where) => {
  assert.ok(lines.length >= 1, `${where}: the name is rendered`);
  const hyphenEnds = lines.filter((l) => l.endsWith('-'));
  assert.deepEqual(hyphenEnds, [], `${where}: a line ends with a hyphen, so the identifier is split: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('20261012-0610')), `${where}: the identifier 20261012-0610 is on one line: ${JSON.stringify(lines)}`);
  assert.equal(lines.join(' ').replace(/\s+/g, ' '), NAME, `${where}: the name reads the same: ${JSON.stringify(lines)}`);
};

// A fresh browser page on the synthetic library. The mock keeps its own project state, so a restore is
// reflected on the next workspace read the way the real server does it.
async function openApp(browser, { width, height, theme, reducedMotion = false, errors }) {
  const phone = width < 500; // the phone layout is applied only to a phone user agent, as a real phone sends
  const page = await browser.newPage(withLocale({
    viewport: { width, height },
    ...(reducedMotion ? { reducedMotion: 'reduce' } : {}),
    ...(phone ? { hasTouch: true, isMobile: true, userAgent: IPHONE } : {}),
  }));
  page.on('pageerror', (e) => errors.push(e.message));
  const state = { projects: freshProjects() };
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: state.projects, freeChats: [] } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.route('**/api/projects/*/config', (r) => {
    const req = r.request();
    if (req.method() !== 'POST') return r.fallback();
    const id = new URL(req.url()).pathname.split('/')[3];
    const body = req.postDataJSON();
    state.projects = state.projects.map((p) => (p.id === id ? { ...p, ...body } : p));
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByPlaceholder('Message noevia…').waitFor({ timeout: 20000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, `the ${theme} theme is applied`);
  return { page };
}

async function openProjects(page, tab) {
  await navClick(page, 'Projects');
  await page.locator('.projects-workspace').waitFor();
  if (tab === 'archived') await page.getByRole('tab', { name: /Archived/ }).click();
  await page.locator('.projects-grid article.project-card').waitFor();
}

const card = (page) => page.locator('.projects-grid article.project-card');
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) });
// The restore request as the page sends it: the project id from the path, and the JSON body.
const sentRequest = (page) => page.waitForRequest((r) => r.method() === 'POST' && /\/api\/projects\/[^/]+\/config$/.test(new URL(r.url()).pathname), { timeout: 4000 })
  .then((r) => ({ id: new URL(r.url()).pathname.split('/')[3], body: r.postDataJSON() }), () => null);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS project-cards-1542-1626: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL project-cards-1542-1626: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    for (const [width, height] of WIDTHS) {
      for (const theme of THEMES) {
        const tag = `${width}px ${theme}`;
        const opts = { width, height, theme, errors };

        // The Yours card and the Archived card both show the name (#1542).
        await check(`#1542 ${tag}: the Yours card name keeps its identifier on one line`, async () => {
          const { page } = await openApp(browser, opts);
          await openProjects(page, 'active');
          const lines = await card(page).locator('.project-card-open').evaluate(LINES);
          await shot(page, `project-cards-${width}-${theme}-yours.png`);
          assertNameOnLines(lines, `${tag} Yours card`);
          await page.close();
        });

        // Archived: the name on the archived card (#1542). The screenshot is taken before the assertions, so a failing run keeps it.
        await check(`#1542 ${tag}: the Archived card name keeps its identifier on one line`, async () => {
          const { page } = await openApp(browser, opts);
          await openProjects(page, 'archived');
          const lines = await card(page).locator('.project-card-open').evaluate(LINES);
          await shot(page, `project-cards-${width}-${theme}-archived.png`);
          assertNameOnLines(lines, `${tag} Archived card`);
          await page.close();
        });

        await check(`#1626 ${tag}: the Restore button is the element on top where it is drawn`, async () => {
          const { page } = await openApp(browser, opts);
          await openProjects(page, 'archived');
          const restore = card(page).locator('.project-card-foot').getByRole('button', { name: 'Restore', exact: true });
          await restore.scrollIntoViewIfNeeded();
          const top = await restore.evaluate((btn) => {
            const r = btn.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { onButton: !!hit && (hit === btn || btn.contains(hit)), hit: hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : 'nothing' };
          });
          assert.ok(top.onButton, `Restore is covered by ${top.hit} at its centre, so a click opens the project`);
          await page.close();
        });

        // Restore: the request is sent with archived:false, the card leaves Archived, and the page does not open the project.
        await check(`#1626 ${tag}: Restore sends the restore request and does not open the project`, async () => {
          const { page } = await openApp(browser, opts);
          await openProjects(page, 'archived');
          const before = page.url();
          const sent = sentRequest(page);
          const restore = card(page).locator('.project-card-foot').getByRole('button', { name: 'Restore', exact: true });
          await restore.click({ force: true }); // a real mouse click at the button's centre, as a person makes
          const req = await sent;
          assert.ok(req, `the restore request was sent (POST /api/projects/<id>/config); the page is at ${page.url()}`);
          assert.equal(req.id, 'p-archived', 'the request is for the archived project');
          assert.equal(req.body.archived, false, 'the request restores the project');
          await page.waitForTimeout(400);
          assert.equal(page.url(), before, `the URL did not change (${page.url()})`);
          assert.equal(await page.locator('h1.project-title').count(), 0, 'the project did not open');
          // The server now holds archived:false, so the next workspace read takes the card off Archived.
          await page.waitForFunction(() => !document.querySelector('.projects-grid article.project-card'), null, { timeout: 5000 });
          await page.close();
        });

        await check(`#1626 ${tag}: the "…" menu still restores the project`, async () => {
          const { page } = await openApp(browser, opts);
          await openProjects(page, 'archived');
          const sent = sentRequest(page);
          await card(page).getByRole('button', { name: /^Project options for / }).click();
          await page.getByRole('menuitem', { name: 'Restore project', exact: true }).click();
          const req = await sent;
          assert.equal(req?.id, 'p-archived', 'the menu request is for the archived project');
          assert.equal(req?.body.archived, false, 'the menu sends archived:false');
          await page.close();
        });

        // The card still opens: a click on its goal, and a click on the empty part of the footer row.
        await check(`#1626 ${tag}: clicking the card goal still opens the project`, async () => {
          const { page } = await openApp(browser, opts);
          await openProjects(page, 'archived');
          const goal = await card(page).locator('.project-card-goal').boundingBox();
          assert.ok(goal, 'the goal is laid out');
          await page.mouse.click(goal.x + goal.width / 2, goal.y + goal.height / 2);
          await page.waitForURL(/\/p\/p-archived$/, { timeout: 5000 });
          assertNameOnLines(await page.locator('h1.project-title').evaluate(LINES), `${tag} project header`);
          await shot(page, `project-cards-${width}-${theme}-header.png`);
          await page.close();
        });

        await check(`#1626 ${tag}: clicking the empty footer row beside Restore opens the project`, async () => {
          const { page } = await openApp(browser, opts);
          await openProjects(page, 'archived');
          // The footer is right-aligned, so its left edge is the empty part of the row.
          const foot = await card(page).locator('.project-card-foot').boundingBox();
          assert.ok(foot, 'the footer row is laid out');
          await page.mouse.click(foot.x + 6, foot.y + foot.height / 2);
          await page.waitForURL(/\/p\/p-archived$/, { timeout: 5000 });
          await page.close();
        });

        // The sidebar wraps only when motion is reduced and the row is hovered, so this case is exercised.
        await check(`#1542 ${tag}: the sidebar name keeps its identifier on one line when hovered`, async () => {
          const { page } = await openApp(browser, { ...opts, reducedMotion: true });
          const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
          if (await toggle.isVisible()) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); }
          const row = page.locator('.sidebar .proj-row').filter({ has: page.locator('.sidebar-label-text', { hasText: 'QA Haiku' }) }).first();
          await row.waitFor();
          await row.hover();
          await page.waitForTimeout(150);
          // A project row truncates on one line; its tooltip (the label's title) carries the whole name.
          const lines = await row.locator('.sidebar-label-text').evaluate(LINES);
          const title = await row.locator('.sidebar-label').getAttribute('title');
          await shot(page, `project-cards-${width}-${theme}-sidebar.png`);
          assertNameOnLines(lines, `${tag} sidebar`);
          assert.equal(lines.length, 1, `${tag} sidebar: the project name stays on one line: ${JSON.stringify(lines)}`);
          assert.equal(title, NAME, `${tag} sidebar: the full name is the tooltip`);
          await page.close();
        });
      }
    }
    await check('no page errors across the run', async () => assert.deepEqual(errors, []));
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nproject-cards-1542-1626: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
