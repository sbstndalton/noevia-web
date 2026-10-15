// #1576: one chat surface. The project-level "Available in" (Chat / Task / Code) switch is gone and every
// project is a chat project; Task (internal id 'cowork') stays a per-send composer choice for an
// administrator with codeHarness. Four checks, each at 2000 and 390 px in light and dark:
//   1. no project mode switch: the settings dialog has no "Available in" and the cards no mode chip;
//   2. the Code sidebar's "New task" opens a new project chat with Task preselected;
//   3. a project once saved as Task-only (modes ['cowork'], as unmigrated data) is listed, opens, and its
//      old chat still shows the inline task card, with a working composer;
//   4. a member (not an administrator) never sees Task, in a project chat or a free chat.
//
// Offline: the app is built from this checkout and every API is a synthetic stub.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> QA_CORE_SERVER=<noevia-core/server> [QA_SHOTS=<dir>] [QA_TAG=after] node qa/one-chat-mode-1576.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const { navClick } = require('./nav.cjs');

const PORT = Number(process.env.QA_PORT || 31576);
const SHOTS = process.env.QA_SHOTS || '';
const TAG = process.env.QA_TAG || 'after';
const TASK = '15761576-1576-4576-8576-157615761576';
const CAPS = ['read_repository', 'edit_file', 'execute_command'];
const base = { goal: '', instructions: '', memories: [], files: [], assets: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000 };
const projects = () => [
  { ...base, id: 'p-cw', name: 'Synthetic task project', modes: ['cowork'], chats: [{ id: 'c-task', title: 'Synthetic old task chat', preview: 'Fix the synthetic test', updatedAt: 5000, mode: 'cowork' }] },
  { ...base, id: 'p-plain', name: 'Synthetic plain project', modes: ['chat'], chats: [] },
];
const history = [
  { role: 'user', content: 'Fix the synthetic test.' },
  { role: 'assistant', content: 'Task started on synthetic-repo.', coworkTask: { projectId: 'p-cw', taskId: TASK, repository: 'synthetic-repo' } },
];
const task = { id: TASK, status: 'completed', stage: null, error: null, createdAt: 1, updatedAt: 2, task: 'Fix the synthetic test', branch: 'noevia/synthetic', meta: null,
  identityHash: null, capabilities: CAPS, steps: [], plan: null, assistantOutput: { text: 'Synthetic test fixed.', truncated: false }, approval: null, result: null };
