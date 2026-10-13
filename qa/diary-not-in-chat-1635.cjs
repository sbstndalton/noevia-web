// #1635: after sending a message in a new chat, a live tester's page-text read showed the Diary panel
// (calendar, "Diary companion", "Diary storage") and no chat thread, while the address stayed on the
// chat. Nobody had clicked Diary. Cause: App.tsx kept the whole Diary panel mounted in the document
// behind every view (display:none). A display:none element's innerText is its full textContent, so
// any reader that picks "the longest <main>" (the browser assistant's page-text tool, reader modes,
// translation and other extensions) took the hidden Diary over a short chat. The Diary's private
// content was in every chat page's DOM. A second sighting hit an archived project's page the same way: a
// short project page (or none yet, while the chat list loads) loses to the hidden Diary's "Loading entries…".
//
// Drives the built app against the synthetic diary-fixture.cjs (no real Diary, no real corpus):
//   1. New chat -> type -> Enter; the reply finishes (SSE done), the chat list refreshes, the window
//      regains focus and visibility. The chat thread stays in view, the address stays on the chat,
//      the Diary panel never mounts and makes no /api/diary/* request, and a "longest main" page-text
//      read returns the chat, not the Diary.
//   2. Diary opened by a deliberate click shows; leaving it takes its panel out of the document (no
//      hidden copy behind the chat) while its draft survives the round trip.
//   3. An archived project's page, by address while the chat list loads and from Projects -> Archived,
//      has no Diary in its document either.
// Screenshots go to QA_SCREENSHOTS (default /tmp/noevia-shots), never into the repo.
// Run: npm run build && PLAYWRIGHT_MODULE=<path to playwright> node qa/diary-not-in-chat-1635.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31635;
const out = process.env.QA_SCREENSHOTS || '/tmp/noevia-shots';
const QUESTION = 'QA 1635 synthetic question';

// The selection rule of a common "read the page text" tool: the first selector that matches wins, and
// among its matches the element with the longest innerText. This is the rule that picked the Diary.
const pageText = (page) => page.evaluate(() => {
  const selectors = ['article', 'main', '[class*="articleBody"]', '[class*="article-body"]', '[class*="post-content"]', '[class*="entry-content"]', '[class*="content-body"]', '[role="main"]', '.content', '#content'];
  let picked = null;
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (!found.length) continue;
    let best = found[0], len = 0;
    found.forEach((el) => { const n = el.innerText?.length || 0; if (n > len) { len = n; best = el; } });
    picked = best; break;
  }
  picked ??= document.body;
  return { className: picked.className || picked.tagName, inDiary: !!picked.closest('.diary-mount, .diary-workspace'), text: picked.innerText || '' };
});

