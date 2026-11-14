'use strict';
// sbstndalton/noevia#2599, three faults of the Code view:
//   1. the Code sidebar's Tasks list reads /api/code/active (running and waiting tasks only), yet its empty state said "Your coding
//      tasks will appear here." while finished tasks existed: it is now "Active tasks" with an empty state that says nothing is
//      running and where the finished ones are (each project's Code tab, which does list them);
//   2. "1 Code task needs your decision" stayed up for seconds after Allow once, Decline or Cancel task: it now clears at once,
//      whatever a lagging poll still answers for a few seconds;
//   3. a member (no Code access, the API answers 403) kept the Code switch and got a preview page with a draft composer: the switch
//      is gone for an account the profile says is no administrator, and /code lands in chat.
// Offline: the fixture serves the build; the Code APIs are stubs. The server keeps answering "waiting" for 6 s after a decision.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/code-view-2599.cjs
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];
const TASK = '25992599-2599-4599-8599-259925992599';
const CAPS = ['read_repository', 'edit_file', 'execute_command'];
const PROJECT = { id: 'p-cw', name: 'QA-2599 project', modes: ['chat'], goal: '', instructions: '', memories: [], files: [], assets: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000,
  chats: [{ id: 'c-task', title: 'QA-2599 task chat', preview: 'Fix the QA test', updatedAt: 5000, mode: 'cowork' }] };
const user = (role) => ({ id: `qa-${role}`, username: `qa-${role}`, displayName: `QA ${role}`, role, diaryEnabled: false, onboarded: true });
const approval = { id: 'ap-1', action: 'edit_file', title: 'Edit qa-stub-1.txt', kind: 'edit', command: '', paths: ['qa-stub-1.txt'], reason: 'QA edit', arguments: null, diff: null };
const task = (status, over = {}) => ({ id: TASK, status, stage: null, error: null, createdAt: 1, updatedAt: 2, task: 'QA-2599 fix the test', branch: 'noevia/qa-2599', meta: null,
  identityHash: null, capabilities: CAPS, steps: [], plan: null, assistantOutput: null, approval: status === 'waiting_approval' ? approval : null, result: null, ...over });
const finished = (id, status) => task(status, { id, task: `QA-2599 ${status} task`, approval: null });

/** `state.status` is what the server really holds; `state.lagUntil` keeps the poll answering "waiting" a while after a decision. */
async function mock(page, role, state) {
  const me = user(role);
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: me, passkeys: [] } }));
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user: me, passkeys: [] } }));
  await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { codeHarness: true, previews: true } } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [PROJECT], freeChats: [] } }));
  await page.route('**/api/projects/*/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/chats/c-task/history', (r) => r.fulfill({ json: { history: [{ role: 'user', content: 'Fix the QA test.' },
    { role: 'assistant', content: 'Started a Code task in qa-repo.', coworkTask: { projectId: 'p-cw', taskId: TASK, repository: 'qa-repo' } }], revision: 'r1' } }));
  await page.route('**/api/code/active', (r) => {
    if (role !== 'admin') return r.fulfill({ status: 403, json: { error: 'Administrator required' } });
    const shownWaiting = state.status === 'waiting_approval' || Date.now() < state.lagUntil;
    const live = state.gone && Date.now() >= state.lagUntil ? [] : (shownWaiting || state.status === 'running' ? [{ id: TASK, projectId: 'p-cw', projectName: PROJECT.name, title: 'QA-2599 fix the test',
      status: shownWaiting ? 'waiting_approval' : 'running', stage: null, updatedAt: Date.now(), approvalAction: shownWaiting ? 'edit_file' : null }] : []);
    return r.fulfill({ json: { tasks: state.active ?? live, total: (state.active ?? live).length } });
  });
  await page.route('**/api/projects/*/code**', async (r) => {
    const req = r.request(), path = new URL(req.url()).pathname;
    if (role !== 'admin') return r.fulfill({ status: 403, json: { error: 'Administrator required' } });
    if (req.method() === 'POST' && /\/approve$/.test(path)) { state.status = 'running'; state.lagUntil = Date.now() + 6000; return r.fulfill({ json: { ok: true } }); }
    if (req.method() === 'POST' && /\/cancel$/.test(path)) { state.status = 'cancelled'; state.gone = true; state.lagUntil = Date.now() + 6000; return r.fulfill({ json: task('cancelled') }); }
    if (path.endsWith(`/code/${TASK}`)) return r.fulfill({ json: task(state.status) });
    return r.fulfill({ json: { repositories: [{ id: 'qa-repo' }], capabilities: CAPS, defaultCapabilities: ['read_repository'], harnesses: [{ id: 'qa', label: 'QA', version: '1' }],
      promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'QA direct.' }], sandboxed: true, network: false,
      tasks: state.finishedTasks ?? [task(state.status)] } });
  });
}

