'use strict';
// sbstndalton/noevia#2600: the Code task card and its start/failure messages said "Cowork task" (the old product name). The
// prose now says "Code task" ("Task" for the mode); internal ids (the cowork-task classes, the 'cowork' mode id) are unchanged.
// Starts a task in a Task chat, then a second one that the server refuses (a task is already running), and reads the card, the
// messages and the sender label. Offline: the fixture serves the build; /api/chat and the code API are stubs.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/code-task-wording-2600.cjs
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];
const TASK = '26002600-2600-4600-8600-260026002600';
const CAPS = ['read_repository', 'edit_file', 'execute_command'];
const PROJECT = { id: 'p-plain', name: 'QA-2600 project', modes: ['chat'], chats: [], goal: '', instructions: '', memories: [], files: [], assets: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000 };
const ADMIN = { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin', role: 'admin', diaryEnabled: false, onboarded: true };
const task = { id: TASK, status: 'running', stage: 'Reading the repository', error: null, createdAt: 1, updatedAt: 2, task: 'QA-2600 fix the test', branch: 'noevia/qa-2600', meta: null,
  identityHash: null, capabilities: CAPS, steps: [], plan: null, assistantOutput: null, approval: null, result: null };
const codeState = { repositories: [{ id: 'qa-repo' }], capabilities: CAPS, defaultCapabilities: ['read_repository'], harnesses: [{ id: 'qa', label: 'QA', version: '1' }],
  promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'QA direct.' }], sandboxed: true, network: false, tasks: [task] };

async function mock(page, state) {
  await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { codeHarness: true, previews: true } } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [PROJECT], freeChats: [] } }));
  await page.route('**/api/projects/*/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/code/active', (r) => r.fulfill({ json: { tasks: [], total: 0 } }));
  await page.route('**/api/projects/*/code**', (r) => r.fulfill({ json: new URL(r.request().url()).pathname.endsWith(`/code/${TASK}`) ? task : codeState }));
  await page.route('**/api/chat', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    state.sends++;
    if (state.sends === 1) return r.fulfill({ json: { task: { taskId: TASK, branch: 'noevia/qa-2600', repository: 'qa-repo' } } });
    return r.fulfill({ status: 409, json: { error: 'This project already has a task running.' } });
  });
}

run('code-task-wording-2600', Number(process.env.QA_PORT || 32600), async (check, browser, origin) => {
  for (const view of VIEWS) {
    await check(`${view[0]} px ${view[2]}: the task card, its start message and its refusal say Code task, never Cowork`, async () => {
      const state = { sends: 0 };
      const page = await themedPage(browser, view);
      try {
        await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: ADMIN, passkeys: [] } }));
        await page.route('**/api/profile', (r) => r.fulfill({ json: { user: ADMIN, passkeys: [] } }));
        await mock(page, state);
        await page.goto(origin + '/');
        await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
        const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
        const drawer = async () => { if (await toggle.isVisible()) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); } };
        await drawer();
        await page.locator('.app-mode-switch [data-mode="code"]').filter({ visible: true }).first().click();
        await drawer();
        await page.locator('.new-chat-btn').filter({ visible: true }).first().click();
        await page.getByRole('button', { name: 'Start a task in QA-2600 project' }).click();
        const box = page.locator('.composer').filter({ visible: true }).first();
        await box.locator('[role="radio"][data-mode="cowork"][aria-checked="true"]').waitFor({ timeout: 15000 });
        const send = async (text) => { const field = box.locator('textarea').first(); await field.fill(text); await field.press('Enter'); };
        await send('QA-2600 fix the test');
        const card = page.locator('section.cowork-task');
        await card.waitFor({ timeout: 15000 });
        await page.getByText('Started a Code task in', { exact: false }).first().waitFor({ timeout: 15000 });
        assert.equal(await card.getAttribute('aria-label'), 'Code task in qa-repo');
        assert.match(await card.locator('.cowork-task-title').innerText(), /^Code task · qa-repo$/);
        await shot(page, `code-task-card-${view[0]}-${view[2]}`);
        await send('QA-2600 a second task');
        await page.getByText('Code task did not start — This project already has a task running.', { exact: true }).waitFor({ timeout: 15000 });
        await shot(page, `code-task-refused-${view[0]}-${view[2]}`);
        const text = await page.locator('.chat-workspace').filter({ visible: true }).first().innerText();
        assert.doesNotMatch(text, /Cowork/, 'the chat still shows the old product name');
        assert.doesNotMatch(await page.locator('.cowork-task').first().getAttribute('aria-label'), /Cowork/);
      } finally { await page.close(); }
    });
  }
});
