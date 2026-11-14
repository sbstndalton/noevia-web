'use strict';
// sbstndalton/noevia#2643: a Code task started with the Planner preparation never stopped at its plan card, so the plan could not be
// approved, declined or cancelled from the app: the server gates the plan only when the start body carries `approvePlan: true`
// (core code-service.cjs `approvePlan: body.approvePlan === true`; the Rust front's code-harness service reads the same field), and
// the client never sent it. The Planner preparation now shows "Review the plan before it runs" (on by default) and sends it.
// The stub follows that contract: with the flag the task waits at an `approve_plan` card (the shape recorded in noevia-rs
// crates/code-harness/tests/fixtures/pipeline-service-node.v1.json), without it the task runs on; the card is answered with
// POST .../approve { decision, approvalId } and the stub fails the run if the body is anything else.
// Offline: the fixture serves the build; the Code APIs are stubs.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/code-plan-card-2643.cjs
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];
const TASK = '26432643-2643-4643-8643-264326432643';
const CAPS = ['read_repository', 'edit_file', 'execute_command'];
const PROJECT = { id: 'p-plan', name: 'QA-2643 project', modes: ['chat'], goal: '', instructions: '', memories: [], files: [], assets: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, chats: [] };
const ADMIN = { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin', role: 'admin', diaryEnabled: false, onboarded: true };
const PLAN_CARD = { id: '00000000-0000-4000-8000-000000000002', taskId: TASK, action: 'approve_plan', title: 'Approve the plan', kind: 'plan', command: '', paths: [],
  reason: 'The Planner’s plan for this task. Approving lets the coding agent start on it; every write it makes still asks.',
  arguments: { planHash: 'c0c9b0150e489d480f531627359f04e74da32b37957e9bab131e9b34dc16d9fc', goal: 'Add the QA greeting to the QA project', steps: ['Edit src/qa.js to print the QA greeting'] },
  diff: null, plan: { goal: 'Add the QA greeting to the QA project', steps: [{ n: 1, do: 'Edit src/qa.js to print the QA greeting', done_when: 'The QA greeting is printed' }] } };
const task = (status, over = {}) => ({ id: TASK, status, stage: null, error: null, createdAt: Date.now() - 90000, updatedAt: Date.now() - 60000, task: 'QA-2643 add the greeting', branch: 'noevia/qa-2643', meta: null,
  identityHash: null, capabilities: CAPS, steps: [], plan: null, assistantOutput: null, approval: null, result: null, ...over });

/** `server` holds what the stub saw: the start bodies and the answers to cards. After a start the task waits at the plan card only if the
 *  body asked for it; an answer must be exactly { decision, approvalId } for the card on screen. */
async function mock(page, server) {
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: ADMIN, passkeys: [] } }));
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user: ADMIN, passkeys: [] } }));
  await page.route('**/api/features', (r) => r.fulfill({ json: { flags: { codeHarness: true, codePipeline: true, previews: true } } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [PROJECT], freeChats: [] } }));
  await page.route('**/api/projects/*/skills', (r) => r.fulfill({ json: { skills: [] } }));
  await page.route('**/api/code/active', (r) => {
    const live = server.task && ['running', 'waiting_approval'].includes(server.task.status) ? [{ id: TASK, projectId: 'p-plan', projectName: PROJECT.name, title: 'QA-2643 add the greeting',
      status: server.task.status, stage: null, updatedAt: 2, approvalAction: server.task.approval ? server.task.approval.action : null }] : [];
    return r.fulfill({ json: { tasks: live, total: live.length } });
  });
  await page.route('**/api/projects/*/code**', (r) => {
    const req = r.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && /\/approve$/.test(path)) {
      const body = req.postDataJSON();
      server.answers.push(body);
      if (!body || !['approve', 'deny'].includes(body.decision) || body.approvalId !== PLAN_CARD.id || Object.keys(body).length !== 2) return r.fulfill({ status: 400, json: { error: 'Which approval is this answer for?' } });
      server.task = body.decision === 'approve' ? task('running', { stage: 'Implementing' }) : task('cancelled');
      return r.fulfill({ json: { ok: true } });
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      server.starts.push(body);
      // The Planner pipeline's own gate: opt-in per start, exactly `true`.
      server.task = body.promptPreparation === 'planner' && body.approvePlan === true
        ? task('waiting_approval', { stage: 'Planned', approval: PLAN_CARD })
        : task('running', { stage: 'Implementing' });
      return r.fulfill({ status: 202, json: { taskId: TASK, branch: 'noevia/qa-2643' } });
    }
    if (path.endsWith(`/code/${TASK}`)) return r.fulfill({ json: server.task });
    return r.fulfill({ json: { repositories: [{ id: 'qa-repo' }], capabilities: CAPS, defaultCapabilities: ['read_repository'], harnesses: [{ id: 'qa', label: 'QA', version: '1' }],
      promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Your request goes to the model as you wrote it.' },
        { id: 'planner', label: 'Planner', available: true, reason: 'The Planner plans the task, the coding agent carries it out, the operator’s tests verify it and the Planner reviews it, at most twice more, before you accept.' }],
      sandboxed: true, network: false, tasks: server.task ? [server.task] : [] } });
  });
}
async function openDrawer(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) { await toggle.click(); await page.getByRole('dialog', { name: 'Navigation' }).waitFor(); }
}
async function openCodePanel(page, origin) {
  await page.goto(origin + '/');
  await page.getByPlaceholder(/Message/).first().waitFor({ timeout: 20000 });
  await openDrawer(page);
  await page.locator('.app-mode-switch [data-mode="code"]').filter({ visible: true }).first().click();
  await openDrawer(page);
  await page.locator('.coding-history').filter({ visible: true }).first().getByRole('button', { name: 'Open QA-2643 project' }).click();
  await page.locator('#code-preparation').waitFor({ timeout: 15000 });
}
const tick = (page) => page.getByLabel('Review the plan before it runs', { exact: true });