const banner = (page) => page.locator('.active-code-entry summary');
async function openDrawer(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); }
}

run('code-view-2599', Number(process.env.QA_PORT || 32599), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;

    await check(`${tag}: the Tasks list is "Active tasks" and, when nothing runs, says where finished tasks are (and they are there)`, async () => {
      const state = { status: 'completed', active: [], finishedTasks: [finished('f1111111-1111-4111-8111-111111111111', 'completed'), finished('f2222222-2222-4222-8222-222222222222', 'cancelled')] };
      const page = await themedPage(browser, view);
      try {
        await mock(page, 'admin', state);
        await page.goto(origin + '/');
        await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
        await openDrawer(page);
        await page.locator('.app-mode-switch [data-mode="code"]').filter({ visible: true }).first().click();
        await openDrawer(page);
        const side = page.locator('.coding-history').filter({ visible: true }).first();
        await side.getByText('Active tasks', { exact: true }).waitFor({ timeout: 15000 });
        await side.getByText('No tasks are running. Finished tasks are in each project’s Code tab.', { exact: true }).waitFor({ timeout: 15000 });
        assert.equal(await page.getByText('Your coding tasks will appear here.').count(), 0);
        await page.waitForTimeout(700); // the phone drawer has finished sliding in
        await shot(page, `code-tasks-empty-${view[0]}-${view[2]}`);
        // The finished tasks really are in the project's Code tab.
        await side.getByRole('button', { name: 'Open QA-2599 project' }).click();
        await page.getByText('QA-2599 completed task').first().waitFor({ timeout: 15000 });
        await page.getByText('QA-2599 cancelled task').first().waitFor({ timeout: 15000 });
      } finally { await page.close(); }
    });

    for (const [label, click] of [
      ['Allow once', (p) => p.getByRole('button', { name: 'Allow once', exact: true }).click()],
      ['Decline', (p) => p.getByRole('button', { name: 'Decline', exact: true }).click()],
      ['Cancel task', (p) => p.getByRole('button', { name: 'Cancel task', exact: true }).click()],
    ]) {
      await check(`${tag}: after ${label} the "needs your decision" banner clears at once, not seconds later`, async () => {
        const state = { status: 'waiting_approval', lagUntil: 0 };
        const page = await themedPage(browser, view);
        try {
          await mock(page, 'admin', state);
          await page.goto(origin + '/c/c-task');
          await banner(page).filter({ hasText: '1 Code task needs your decision' }).waitFor({ timeout: 20000 });
          await page.locator('section.cowork-task .code-approval').waitFor({ timeout: 15000 });
          await shot(page, `code-banner-waiting-${label.replace(/ /g, '-')}-${view[0]}-${view[2]}`);
          await click(page);
          const start = Date.now();
          // The poll still says "waiting" for 6 s; the banner must not.
          await page.locator('.active-code-entry summary', { hasText: 'needs your decision' }).waitFor({ state: 'detached', timeout: 2500 }).catch(() => undefined);
          const left = await page.locator('.active-code-entry summary', { hasText: 'needs your decision' }).count();
          assert.equal(left, 0, `the decision banner was still showing ${Date.now() - start} ms after ${label}`);
          await shot(page, `code-banner-cleared-${label.replace(/ /g, '-')}-${view[0]}-${view[2]}`);
          // And it does not come back from the lagging poll that is still answering "waiting".
          await page.waitForTimeout(1800);
          assert.equal(await page.locator('.active-code-entry summary', { hasText: 'needs your decision' }).count(), 0, 'the banner came back');
        } finally { await page.close(); }
      });
    }

    await check(`${tag}: a member has no Code switch and /code lands in chat; an administrator keeps the switch`, async () => {
      const page = await themedPage(browser, view);
      const admin = await themedPage(browser, view);
      try {
        await mock(page, 'member', { status: 'completed' });
        await page.goto(origin + '/code');
        await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
        await openDrawer(page);
        await page.waitForTimeout(600);
        assert.equal(await page.locator('.app-mode-switch [data-mode="code"]').count(), 0, 'the member still has the Code switch');
        assert.equal(await page.getByText(/Interface preview/).count(), 0, 'the member sees the preview page');
        await shot(page, `code-member-${view[0]}-${view[2]}`);
        await mock(admin, 'admin', { status: 'completed', active: [] });
        await admin.goto(origin + '/');
        await admin.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
        await openDrawer(admin);
        await admin.locator('.app-mode-switch [data-mode="code"]').filter({ visible: true }).first().waitFor({ timeout: 10000 });
      } finally { await page.close(); await admin.close(); }
    });
  }
});
