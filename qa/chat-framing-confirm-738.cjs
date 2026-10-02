// Synthetic browser regression for #738 (chat framing, phase 2: the confirm row). No live account,
// Diary, model or decision service: the suggest endpoint is stubbed and the chat lists live in this
// script, so a reload reads back exactly what the page saved.
//
//   npm run build -- --outDir /path/outside/sync
//   QA_DIST=/path/outside/sync PLAYWRIGHT_MODULE=/path/to/playwright [CHROME_EXECUTABLE=/path/to/chromium] \
//     node qa/chat-framing-confirm-738.cjs
//
// Walks: first message -> the reply streams while the suggestion is still pending -> the dashed row
// shows project, kind, tags and "2 related" -> remove one tag -> accept -> the chat is in the project
// with the edited frame -> reload keeps it. Then: dismiss saves nothing, and with the flag off no
// suggestion is asked for.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const port = 31738;

function backend({ flag = true, autoAccept = false } = {}) {
  const state = {
    projects: [{ id: 'p-trip', name: 'Synthetic trip', goal: '', instructions: '', memories: [], files: [], assets: [], sourceFolders: [], modes: ['chat'], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, chats: [] }],
    freeChats: [],
    histories: {},
    suggests: [], moves: [], listSaves: [], prefs: { autoAccept }, prefPuts: [],
  };
  const merge = (list, incoming) => {
    const byId = new Map(list.map((c) => [c.id, c]));
    for (const c of incoming) byId.set(c.id, { ...(byId.get(c.id) || {}), ...c });
    return [...byId.values()];
  };
  const install = async (page) => {
    await page.route('**/api/features', (route) => route.fulfill({ json: { flags: { previews: false, chatFraming: flag } } }));
    await page.route('**/api/workspace', (route) => route.fulfill({ json: { projects: state.projects, freeChats: state.freeChats } }));
    await page.route('**/api/freechats', (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { chats: state.freeChats } });
      const chats = route.request().postDataJSON().chats;
      state.listSaves.push({ list: 'free', chats });
      state.freeChats = merge(state.freeChats, chats);
      return route.fulfill({ json: { ok: true } });
    });
    await page.route('**/api/projects/p-trip/chats', (route) => {
      const project = state.projects[0];
      if (route.request().method() !== 'POST') return route.fulfill({ json: { chats: project.chats } });
      const chats = route.request().postDataJSON().chats;
      state.listSaves.push({ list: 'p-trip', chats });
      project.chats = merge(project.chats, chats);
      return route.fulfill({ json: { ok: true } });
    });
    await page.route(/\/api\/chats\/[^/]+\/history$/, (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
      if (route.request().method() === 'POST') { state.histories[id] = route.request().postDataJSON().history; return route.fulfill({ json: { ok: true, revision: String(state.histories[id].length) } }); }
      const history = state.histories[id] || [];
      return route.fulfill({ json: { history, revision: String(history.length) } });
    });
    await page.route(/\/api\/chats\/[^/]+\/move$/, (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
      const body = route.request().postDataJSON();
      state.moves.push({ id, ...body });
      const all = [...state.freeChats, ...state.projects.flatMap((p) => p.chats)];
      const meta = all.find((c) => c.id === id);
      const target = body.projectId === null ? null : state.projects.find((p) => p.id === body.projectId);
      if (!meta || (body.projectId !== null && !target)) return route.fulfill({ status: 404, json: { error: 'no such chat or project' } });
      state.freeChats = state.freeChats.filter((c) => c.id !== id);
      for (const p of state.projects) p.chats = p.chats.filter((c) => c.id !== id);
      const next = { ...meta, ...('frame' in body ? { frame: body.frame } : {}) };
      if (target) target.chats = [next, ...target.chats]; else state.freeChats = [next, ...state.freeChats];
      return route.fulfill({ json: { ok: true, from: null, projectId: body.projectId } });
    });
    // The suggestion arrives well after the synthetic reply (250 ms): the send must not wait for it.
    await page.route('**/api/chat-framing/suggest', async (route) => {
      state.suggests.push(route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 900));
      return route.fulfill({ json: { frame: { projectId: 'p-trip', kind: 'search', tags: ['flights', 'budget'], links: ['older-a', 'older-b'], confirmed: false, source: 'suggested' }, reason: null } });
    });
    await page.route('**/api/chat-framing/preferences', (route) => {
      if (route.request().method() === 'PUT') { const body = route.request().postDataJSON(); state.prefPuts.push(body); state.prefs = { autoAccept: body.autoAccept === true }; }
      return route.fulfill({ json: state.prefs });
    });
    await page.route('**/api/account/instructions', (route) => route.fulfill({ json: { text: '', style: 'default', advanced: {}, language: '', maxChars: 4000 } }));
  };
  return { state, install };
}