run('code-plan-card-2643', Number(process.env.QA_PORT || 32643), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;

    await check(`${tag}: a Planner task asks to stop at its plan, the plan card shows, and Approve the plan answers it`, async () => {
      const server = { starts: [], answers: [], task: null };
      const page = await themedPage(browser, view);
      try {
        await mock(page, server);
        await openCodePanel(page, origin);
        assert.equal(await page.getByText('Review the plan before it runs').count(), 0, 'the option shows for the Direct preparation');
        await page.locator('#code-preparation').selectOption('planner');
        await tick(page).waitFor({ timeout: 5000 });
        assert.equal(await tick(page).isChecked(), true, 'the option is not on by default');
        await tick(page).scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shot(page, `plan-option-${view[0]}-${view[2]}`);
        await page.locator('#code-prompt').fill('QA-2643 add the greeting');
        await page.getByRole('button', { name: 'Start task', exact: true }).click();
        const card = page.locator('.code-approval');
        await card.waitFor({ timeout: 15000 });
        assert.equal(server.starts.length, 1);
        assert.equal(server.starts[0].promptPreparation, 'planner');
        assert.equal(server.starts[0].approvePlan, true, 'the start did not send approvePlan: true');
        await card.getByText('Add the QA greeting to the QA project').first().waitFor({ timeout: 5000 });
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await shot(page, `plan-card-${view[0]}-${view[2]}`);
        // The card's own button, named for what it does; no "Allow once" for a plan.
        assert.equal(await card.getByRole('button', { name: 'Allow once' }).count(), 0, 'the plan card still says Allow once');
        await card.getByRole('button', { name: 'Approve the plan', exact: true }).click();
        await page.locator('.code-approval').waitFor({ state: 'detached', timeout: 15000 });
        assert.deepEqual(server.answers, [{ decision: 'approve', approvalId: PLAN_CARD.id }]);
      } finally { await page.close(); }
    });

    await check(`${tag}: declining the plan card ends the task before any code runs`, async () => {
      const server = { starts: [], answers: [], task: null };
      const page = await themedPage(browser, view);
      try {
        await mock(page, server);
        await openCodePanel(page, origin);
        await page.locator('#code-preparation').selectOption('planner');
        await page.locator('#code-prompt').fill('QA-2643 add the greeting');
        await page.getByRole('button', { name: 'Start task', exact: true }).click();
        const card = page.locator('.code-approval');
        await card.waitFor({ timeout: 15000 });
        await card.getByRole('button', { name: 'Decline', exact: true }).click();
        await page.locator('.code-approval').waitFor({ state: 'detached', timeout: 15000 });
        assert.deepEqual(server.answers, [{ decision: 'deny', approvalId: PLAN_CARD.id }]);
      } finally { await page.close(); }
    });

    await check(`${tag}: switching the option off, or using Direct, sends no approvePlan`, async () => {
      const server = { starts: [], answers: [], task: null };
      const page = await themedPage(browser, view);
      try {
        await mock(page, server);
        await openCodePanel(page, origin);
        await page.locator('#code-preparation').selectOption('planner');
        await tick(page).uncheck();
        await page.locator('#code-prompt').fill('QA-2643 add the greeting');
        await page.getByRole('button', { name: 'Start task', exact: true }).click();
        await page.waitForFunction(() => document.body.innerText.includes('One task runs per project at a time.'), null, { timeout: 15000 });
        assert.equal(server.starts.length, 1);
        assert.equal(server.starts[0].promptPreparation, 'planner');
        assert.notEqual(server.starts[0].approvePlan, true, 'approvePlan was sent with the option off');
        assert.equal(await page.locator('.code-approval').count(), 0);
      } finally { await page.close(); }
    });
  }
});
