// #553: every top-level view exposes exactly one visible <main> landmark. The Diary stays mounted
// (display:none) behind the chat view, and its <main> used to be the page's only one, so chat and
// project pages had none. Drives the built app against the synthetic diary-fixture.cjs (no real
// Diary): chat (/c/<id>), project (/p/<id>), the Projects list and Diary must each have exactly one
// visible main / [role=main], and a hidden Diary must not expose its own.
// Run: npm run build && PLAYWRIGHT_MODULE=<path to playwright> node qa/main-landmark-553.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = 31553;
const project = { id: 'proj-synthetic', name: 'Synthetic Project', goal: '', instructions: '', model: 'synthetic', memories: [], createdAt: 1, sourceFolders: [], modes: ['chat'], pinned: false, archived: false, files: [], assets: [], toolboxes: ['core'], updatedAt: 2,
  chats: [{ id: 'c-synthetic', title: 'Synthetic chat', updatedAt: 2, preview: '' }] };

// Every element matching main / [role=main] that a person or screen reader could reach: not
// display:none / visibility:hidden anywhere up the tree, and not opted out of the role.
const landmarks = (page) => page.evaluate(() => [...document.querySelectorAll('main, [role="main"]')]
  .filter((el) => el.getAttribute('role') !== 'none' && el.getAttribute('role') !== 'presentation')
  .filter((el) => !el.closest('[hidden], [aria-hidden="true"]'))
  .filter((el) => { for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; })
  .map((el) => el.className || el.tagName));

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const failures = [];
  try {
    const page = await browser.newPage();
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats: [{ id: 'c-free', title: 'Free chat', updatedAt: 1, preview: '' }] } }));
    const check = async (name, path, ready) => {
      await page.goto(`http://localhost:${PORT}${path}`);
      await ready(page);
      await page.waitForTimeout(300);
      const found = await landmarks(page);
      if (found.length !== 1) failures.push(`${name} (${path}): expected exactly 1 visible main landmark, found ${found.length} ${JSON.stringify(found)}`);
    };
    await check('chat', '/c/c-free', (p) => p.getByRole('textbox', { name: /message/i }).waitFor());
    await check('project chat', '/p/proj-synthetic', (p) => p.locator('.project-page').waitFor());
    await check('projects list', '/projects', (p) => p.locator('.projects-workspace').waitFor());
    await check('diary', '/diary', (p) => p.locator('#diary-draft').waitFor());

    // Hidden Diary: still in the DOM behind chat, but it must not expose a second landmark.
    await page.goto(`http://localhost:${PORT}/c/c-free`);
    await page.getByRole('textbox', { name: /message/i }).waitFor();
    const hiddenDiary = await page.evaluate(() => [...document.querySelectorAll('.diary-mount main')].map((m) => m.getAttribute('role')));
    if (hiddenDiary.some((role) => role !== 'none')) failures.push(`hidden Diary main exposes a landmark: roles ${JSON.stringify(hiddenDiary)}`);
    // Chat is the workspace landmark itself, not just any main.
    if (!(await page.locator('main.chat-workspace').count())) failures.push('chat workspace is not a <main>');
  } finally {
    await browser.close();
    await fixture.close();
  }
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log('Landmarks: exactly one visible main on chat, project, projects list and Diary; hidden Diary exposes none.');
})().catch((e) => { console.error(e); process.exit(1); });