(async () => {
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const errors = [];
  const open = async (b) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' });
    page.on('pageerror', (e) => errors.push(e.message));
    await b.install(page);
    await page.goto(`http://localhost:${port}`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    return page;
  };
  const send = async (page, text) => {
    await page.getByPlaceholder('Message noevia…').fill(text);
    await page.getByPlaceholder('Message noevia…').press('Enter');
  };
  try {
    // 1. Suggest -> edit -> accept -> moved into the project -> survives a reload.
    {
      const b = backend();
      const page = await open(b);
      await send(page, 'Plan a synthetic weekend trip');
      await page.getByText('Synthetic streamed reply').waitFor();
      assert.equal(await page.getByRole('group', { name: 'Suggested frame' }).count(), 0, 'the reply landed before the suggestion: the send did not wait');
      const row = page.getByRole('group', { name: 'Suggested frame' });
      await row.waitFor({ timeout: 5000 });
      assert.equal(b.state.suggests.length, 1);
      assert.equal(b.state.suggests[0].message, 'Plan a synthetic weekend trip');
      const chatId = b.state.suggests[0].chatId;
      assert.ok(chatId, 'the suggestion names the chat');
      for (const text of ['Synthetic trip', 'Search', '#flights', '#budget', '2 related']) await row.getByText(text, { exact: true }).waitFor();
      assert.equal(b.state.moves.length, 0, 'nothing is applied before accept');
      assert.ok(b.state.listSaves.every((s) => s.chats.every((c) => !c.frame)), 'no list save carried a frame before accept');
      assert.equal(await row.evaluate((el) => getComputedStyle(el).borderTopStyle), 'dashed');
      // QA_SCREENSHOTS=<dir> keeps a picture of the row (and of the editor) for review.
      if (process.env.QA_SCREENSHOTS) {
        await page.locator('.transcript').screenshot({ path: require('node:path').join(process.env.QA_SCREENSHOTS, 'frame-row.png') });
        await row.getByRole('button', { name: 'Edit frame' }).click();
        await page.locator('.transcript').screenshot({ path: require('node:path').join(process.env.QA_SCREENSHOTS, 'frame-row-edit.png') });
        await row.getByRole('button', { name: 'Edit frame' }).click();
      }

      await row.getByRole('button', { name: 'Remove tag budget' }).click();
      assert.equal(await row.getByText('#budget', { exact: true }).count(), 0);
      await row.getByRole('button', { name: 'Accept frame' }).click();
      await row.waitFor({ state: 'detached', timeout: 5000 });
      assert.equal(b.state.moves.length, 1);
      assert.deepEqual(b.state.moves[0], { id: chatId, projectId: 'p-trip', frame: { projectId: 'p-trip', kind: 'search', tags: ['flights'], links: ['older-a', 'older-b'], confirmed: true, source: 'user' } });
      assert.ok(b.state.projects[0].chats.some((c) => c.id === chatId), 'the chat is in the project');
      assert.ok(!b.state.freeChats.some((c) => c.id === chatId), 'and no longer a free chat');
      await page.locator('.chat-header .crumb-back').filter({ hasText: 'Synthetic trip' }).waitFor();

      await page.reload();
      await page.getByText('Synthetic streamed reply').waitFor();
      await page.locator('.chat-header .crumb-back').filter({ hasText: 'Synthetic trip' }).waitFor();
      assert.equal(await page.getByRole('group', { name: 'Suggested frame' }).count(), 0, 'an accepted frame is not offered again');
      const saved = b.state.projects[0].chats.find((c) => c.id === chatId);
      assert.deepEqual(saved.frame.tags, ['flights']);
      assert.equal(saved.frame.confirmed, true);
      assert.equal(b.state.suggests.length, 1, 'reopening a chat asks for nothing');
      await page.close();
    }

    // 2. Dismiss hides the row and saves nothing.
    {
      const b = backend();
      const page = await open(b);
      await send(page, 'Another synthetic question');
      const row = page.getByRole('group', { name: 'Suggested frame' });
      await row.waitFor({ timeout: 5000 });
      await row.getByRole('button', { name: 'Dismiss frame' }).click();
      await row.waitFor({ state: 'detached' });
      await page.waitForTimeout(300);
      assert.equal(b.state.moves.length, 0);
      assert.ok(b.state.freeChats.length === 1 && !b.state.freeChats[0].frame, 'the chat stays a free chat without a frame');
      await page.close();
    }

    // 3. Flag off: no suggestion is asked for and no row appears.
    {
      const b = backend({ flag: false });
      const page = await open(b);
      await send(page, 'Synthetic message with framing off');
      await page.getByText('Synthetic streamed reply').waitFor();
      await page.waitForTimeout(1200);
      assert.equal(b.state.suggests.length, 0);
      assert.equal(await page.getByRole('group', { name: 'Suggested frame' }).count(), 0);
      await page.close();
    }
    // 4. Auto-accept on: the suggestion is applied without a click, and the chat lands in the project.
    {
      const b = backend({ autoAccept: true });
      const page = await open(b);
      await send(page, 'Synthetic auto framed message');
      await page.locator('.chat-header .crumb-back').filter({ hasText: 'Synthetic trip' }).waitFor({ timeout: 8000 });
      assert.equal(b.state.moves.length, 1);
      assert.deepEqual(b.state.moves[0].frame.tags, ['flights', 'budget']);
      assert.equal(b.state.moves[0].frame.confirmed, true);
      assert.equal(await page.getByRole('group', { name: 'Suggested frame' }).count(), 0);
      await page.close();
    }

    // 5. Settings: the per-user toggle is off by default and saves when switched.
    {
      const b = backend();
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, reducedMotion: 'reduce' });
      page.on('pageerror', (e) => errors.push(e.message));
      await b.install(page);
      await page.goto(`http://localhost:${port}/settings/personalization`);
      const toggle = page.getByRole('switch', { name: 'Auto-accept chat frames' });
      await toggle.waitFor({ timeout: 10000 });
      assert.equal(await toggle.isChecked(), false);
      await toggle.click();
      await page.getByText('Chat frames are now applied automatically.').waitFor();
      assert.deepEqual(b.state.prefPuts, [{ autoAccept: true }]);
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('chat-framing-confirm-738: PASS');
  } catch (error) {
    console.error('chat-framing-confirm-738: FAIL', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await fixture.close?.();
    process.exit(process.exitCode || 0);
  }
})();
