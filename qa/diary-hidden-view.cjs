// #361: Diary stays mounted (hidden, display:none) behind the chat view so an
// in-progress draft/editor/scroll position survive switching views (see the
// comment above DiaryView's `active` prop). Before the fix that meant every
// chat page load fired ~10 requests to the synthetic /api/diary/* backend
// even though Diary was never opened. This drives the real built app against
// the synthetic diary-fixture.cjs (no real Diary, no real corpus) and proves:
//   1. With Diary enabled and the chat view active, zero /api/diary/* requests
//      are made (covering both the initial mount and the storage-status poll
//      that used to start immediately).
//   2. Switching to Diary loads normally and does issue /api/diary/* requests.
//   3. Switching back to chat stops the storage-status poll again — proving
//      "paused", not just "fetch once on first mount".
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { navClick } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');

(async () => {
  const fixture = createFixture(31424);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const diaryRequests = [];
    page.on('request', (req) => {
      const pathname = new URL(req.url()).pathname;
      if (pathname.startsWith('/api/diary/')) diaryRequests.push(pathname);
    });

    await page.goto('http://localhost:31424');
    // Land on chat (the app's default view) with Diary enabled, and give the
    // hidden Diary mount long enough to have fired its old storage-status
    // poll (every 3s) and recovery poll (every 5s) at least once.
    await page.getByRole('textbox', { name: /message/i }).waitFor();
    await page.waitForTimeout(4000);
    assert.deepEqual(diaryRequests, [], `chat view active: expected zero /api/diary/* requests, got ${JSON.stringify(diaryRequests)}`);

    // Activating Diary loads normally and does talk to the diary backend.
    await navClick(page, 'Diary');
    await page.getByRole('heading', { name: 'Diary', exact: true }).waitFor().catch(() => {});
    await page.locator('#diary-draft').waitFor();
    await page.waitForTimeout(500);
    assert.ok(diaryRequests.some((p) => p === '/api/diary/source'), 'activating Diary did not fetch /api/diary/source');
    assert.ok(diaryRequests.some((p) => p === '/api/diary/storage-status'), 'activating Diary did not fetch /api/diary/storage-status');

    // Leaving Diary again pauses its polling: no new requests should show up
    // over a window that would have produced several storage-status/recovery
    // polls (3s and 5s intervals) if the effects were still running hidden.
    await page.locator('.new-chat-btn').click();
    await page.getByRole('textbox', { name: /message/i }).waitFor();
    const countAtDeactivation = diaryRequests.length;
    await page.waitForTimeout(4000);
    assert.equal(diaryRequests.length, countAtDeactivation, `switching back to chat should stop diary polling, but ${diaryRequests.length - countAtDeactivation} more request(s) arrived: ${JSON.stringify(diaryRequests.slice(countAtDeactivation))}`);

    console.log('Diary view: zero requests while hidden behind chat, loads on activation, pauses again on deactivation.');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
