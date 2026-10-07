// #789, #790, #792 in a real browser against the built client. Synthetic APIs only: the isolated
// diary-fixture serves the build and the shell's baseline calls; page.route supplies two free chats,
// their per-chat contexts, a held upload, the tool catalogue and the approval endpoint.
//
//   #789 Upload a file in free chat A, open free chat B before it finishes. B's composer is usable
//        at once, A's finishing upload leaves B's context (model label, next upload target) alone.
//   #790 Open the tool catalogue in chat A, switch to chat B, tick a box there, send: the /api/chat
//        body carries that box as turnToolboxes.
//   #792 Allow once on a pending write: all three actions stay disabled with a "sent" note until the
//        result arrives; a failed decision re-enables them with the error.
//
// FAILS on origin/main (f01dff0f), PASSES with the fix.
// Run: npm run build -- --outDir /tmp/<name>-dist, then
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Brave or Chrome binary> QA_DIST=/tmp/<name>-dist \
//   node qa/chat-switch-789-790-792.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { openToolCatalogue } = require('./nav.cjs');

const PORT = 31789, ORIGIN = `http://localhost:${PORT}`;
const USER = 'synthetic-diary-only';
const now = Date.now();
const FREE_CHATS = [
  { id: 'free-a', title: 'Synthetic chat A', updatedAt: now - 1000, projectId: null },
  { id: 'free-b', title: 'Synthetic chat B', updatedAt: now - 2000, projectId: null },
];
const context = (id) => ({
  id: `ctx-${id}`, name: `Context ${id}`, model: `synthetic-model-${id.slice(-1)}`, provider: 'default', routing: 'manual',
  files: [], assets: [], toolboxes: ['core'], chats: [],
});
const PERMITTED = {
  mode: 'chat',
  boxes: [{
    id: 'web-search', label: 'Web search', description: 'Synthetic search box', source: 'builtin', state: 'available',
    reason: null, active: false, tools: [{ name: 'web_search', description: 'Synthetic search', write: false, permission: 'allowed', reason: null }],
  }],
};

async function openPage(browser, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: FREE_CHATS } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: r.request().method() === 'GET' ? { history: [] } : { ok: true, revision: 'r1' } }));
  await page.route('**/api/chats/*/context', (r) => {
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
    return r.fulfill({ json: { project: context(id) } });
  });
  if (setup) await setup(page);
  await page.goto(`${ORIGIN}/c/free-a`);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  return { ctx, page, errors };
}

// The composer's model control names the chat's own context model (MiddleTruncate may split it).
const modelLabel = (page) => page.locator('.chat-workspace .composer button.composer-model').first().evaluate((el) => el.textContent.replace(/\s+/g, ''));
const waitModel = (page, model) => page.waitForFunction((m) => document.querySelector('.chat-workspace .composer button.composer-model')?.textContent?.replace(/\s+/g, '').includes(m), model);
const openChat = (page, title) => page.getByRole('button', { name: title, exact: true }).first().click();

