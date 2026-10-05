// #849 in a real browser against the built client. Synthetic APIs only (the server's answers are
// mocked as the fixed server sends them: 502 + code storageLoginRejected for an upload, 424 + the same
// code for the Diary file list).
//
//   a. A free-chat upload the server failed with a refused storage login shows the storage-login
//      sentence the refresh toast uses (#770), not "could not create the storage folder; retry".
//   b. The same failure arriving after the person opened another chat is not lost: it is not painted
//      over the chat on screen, and it is there when they return to the chat the file was attached in.
//   c. The Diary tab's file list failing that way shows the sentence, never the class name
//      "DiaryRequestError"; an ordinary failure shows its message without the class name too.
//
// FAILS on origin/main, PASSES with the fix.
// Run: npm run build -- --outDir /tmp/<name>-dist, then
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Brave or Chrome binary> QA_DIST=/tmp/<name>-dist \
//   node qa/storage-login-849.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { navClick } = require('./nav.cjs');

const PORT = 31849, ORIGIN = `http://localhost:${PORT}`;
const now = Date.now();
const FREE_CHATS = [
  { id: 'free-a', title: 'Synthetic chat A', updatedAt: now - 1000, projectId: null },
  { id: 'free-b', title: 'Synthetic chat B', updatedAt: now - 2000, projectId: null },
];
const context = (id) => ({ id: `ctx-${id}`, name: `Context ${id}`, model: `synthetic-model-${id.slice(-1)}`, provider: 'default', routing: 'manual', files: [], assets: [], toolboxes: ['core'], chats: [] });
const SENTENCE = 'Storage login rejected. Check your storage credentials in Settings → Diary & storage.';
const FILE = { name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') };
const input = (page) => page.locator('.chat-workspace .chat-composer-inner .composer-actions input[type=file]');
const status = (page) => page.locator('.chat-workspace .composer-action-status');

async function openChats(browser, upload) {
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
  await page.route('**/api/projects/*/upload*', async (r) => { await upload(r); });
  // The job's answer: what the fixed server sends. The sentence differs from the client's own on purpose,
  // so showing the server's text instead of wording the code fails.
  await page.route('**/api/qa-poll/*', (r) => r.fulfill({ json: { done: true, status: 502, body: { error: 'server-side English sentence', code: 'storageLoginRejected' } } }));
  await page.goto(`${ORIGIN}/c/free-a`);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  return { ctx, page, errors };
}

async function caseA(browser) {
  const { ctx, page, errors } = await openChats(browser, (r) => r.fulfill({ json: { poll: '/api/qa-poll/a' } }));
  try {
    await input(page).setInputFiles(FILE);
    await status(page).filter({ hasText: 'Saved 0/1' }).waitFor({ timeout: 8000 });
    const text = await status(page).innerText();
    assert.ok(text.includes(SENTENCE), `#849 a: the failure does not read as a refused login (shows "${text}")`);
    assert.ok(!/could not create the storage folder/i.test(text), 'still says it could not create the folder');
    assert.deepEqual(errors, []);
    console.log('PASS #849 a: an upload failed by a refused storage login says so, in the refresh toast\'s words');
  } finally { await ctx.close(); }
}

async function caseB(browser) {
  let release;
  const held = new Promise((r) => { release = r; });
  const { ctx, page, errors } = await openChats(browser, async (r) => { await held; return r.fulfill({ json: { poll: '/api/qa-poll/a' } }); });
  try {
    await input(page).setInputFiles(FILE);
    await page.waitForFunction(() => document.querySelector('.chat-workspace .composer textarea')?.disabled === true);
    await page.getByRole('button', { name: 'Synthetic chat B', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('.chat-workspace .composer textarea')?.disabled === false);
    release();
    await page.waitForTimeout(1500);
    assert.equal(await status(page).count(), 0, "chat A's failure is painted over chat B");
    await page.getByRole('button', { name: /^Synthetic chat A\b/ }).first().click();
    await status(page).filter({ hasText: 'Saved 0/1' }).waitFor({ timeout: 5000 }).catch(() => {});
    const text = (await status(page).count()) ? await status(page).innerText() : '';
    assert.ok(text.includes(SENTENCE), `#849 b: returning to chat A shows no failure (status line reads "${text}")`);
    // Seen once, it is cleared when the chat is left again, so an old failure does not linger.
    await page.getByRole('button', { name: 'Synthetic chat B', exact: true }).first().click();
    await page.getByRole('button', { name: /^Synthetic chat A\b/ }).first().click();
    await page.waitForTimeout(300);
    assert.equal(await status(page).count(), 0, 'the failure lingers after it was shown and the chat left');
    assert.deepEqual(errors, []);
    console.log('PASS #849 b: a failure that lands after switching chats waits under its own chat and shows on return');
  } finally { release(); await ctx.close(); }
}

async function caseC(browser) {
  for (const [label, reply, expect] of [
    ['refused login', { status: 424, json: { error: 'Storage login rejected. Check your storage credentials in Settings → Diary & storage.', code: 'storageLoginRejected' } }, SENTENCE],
    ['ordinary failure', { status: 500, json: { error: 'Diary storage request failed' } }, 'Diary storage request failed'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.route('**/api/diary/files*', (r) => r.fulfill(reply));
      await page.goto(ORIGIN);
      await navClick(page, 'Diary');
      await page.getByText(expect).first().waitFor({ timeout: 8000 });
      const alerts = await page.locator('[role=alert]').allInnerTexts();
      assert.ok(alerts.some((a) => a.includes(expect)), `#849 c (${label}): no alert shows "${expect}" (alerts: ${JSON.stringify(alerts)})`);
      assert.ok(!alerts.some((a) => /DiaryRequestError/.test(a)), `#849 c (${label}): an alert shows the class name (${JSON.stringify(alerts)})`);
      console.log(`PASS #849 c: Diary file list, ${label}, shows the sentence without the class name`);
    } finally { await ctx.close(); }
  }
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const failures = [];
  try {
    for (const [name, run] of [['#849 a', caseA], ['#849 b', caseB], ['#849 c', caseC]]) {
      try { await run(browser); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
    }
  } finally { await browser.close(); await fixture.close(); }
  if (failures.length) { console.error(`FAILED: ${failures.join(', ')}`); process.exitCode = 1; }
  else console.log('PASS #849 QA');
})().catch((e) => { console.error(e); process.exitCode = 1; });
