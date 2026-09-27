// #456 / #457 / #459 — real-page-load proof (synthetic APIs only; no inference/storage/Diary
// corpus network calls, and no real Diary prompts or corpus anywhere in this file). Same
// createFixture + page.route technique as qa/profile-features-dedup.cjs (#422/#425): drive a
// real headless Chrome page against a synthetic fixture and count actual network requests.
//
// Three independent scenarios, each a fresh navigation (`page.goto`, not an in-app click) the
// way every issue's repro describes:
//
//   #456 — /diary: DiaryView's "overview" effect and its separate "files" effect both call
//     listFiles('') for the Diary root on the same mount. Expect exactly one
//     `GET /api/diary/files?path=` (plus one each for the two subfolders it also lists), then a
//     sent diary message (a write) must still produce a fresh listing read, not a cached stale one.
//
//   #457 — /c/<chatId>: opening an existing chat's history flips `messages.length` from 0 to N a
//     moment after mount (a separate history fetch resolving), which used to be in this effect's
//     dependency array and re-triggered it. Expect exactly one
//     `GET /api/chats/<id>/context-window` on open, then a sent reply (streaming true -> false)
//     must still produce exactly one more.
//
//   #459 — /archived: `App`'s own `refreshProjects()` and `ArchivedChatsView`'s own `load()` each
//     independently call `fetchWorkspace()` on the same mount. Expect exactly one
//     `GET /api/workspace`, then restoring a chat (a mutation) must still produce a fresh read,
//     not the cached pre-restore list.
//
// Usage:
//   QA_DIST=/tmp/some-dist QA_PORT=31487 \
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/dup-fetches-456-457-459.cjs
// Exits non-zero on the first scenario whose counts are wrong, printing every request seen.
const os = require('node:os');
const fs = require('node:fs');
const width = Number(process.env.QA_WIDTH || 1440);
const theme = process.env.QA_THEME || 'light';
const shots = process.env.QA_SHOTS || '/tmp/noevia-456-shots';
fs.mkdirSync(shots, { recursive: true });
async function screenshot(page, name) { await page.screenshot({ path: `${shots}/${name}-${width}-${theme}.png`, fullPage: true }); }
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const PORT = Number(process.env.QA_PORT || 31487);
const origin = `http://localhost:${PORT}`;

async function scenario456(browser) {
  const page = await browser.newPage(withLocale({ viewport: { width, height: 900 }, colorScheme: theme }));
  page.setDefaultTimeout(8000);
  const seen = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname === '/api/diary/files') seen.push(u.search);
  });
  // Root has two matching subfolders (AI Memory, Raw Sources), the same shape the overview
  // effect's own `memoryFolders` scan expects, so it also lists each of them once.
  const rootFiles = [
    { path: 'AI Memory', name: 'AI Memory', isDir: true },
    { path: 'Raw Sources', name: 'Raw Sources', isDir: true },
    { path: 'MEMORY.md', name: 'MEMORY.md', isDir: false },
  ];
  await page.route(/\/api\/diary\/files\?/, (route) => {
    const u = new URL(route.request().url());
    const p = u.searchParams.get('path') || '';
    const files = p === '' ? rootFiles
      : p === 'AI Memory' ? [{ path: 'AI Memory/note.md', name: 'note.md', isDir: false }]
      : p === 'Raw Sources' ? [{ path: 'Raw Sources/source.md', name: 'source.md', isDir: false }]
      : [];
    route.fulfill({ json: { files } });
  });

  try {
    await page.goto(`${origin}/diary`);
    await page.locator('#diary-draft').waitFor();
    await page.waitForTimeout(700);
    const initial = {
      root: seen.filter((s) => s === '?path=').length,
      memory: seen.filter((s) => s === '?path=AI%20Memory').length,
      sources: seen.filter((s) => s === '?path=Raw%20Sources').length,
    };

    await screenshot(page, 'diary');

    // A real send (no local folder connected, so this is the ordinary server-side write path —
    // DiaryView.tsx's `bumpRevision()` runs unconditionally once the stream completes, whatever
    // the diary decision) must still be reflected — the cache must never keep serving the
    // pre-send root listing.
    await page.locator('#diary-draft').fill('synthetic dedup qa entry');
    await page.getByRole('button', { name: 'Send diary message' }).click();
    await page.getByText('Synthetic streamed reply', { exact: true }).waitFor();
    await page.waitForTimeout(400);
    const afterWrite = { root: seen.filter((s) => s === '?path=').length };

    return { ...initial, rootAfterWrite: afterWrite.root, seen: [...seen] };
  } finally {
    await page.close();
  }
}

