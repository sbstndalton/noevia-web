'use strict';
// sbstndalton/noevia#2646: a Code task whose agent made no commit (a declined edit, say) still waited at "Accept the finished change"
// with an empty file list, and ended only after a second Decline. The server states the fact itself: its review card carries
// `review.code === 'no_change'` ("The task made no commits, so there is nothing to review.") and one commit as both base and head.
// The card now says plainly that there is nothing to accept and offers one button, Close (which answers the card with a decline, as
// the server expects); a card with a real change keeps Accept change and Decline.
// Offline: the fixture serves the build; the Code APIs are stubs shaped like core's code-harness.cjs review card.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/code-no-change-2646.cjs
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];
const TASK = '26462646-2646-4646-8646-264626462646';
const CAPS = ['read_repository', 'edit_file'];
const SHA = 'a'.repeat(40), HEAD2 = 'b'.repeat(40);
const PROJECT = { id: 'p-nc', name: 'QA-2646 project', modes: ['chat'], goal: '', instructions: '', memories: [], files: [], assets: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, chats: [] };
const ADMIN = { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin', role: 'admin', diaryEnabled: false, onboarded: true };
const NO_COMMITS = 'The task made no commits, so there is nothing to review.';
const CARD = (changed) => ({ id: '00000000-0000-4000-8000-000000000009', taskId: TASK, action: 'review_change', title: 'Accept this change', kind: 'review', command: '',
  paths: changed ? ['src/qa.js'] : [],
  reason: changed ? 'The Planner’s verdict is advice. Accepting records this reviewed head as accepted; nothing is merged automatically.'
    : `Not reviewed: ${NO_COMMITS} Review the change on its branch yourself before accepting it.`,
  arguments: { branch: 'noevia/qa-2646', baseSha: SHA, headSha: changed ? HEAD2 : SHA, files: changed ? ['src/qa.js'] : [] }, diff: null,
  review: changed ? { status: 'completed', reviewer: 'planner', baseSha: SHA, headSha: HEAD2, verdict: 'approve', summary: 'QA: fine.', findings: [] }
    : { status: 'failed', reviewer: 'planner', baseSha: SHA, headSha: SHA, code: 'no_change', reason: NO_COMMITS } });
const task = (status, changed, over = {}) => ({ id: TASK, status, stage: null, error: null, createdAt: Date.now() - 90000, updatedAt: Date.now() - 60000, task: 'QA-2646 edit the file', branch: 'noevia/qa-2646', meta: null,
  identityHash: null, capabilities: CAPS, steps: [], plan: null, assistantOutput: null, approval: status === 'waiting_approval' ? CARD(changed) : null, result: null,
  review: CARD(changed).review, ...over });

async function mock(page, server, changed) {
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: ADMIN, passkeys: [] } }));
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user: ADMIN, passkeys: [] } }));
  await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { codeHarness: true, previews: true } } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [PROJECT], freeChats: [] } }));
  await page.route('**/api/projects/*/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/code/active', (r) => {
    const live = server.status === 'waiting_approval' ? [{ id: TASK, projectId: 'p-nc', projectName: PROJECT.name, title: 'QA-2646 edit the file', status: 'waiting_approval', stage: null, updatedAt: 2, approvalAction: 'review_change' }] : [];
    return r.fulfill({ json: { tasks: live, total: live.length } });
  });
  await page.route('**/api/projects/*/code**', (r) => {
    const req = r.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && /\/approve$/.test(path)) {
      const body = req.postDataJSON();
      server.answers.push(body);
      server.status = 'completed';
      server.result = { stopReason: 'end_turn', review: { reviewed: false, verdict: null, accepted: body.decision !== 'deny', decision: body.decision, headSha: changed ? HEAD2 : SHA } };
      return r.fulfill({ json: { ok: true } });
    }
    const current = task(server.status, changed, { result: server.result || null });
    if (path.endsWith(`/code/${TASK}`)) return r.fulfill({ json: current });
    return r.fulfill({ json: { repositories: [{ id: 'qa-repo' }], capabilities: CAPS, defaultCapabilities: ['read_repository'], harnesses: [{ id: 'qa', label: 'QA', version: '1' }],
      promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Your request goes to the model as you wrote it.' }], sandboxed: true, network: false, tasks: [current] } });
  });
}
async function openDrawer(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); }
}
async function openCode(page, origin) {
  await page.goto(origin + '/');
  await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
  await openDrawer(page);
  await page.locator('.app-mode-switch [data-mode="code"]').filter({ visible: true }).first().click();
  await openDrawer(page);
  await page.locator('.coding-history').filter({ visible: true }).first().getByRole('button', { name: 'Open QA-2646 project' }).first().click();
  await page.locator('.code-approval').waitFor({ timeout: 15000 });
}

run('code-no-change-2646', Number(process.env.QA_PORT || 32646), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;

    await check(`${tag}: a task with no commit says there is nothing to accept and offers only Close; Close ends it`, async () => {
      const server = { status: 'waiting_approval', answers: [], result: null };
      const page = await themedPage(browser, view);
      try {
        await mock(page, server, false);
        await openCode(page, origin);
        const card = page.locator('.code-approval');
        await card.getByText('The task made no changes, so there is nothing to accept. Closing ends the task.', { exact: true }).waitFor({ timeout: 5000 });
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await shot(page, `no-change-card-${view[0]}-${view[2]}`);
        assert.equal(await card.getByRole('button', { name: 'Accept change' }).count(), 0, 'the empty change can still be accepted');
        assert.equal(await card.getByRole('button', { name: 'Decline' }).count(), 0, 'there is still a Decline');
        assert.equal(await card.getByRole('button').count(), 1, 'the card offers more than one button');
        assert.equal(await card.getByText('Review the change on its branch yourself').count(), 0, 'the card still asks for a review of nothing');
        await card.getByRole('button', { name: 'Close', exact: true }).click();
        await page.locator('.code-approval').waitFor({ state: 'detached', timeout: 15000 });
        assert.deepEqual(server.answers, [{ decision: 'deny', approvalId: CARD(false).id }]);
        await page.getByText('There was no change to accept.').first().waitFor({ timeout: 15000 });
        await shot(page, `no-change-closed-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });

    await check(`${tag}: a task with a real change still offers Accept change and Decline`, async () => {
      const server = { status: 'waiting_approval', answers: [], result: null };
      const page = await themedPage(browser, view);
      try {
        await mock(page, server, true);
        await openCode(page, origin);
        const card = page.locator('.code-approval');
        await card.getByRole('button', { name: 'Accept change', exact: true }).waitFor({ timeout: 5000 });
        await card.getByRole('button', { name: 'Decline', exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await card.getByRole('button', { name: 'Close' }).count(), 0);
        assert.equal(await card.getByText(/nothing to accept/).count(), 0);
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shot(page, `change-card-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
});