async function case789(browser) {
  const uploads = [];
  let releaseA;
  const held = new Promise((r) => { releaseA = r; });
  const { ctx, page, errors } = await openPage(browser, async (p) => {
    await p.route('**/api/projects/*/upload*', async (r) => {
      const project = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
      uploads.push(project);
      if (project === 'ctx-free-a') await held;
      return r.fulfill({ json: { poll: `/api/qa-poll/${project}` } });
    });
    await p.route('**/api/qa-poll/*', (r) => r.fulfill({ json: { done: true, status: 200, body: { name: 'synthetic.txt', path: 'synthetic.txt', bytes: 9 } } }));
  });
  try {
    await waitModel(page, 'synthetic-model-a');
    await page.locator('.chat-workspace .chat-composer-inner .composer-actions input[type=file]').setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
    await page.waitForFunction(() => document.querySelector('.chat-workspace .composer textarea')?.disabled === true);
    await openChat(page, 'Synthetic chat B');
    await waitModel(page, 'synthetic-model-b');
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    // B is not the chat uploading: its composer must not stay locked by A's upload.
    await page.waitForTimeout(300);
    assert.equal(await box.isDisabled(), false, "#789: chat B's composer stays disabled by chat A's upload");
    releaseA();
    await page.waitForTimeout(800);
    const label = await modelLabel(page);
    assert.ok(label.includes('synthetic-model-b'), `#789: chat B now shows another chat's context (model control reads ${label})`);
    // A file attached in B goes to B's own context.
    await page.locator('.chat-workspace .chat-composer-inner .composer-actions input[type=file]').setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
    await page.waitForFunction(() => document.querySelector('.chat-workspace .composer textarea')?.disabled === false);
    await page.waitForTimeout(300);
    assert.deepEqual(uploads, ['ctx-free-a', 'ctx-free-b'], `#789: uploads went to ${uploads.join(', ')}`);
    assert.deepEqual(errors, []);
    console.log('PASS #789: an upload in chat A neither locks nor rebinds chat B after a switch');
  } finally { releaseA(); await ctx.close(); }
}

// #789 follow-up: uploads in A and in B at the same time each keep their own chat locked.
async function case789Overlap(browser) {
  const release = {};
  const { ctx, page, errors } = await openPage(browser, async (p) => {
    await p.route('**/api/projects/*/upload*', async (r) => {
      const project = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
      await new Promise((res) => { release[project] = res; });
      return r.fulfill({ json: { poll: `/api/qa-poll/${project}` } });
    });
    await p.route('**/api/qa-poll/*', (r) => r.fulfill({ json: { done: true, status: 200, body: { name: 'synthetic.txt', path: 'synthetic.txt', bytes: 9 } } }));
  });
  const file = { name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') };
  const disabled = () => page.evaluate(() => document.querySelector('.chat-workspace .composer textarea')?.disabled);
  try {
    await waitModel(page, 'synthetic-model-a');
    await page.locator('.chat-workspace .chat-composer-inner .composer-actions input[type=file]').setInputFiles(file);
    await page.waitForFunction(() => document.querySelector('.chat-workspace .composer textarea')?.disabled === true);
    await openChat(page, 'Synthetic chat B');
    await waitModel(page, 'synthetic-model-b');
    await page.locator('.chat-workspace .chat-composer-inner .composer-actions input[type=file]').setInputFiles(file);
    await page.waitForFunction(() => document.querySelector('.chat-workspace .composer textarea')?.disabled === true);
    await openChat(page, 'Synthetic chat A');
    await waitModel(page, 'synthetic-model-a');
    await page.waitForTimeout(200);
    assert.equal(await disabled(), true, "#789: chat A was unlocked by chat B's upload while its own still runs");
    release['ctx-free-b']?.();
    await page.waitForTimeout(500);
    assert.equal(await disabled(), true, "#789: chat B's upload finishing unlocked chat A");
    release['ctx-free-a']?.();
    await page.waitForFunction(() => document.querySelector('.chat-workspace .composer textarea')?.disabled === false);
    assert.deepEqual(errors, []);
    console.log('PASS #789: overlapping uploads in two chats each keep their own chat locked until they finish');
  } finally { for (const r of Object.values(release)) r(); await ctx.close(); }
}

async function case790(browser, fixture) {
  const { ctx, page, errors } = await openPage(browser, async (p) => {
    await p.route('**/api/toolboxes/permitted*', (r) => r.fulfill({ json: PERMITTED }));
  });
  try {
    await openToolCatalogue(page);
    await page.getByRole('listbox', { name: 'Tools' }).waitFor();
    await page.keyboard.press('Escape');
    await openChat(page, 'Synthetic chat B');
    await waitModel(page, 'synthetic-model-b');
    await openToolCatalogue(page);
    await page.getByRole('option', { name: /Web search/ }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /1 for (the next )?message/i }).first().waitFor().catch(() => {});
    const before = fixture.requests.length;
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.fill('synthetic turn with a box');
    await box.press('Enter');
    for (let i = 0; i < 60 && fixture.requests.length === before; i++) await page.waitForTimeout(50);
    const sent = fixture.requests.at(-1);
    assert.ok(sent && sent.body.chatId === 'free-b', 'the turn was sent from chat B');
    assert.deepEqual(sent.body.turnToolboxes, ['web-search'], `#790: turnToolboxes was ${JSON.stringify(sent.body.turnToolboxes)}`);
    assert.deepEqual(errors, []);
    console.log('PASS #790: a box ticked for this message after a chat switch reaches /api/chat');
  } finally { await ctx.close(); }
}