async function scenario457(browser) {
  const page = await browser.newPage(withLocale({ viewport: { width, height: 900 }, colorScheme: theme }));
  page.setDefaultTimeout(8000);
  const chatId = 'ctx-qa-1';
  const seen = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname === `/api/chats/${chatId}/context-window`) seen.push(1);
  });
  const user = { id: 'synthetic-dedup-qa', username: 'dedupqa', displayName: 'Synthetic Dedup QA', role: 'member', diaryEnabled: false, onboarded: true };
  await page.route(/\/api\/(auth\/session|profile)$/, (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: [{ id: chatId, title: 'Synthetic context chat', updatedAt: 1000, archived: false }] } }));
  await page.route(`**/api/chats/${chatId}/history`, (r) => r.fulfill({ json: {
    history: [{ role: 'user', content: 'Synthetic first turn' }, { role: 'assistant', content: 'Synthetic first reply' }],
    revision: 'r1',
  } }));
  await page.route(`**/api/chats/${chatId}/context-window`, (r) => r.fulfill({ json: { meter: {
    historyCount: 2, model: 'synthetic-model', limit: 8192, limitSource: 'model', used: 200, reserve: 512, safety: 256, threshold: 6000,
    parts: [{ name: 'System', tokens: 50 }, { name: 'History', tokens: 150 }], compactedAt: null, covered: 0,
  } } }));

  try {
    await page.goto(`${origin}/c/${chatId}`);
    // Waits for the history fetch to resolve and render — this is the exact 0-to-N `messages`
    // transition #457 identified as the second, unwanted trigger.
    await page.getByText('Synthetic first reply', { exact: true }).waitFor();
    await page.waitForTimeout(600);
    const initial = seen.length;
    await screenshot(page, 'chat');

    // A real reply (streaming true -> false) must still produce a fresh read.
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('second message synthetic');
    await page.keyboard.press('Enter');
    await page.getByText('Synthetic streamed reply', { exact: true }).waitFor();
    await page.waitForTimeout(400);

    return { onOpen: initial, afterReply: seen.length };
  } finally {
    await page.close();
  }
}

async function scenario459(browser) {
  const page = await browser.newPage(withLocale({ viewport: { width, height: 900 }, colorScheme: theme }));
  page.setDefaultTimeout(8000);
  const seen = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname === '/api/workspace') seen.push(1);
  });
  let freeChats = [{ id: 'a1', title: 'Synthetic archived chat', updatedAt: 1000, archived: true }];
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/freechats', async (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON();
      freeChats = body.chats;
      return r.fulfill({ json: { ok: true } });
    }
    return r.continue();
  });

  try {
    await page.goto(`${origin}/archived`);
    await page.getByRole('heading', { name: 'Archived chats', exact: true }).waitFor();
    await page.waitForTimeout(600);
    const initial = seen.length;
    await screenshot(page, 'archived');

    // A real mutation (restoring a chat) must still produce a fresh read, not the stale
    // pre-restore cached list.
    await page.getByRole('button', { name: 'Restore Synthetic archived chat' }).click();
    await page.getByText('No archived chats.', { exact: false }).waitFor();
    await page.waitForTimeout(400);

    return { onLoad: initial, afterRestore: seen.length };
  } finally {
    await page.close();
  }
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const results = {};
  const failures = [];
  try {
    results.r456 = await scenario456(browser);
    results.r457 = await scenario457(browser);
    results.r459 = await scenario459(browser);
  } finally {
    await browser.close();
    await fixture.close?.();
  }

  console.log('dup-fetches-456-457-459:', JSON.stringify(results));

  if (results.r456.root !== 1) failures.push(`#456 expected exactly 1 GET /api/diary/files?path= on Diary root load, saw ${results.r456.root} (all: ${JSON.stringify(results.r456.seen)})`);
  if (results.r456.memory !== 1) failures.push(`#456 expected exactly 1 GET /api/diary/files?path=AI%20Memory, saw ${results.r456.memory}`);
  if (results.r456.sources !== 1) failures.push(`#456 expected exactly 1 GET /api/diary/files?path=Raw%20Sources, saw ${results.r456.sources}`);
  if (results.r456.rootAfterWrite !== results.r456.root + 1) failures.push(`#456 a saved diary message must still refetch the root listing (was ${results.r456.root}, still ${results.r456.rootAfterWrite} after a write)`);

  if (results.r457.onOpen !== 1) failures.push(`#457 expected exactly 1 GET /api/chats/<id>/context-window on opening a chat with history, saw ${results.r457.onOpen}`);
  if (results.r457.afterReply !== results.r457.onOpen + 1) failures.push(`#457 a finished reply must still refetch the context window (was ${results.r457.onOpen}, still ${results.r457.afterReply} after a reply)`);

  if (results.r459.onLoad !== 1) failures.push(`#459 expected exactly 1 GET /api/workspace on loading /archived, saw ${results.r459.onLoad}`);
  if (results.r459.afterRestore !== results.r459.onLoad + 1) failures.push(`#459 restoring a chat must still refetch the workspace (was ${results.r459.onLoad}, still ${results.r459.afterRestore} after a restore)`);

  if (failures.length) {
    console.log('dup-fetches-456-457-459: FAIL');
    for (const f of failures) console.log(' -', f);
    process.exitCode = 1;
  } else {
    console.log('dup-fetches-456-457-459: ok — one request per load for all three endpoints, and a mutation on each still refetches');
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