// Every trace of the Diary panel in the document, visible or not.
const diaryInDom = (page) => page.evaluate(() => document.querySelectorAll('.diary-mount, .diary-workspace, #diary-draft').length);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1280, height: 800 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const diaryRequests = [];
    page.on('request', (req) => { const p = new URL(req.url()).pathname; if (p.startsWith('/api/diary/')) diaryRequests.push(p); });
    // A chat list with a little history, so the new chat is the short one on the page.
    await page.route('**/api/workspace', (r) => { r.fulfill({ json: { projects: [], freeChats: [{ id: 'c-older', title: 'Synthetic older chat', updatedAt: 1, preview: '' }] } }); });

    await page.goto(`http://localhost:${PORT}/`);
    const composer = page.getByPlaceholder('Message noevia…');
    await composer.waitFor();
    // Sidebar New chat -> type -> Enter, as the tester did.
    await page.locator('.new-chat-btn').first().click();
    await composer.click();
    await composer.fill(QUESTION);
    await composer.press('Enter');
    await page.getByText('Synthetic streamed reply').waitFor();
    await page.waitForFunction(() => /^\/c\/c-/.test(location.pathname));
    const chatPath = await page.evaluate(() => location.pathname);

    // Drive what arrives around the end of a reply: the chat list refresh, a focus and visibility
    // round trip (tab switch), and time for the idle prefetch of the lazy views.
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
    await page.waitForTimeout(3500);

    check(await page.evaluate(() => location.pathname) === chatPath, `address left the chat: ${await page.evaluate(() => location.pathname)}`);
    check(await page.locator('main.chat-workspace').isVisible(), 'the chat thread is not in view');
    check(await page.locator('main.chat-workspace').getByText(QUESTION).isVisible(), 'the sent message is not visible');
    const traces = await diaryInDom(page);
    check(traces === 0, `the Diary panel is in the document behind the chat (${traces} element(s)) although Diary was never opened`);
    check(diaryRequests.length === 0, `Diary never opened, yet /api/diary/* was requested: ${JSON.stringify(diaryRequests)}`);
    const read = await pageText(page);
    check(!read.inDiary && read.text.includes(QUESTION), `page-text read picked ${read.className} (inDiary=${read.inDiary}), not the chat thread`);
    await page.screenshot({ path: `${out}/1635-chat-after-send.png` });

    // A deliberate click opens the Diary; it shows and gets the address.
    await page.locator('.side-footer-row').getByRole('button', { name: 'Diary', exact: true }).click();
    await page.locator('#diary-draft').waitFor();
    check(await page.evaluate(() => location.pathname) === '/diary', 'clicking Diary did not move the address to /diary');
    check(await page.locator('.diary-mount').evaluate((el) => getComputedStyle(el).display !== 'none'), 'the Diary is not showing after the click');
    await page.locator('#diary-draft').fill('Synthetic unsent draft 1635');
    await page.screenshot({ path: `${out}/1635-diary-opened.png` });

    // Leaving it: the chat is back and the Diary panel is out of the document, not hidden behind it.
    await page.goBack();
    await page.waitForFunction((p) => location.pathname === p, chatPath);
    await page.locator('main.chat-workspace').getByText(QUESTION).waitFor();
    const after = await diaryInDom(page);
    check(after === 0, `after leaving the Diary, ${after} Diary element(s) stay in the document behind the chat`);
    const readAfter = await pageText(page);
    check(!readAfter.inDiary && readAfter.text.includes(QUESTION), `after leaving the Diary, page-text read picked ${readAfter.className} (inDiary=${readAfter.inDiary})`);
    const bodyText = await page.evaluate(() => document.body.textContent || '');
    check(!bodyText.includes('Synthetic unsent draft 1635'), 'the Diary draft is readable in the chat page');
    await page.screenshot({ path: `${out}/1635-chat-after-diary.png` });

    // Coming back keeps what was being written (the reason the Diary is kept alive).
    await page.goForward();
    await page.locator('#diary-draft').waitFor();
    check(await page.locator('#diary-draft').inputValue() === 'Synthetic unsent draft 1635', 'the Diary draft was lost on the round trip');
    check(errors.length === 0, `page errors: ${errors.join(' | ')}`);

    // The same read on a project page (second live sighting): an archived project opened from Projects ->
    // Archived, first by its address while the chat list is still loading (no project page yet, so the
    // hidden Diary was the only <main>), then from the Archived tab.
    const projectPage = await browser.newPage(withLocale({ viewport: { width: 1280, height: 800 } }));
    const archived = { id: 'proj-archived-1635', name: 'Synthetic archived 1635', goal: '', instructions: '', model: 'synthetic', memories: [], createdAt: 1, sourceFolders: [], modes: ['chat'], pinned: false, archived: true, files: [], assets: [], toolboxes: ['core'], updatedAt: 2, chats: [] };
    let releaseWorkspace;
    const workspaceGate = new Promise((r) => { releaseWorkspace = r; });
    await projectPage.route('**/api/workspace', async (r) => { await workspaceGate; r.fulfill({ json: { projects: [archived], freeChats: [] } }); });
    await projectPage.goto(`http://localhost:${PORT}/p/${archived.id}`);
    await projectPage.locator('.sidebar').first().waitFor();
    await projectPage.waitForTimeout(1500); // the lazy views prefetch while the list is still loading
    const loading = await pageText(projectPage);
    check(!loading.inDiary && (await diaryInDom(projectPage)) === 0, `project page, list loading: the Diary is in the document (page-text read picked ${loading.className})`);
    releaseWorkspace();
    await projectPage.locator('main.project-page').waitFor();
    check((await diaryInDom(projectPage)) === 0, 'archived project page: the Diary is in the document');
    check(!(await pageText(projectPage)).inDiary, 'archived project page: the page-text read picked the Diary');
    await projectPage.locator('.sidebar').getByRole('button', { name: 'Projects', exact: true }).first().click();
    await projectPage.locator('[data-project-tab="archived"]').click();
    await projectPage.getByRole('button', { name: `Open ${archived.name}` }).or(projectPage.locator('.project-card-open')).first().click();
    await projectPage.locator('main.project-page').waitFor();
    await projectPage.waitForTimeout(500);
    check(projectPage.url().endsWith(`/p/${archived.id}`), `the archived project's address is wrong: ${projectPage.url()}`);
    check((await diaryInDom(projectPage)) === 0, 'archived project opened from the Archived tab: the Diary is in the document');
    const projectRead = await pageText(projectPage);
    check(!projectRead.inDiary, `archived project opened from the Archived tab: page-text read picked ${projectRead.className}`);
    await projectPage.screenshot({ path: `${out}/1635-archived-project.png` });
  } finally {
    await browser.close();
    await fixture.close();
  }
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log('#1635: a sent chat and an archived project page stay in view, the Diary never mounts unless clicked, and leaves the document when left (draft kept).');
})().catch((e) => { console.error(e); process.exit(1); });