const codeState = { repositories: [{ id: 'synthetic-repo' }], capabilities: CAPS, defaultCapabilities: ['read_repository'], harnesses: [{ id: 'synthetic', label: 'Synthetic', version: '1' }],
  promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Synthetic direct.' }], sandboxed: true, network: false, tasks: [task] };

async function open(browser, { width, theme, role }) {
  const phone = width < 768;
  const page = await browser.newPage(withLocale({ viewport: { width, height: phone ? 844 : 1100 }, isMobile: phone, hasTouch: phone }));
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
  const user = { id: `synthetic-${role}`, username: role, displayName: `Synthetic ${role}`, role, diaryEnabled: false, onboarded: true };
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { codeHarness: true, previews: true } } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: projects(), freeChats: [{ id: 'fc1', title: 'Synthetic free chat', updatedAt: 4000 }] } }));
  await page.route('**/api/projects/*/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/chats/c-task/history', (r) => r.fulfill({ json: { history, revision: 'r1' } }));
  await page.route('**/api/chats/fc1/history', (r) => r.fulfill({ json: { history: [{ role: 'user', content: 'Synthetic hello.' }, { role: 'assistant', content: 'Synthetic hi.' }], revision: 'r1' } }));
  // The server answers code state to administrators only.
  await page.route('**/api/projects/*/code**', (r) => {
    if (role !== 'admin') return r.fulfill({ status: 403, json: { error: 'Code is limited to administrators.' } });
    const url = new URL(r.request().url());
    return r.fulfill({ json: url.pathname.endsWith(`/code/${TASK}`) ? task : codeState });
  });
  return page;
}
const shot = async (page, name, width, theme) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1576-${TAG}-${name}-${width}-${theme}.png`) }); };
async function openDrawer(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); }
}
const composerBox = (page) => page.locator('.composer').filter({ visible: true }).first();

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`PASS one-chat-mode-1576: ${name}`); }
    catch (e) { failed++; console.log(`FAIL one-chat-mode-1576: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  const watchdog = setTimeout(() => { console.log('FAIL one-chat-mode-1576: watchdog (240 s)'); process.exit(1); }, 240000);
  try {
    for (const width of [2000, 390]) for (const theme of ['light', 'dark']) {
      const at = `${width} px ${theme}`;

      await check(`${at}: no project mode switch (settings dialog, cards)`, async () => {
        const page = await open(browser, { width, theme, role: 'admin' });
        try {
          await page.goto(`http://localhost:${PORT}/`);
          await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
          await navClick(page, 'Projects');
          const card = page.locator('.project-card').filter({ hasText: 'Synthetic task project' }).first();
          await card.waitFor({ timeout: 20000 });
          assert.equal(await page.locator('.project-card [aria-label^="Available in"]').count(), 0, 'no "Available in" chip on any card');
          await card.locator('.project-card-options').click();
          await page.getByRole('menuitem', { name: 'Project settings' }).click();
          const dialog = page.getByRole('dialog', { name: 'Edit Synthetic task project' });
          await dialog.waitFor();
          await page.waitForTimeout(300);
          assert.equal(await dialog.getByText('Available in', { exact: true }).count(), 0, 'no "Available in" section');
          // The old labels were "Chat", "Task · not built yet" and "Code · preview".
          for (const name of [/^Chat( ·|$)/, /^Task( ·|$)/, /^Code( ·|$)/]) assert.equal(await dialog.getByRole('checkbox', { name }).count(), 0, `no ${name} mode checkbox`);
          assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'the dialog does not overflow');
          await shot(page, 'settings', width, theme);
          assert.deepEqual(page.errors, []);
        } finally { await page.close(); }
      });

      await check(`${at}: "New task" opens a project chat with Task preselected`, async () => {
        const page = await open(browser, { width, theme, role: 'admin' });
        try {
          await page.goto(`http://localhost:${PORT}/`);
          await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
          await openDrawer(page);
          await page.locator('.app-mode-switch [data-mode="code"]').filter({ visible: true }).first().click();
          await openDrawer(page);
          await page.locator('.new-chat-btn').filter({ visible: true }).first().click();
          const start = page.getByRole('button', { name: 'Start a task in Synthetic plain project' });
          await start.waitFor({ timeout: 15000 });
          await shot(page, 'new-task-picker', width, theme);
          await start.click();
          const box = composerBox(page);
          await box.waitFor({ timeout: 15000 });
          const taskRadio = box.locator('[role="radio"][data-mode="cowork"]');
          await taskRadio.waitFor({ timeout: 15000 });
          assert.equal(await taskRadio.getAttribute('aria-checked'), 'true', 'Task is preselected');
          assert.equal(await page.getByRole('tab', { name: 'Code' }).count(), 0, 'it opened a chat, not the project page Code tab');
          await box.locator('.composer-mode-harness[data-caption="cowork"]').waitFor({ timeout: 15000 });
          assert.match(await box.locator('.composer-mode-harness').innerText(), /synthetic-repo/, 'the caption names the repository Task runs on');
          await shot(page, 'new-task-chat', width, theme);
          assert.deepEqual(page.errors, []);
        } finally { await page.close(); }
      });

      await check(`${at}: a once Task-only project is listed and its old chat keeps its task card`, async () => {
        const page = await open(browser, { width, theme, role: 'admin' });
        try {
          await page.goto(`http://localhost:${PORT}/`);
          await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
          await openDrawer(page);
          const entry = page.locator('.sidebar').getByRole('button', { name: 'Open Synthetic task project', exact: true });
          await entry.waitFor({ timeout: 10000 });
          await entry.click();
          await page.getByRole('heading', { name: 'Synthetic task project' }).waitFor();
          assert.equal(await page.getByText(/not enabled for Chat/).count(), 0, 'no "not enabled for Chat" notice');
          assert.ok(await page.getByRole('textbox', { name: 'Message Synthetic task project' }).isVisible(), 'the project composer is there');
          await page.locator('.chat-index-row').filter({ hasText: 'Synthetic old task chat' }).click();
          const card = page.locator('section.cowork-task');
          await card.waitFor({ timeout: 15000 });
          await page.locator('.cowork-task-status[data-status="completed"]').waitFor({ timeout: 15000 });
          assert.ok(await composerBox(page).isVisible(), 'the chat can be continued');
          await shot(page, 'old-task-card', width, theme);
          assert.deepEqual(page.errors, []);
        } finally { await page.close(); }
      });

      await check(`${at}: a member never sees Task, in a project chat or a free chat`, async () => {
        const page = await open(browser, { width, theme, role: 'member' });
        try {
          await page.goto(`http://localhost:${PORT}/`);
          await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
          await page.waitForTimeout(500);
          const box = composerBox(page);
          assert.equal(await box.locator('[data-mode="cowork"]').count(), 0, 'no Task option in a new free chat');
          assert.doesNotMatch(await box.innerText(), /\bTask\b/, 'the free-chat composer never names Task');
          await openDrawer(page);
          await page.locator('.sidebar').getByRole('button', { name: 'Open Synthetic plain project', exact: true }).click();
          await page.getByRole('heading', { name: 'Synthetic plain project' }).waitFor();
          await page.getByRole('button', { name: 'New chat', exact: true }).filter({ visible: true }).first().click();
          const projectBox = composerBox(page);
          await projectBox.waitFor();
          await page.waitForTimeout(500);
          assert.equal(await projectBox.locator('[data-mode="cowork"]').count(), 0, 'no Task option in a project chat');
          assert.doesNotMatch(await projectBox.innerText(), /\bTask\b/, 'the project composer never names Task');
          await shot(page, 'member-project-chat', width, theme);
          assert.deepEqual(page.errors, []);
        } finally { await page.close(); }
      });
    }
  } finally {
    clearTimeout(watchdog);
    await browser.close();
    await fixture.close();
  }
  console.log(failed ? `one-chat-mode-1576: ${failed} check(s) failed` : 'one-chat-mode-1576: all checks passed');
  process.exit(failed ? 1 : 0);
})();