async function case792(browser) {
  let status = 200;
  const posts = [];
  const { ctx, page, errors } = await openPage(browser, async (p) => {
    await p.route('**/api/tool-approvals/*', async (r) => {
      posts.push(r.request().postDataJSON());
      await new Promise((res) => setTimeout(res, 150));
      return status === 200 ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status, json: { error: 'Synthetic approval failure' } });
    });
  });
  try {
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    // Error path first: a failed decision leaves the three actions answerable.
    status = 409;
    await box.fill('pending write synthetic');
    await box.press('Enter');
    const allow = page.getByRole('button', { name: 'Allow once', exact: true });
    const decline = page.getByRole('button', { name: 'Decline', exact: true });
    const allowChat = page.getByRole('button', { name: 'Allow for this chat', exact: true });
    await allow.waitFor();
    await allow.click();
    await page.getByText('Synthetic approval failure').waitFor();
    for (const b of [allow, decline, allowChat]) assert.equal(await b.isEnabled(), true, '#792: a failed decision must re-enable every action');
    // Success: the card stays pending until the tool result, and must not be answerable again.
    status = 200;
    await allow.click();
    await page.waitForTimeout(600);
    for (const b of [allow, decline, allowChat]) assert.equal(await b.isDisabled(), true, '#792: an action re-enabled after a successful decision');
    assert.equal(await page.locator('.tool-approval [role=status]').innerText().catch(() => ''), 'Decision sent. Waiting for the result…', '#792: no sent state shown');
    assert.equal(await page.locator('.tool-approval-err').count(), 0, 'the earlier error is cleared');
    assert.deepEqual(posts.map((b) => b.decision), ['approve', 'approve']);
    // Switching to another chat and back remounts the card while the tool still runs: still decided.
    await openChat(page, 'Synthetic chat B');
    await waitModel(page, 'synthetic-model-b');
    assert.equal(await allow.count(), 0, 'chat B shows no approval card');
    // A is still replying (waiting on the tool), so its row's name carries a live suffix.
    await page.getByRole('button', { name: /^Synthetic chat A\b/ }).first().click();
    await allow.waitFor();
    for (const b of [allow, decline, allowChat]) assert.equal(await b.isDisabled(), true, '#792: an action re-enabled after switching chats and back');
    assert.equal(await page.getByTestId('tool-approval-sent').count(), 1, '#792: the sent note is gone after switching back');
    assert.equal(posts.length, 2, 'no further decision was posted');
    assert.deepEqual(errors, []);
    console.log('PASS #792: after a successful decision all three actions stay disabled with a sent note (also after switching chats and back); an error re-enables them');
  } finally { await ctx.close(); }
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const failures = [];
  try {
    for (const [name, run] of [['#789', case789], ['#789 overlap', case789Overlap], ['#790', case790], ['#792', case792]]) {
      try { await run(browser, fixture); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
    }
  } finally { await browser.close(); await fixture.close(); }
  if (failures.length) { console.error(`FAILED: ${failures.join(', ')}`); process.exitCode = 1; }
  else console.log(`PASS chat switch QA (user ${USER}): #789, #790, #792`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
