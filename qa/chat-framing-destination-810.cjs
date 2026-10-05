// Synthetic browser regression for #810: chat framing must never put a chat into a project it
// cannot live in (no Chat mode, or archived). Such a chat is hidden from the sidebar and every send
// is refused. No live account, Diary, model or decision service: the suggest endpoint is stubbed and
// the chat lists live in this script. The stubbed move accepts any known project, like the server
// before the fix, so only the page decides here.
//
//   npm run build -- --outDir /path/outside/sync
//   QA_DIST=/path/outside/sync PLAYWRIGHT_MODULE=/path/to/playwright [CHROME_EXECUTABLE=/path/to/chromium] \
//     node qa/chat-framing-destination-810.cjs
//
// Walks: a suggestion naming an archived project, a Code-only project and a Cowork-only project
// shows no project chip and is not offered in the Edit picker, and auto-accept keeps the chat where
// it is (a free chat, frame saved in place). A suggestion naming a Chat-mode project still shows it and auto-accept still moves there.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const port = 31810;

const project = (id, name, extra = {}) => ({ id, name, goal: '', instructions: '', memories: [], files: [], assets: [], sourceFolders: [], modes: ['chat'], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, chats: [], ...extra });

function backend({ suggestProject, autoAccept = false }) {
  const state = {
    projects: [
      project('p-chat', 'Synthetic chat project'),
      project('p-old', 'Synthetic archived project', { archived: true }),
      project('p-code', 'Synthetic code project', { modes: ['code'] }),
      project('p-cowork', 'Synthetic cowork project', { modes: ['cowork'] }),
    ],
    freeChats: [], histories: {}, suggests: [], moves: [], prefs: { autoAccept },
  };
  const merge = (list, incoming) => {
    const byId = new Map(list.map((c) => [c.id, c]));
    for (const c of incoming) byId.set(c.id, { ...(byId.get(c.id) || {}), ...c });
    return [...byId.values()];
  };
  const install = async (page) => {
    await page.route('**/api/features', (route) => route.fulfill({ json: { flags: { previews: false, chatFraming: true } } }));
    await page.route('**/api/workspace', (route) => route.fulfill({ json: { projects: state.projects, freeChats: state.freeChats } }));
    await page.route('**/api/freechats', (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { chats: state.freeChats } });
      state.freeChats = merge(state.freeChats, route.request().postDataJSON().chats);
      return route.fulfill({ json: { ok: true } });
    });
    await page.route(/\/api\/projects\/[^/]+\/chats$/, (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
      const target = state.projects.find((p) => p.id === id);
      if (!target) return route.fulfill({ status: 404, json: { error: 'no such project' } });
      if (route.request().method() !== 'POST') return route.fulfill({ json: { chats: target.chats } });
      target.chats = merge(target.chats, route.request().postDataJSON().chats);
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
      const meta = [...state.freeChats, ...state.projects.flatMap((p) => p.chats)].find((c) => c.id === id);
      const target = body.projectId === null ? null : state.projects.find((p) => p.id === body.projectId);
      if (!meta || (body.projectId !== null && !target)) return route.fulfill({ status: 404, json: { error: 'no such chat or project' } });
      state.freeChats = state.freeChats.filter((c) => c.id !== id);
      for (const p of state.projects) p.chats = p.chats.filter((c) => c.id !== id);
      const next = { ...meta, ...('frame' in body ? { frame: body.frame } : {}) };
      if (target) target.chats = [next, ...target.chats]; else state.freeChats = [next, ...state.freeChats];
      return route.fulfill({ json: { ok: true, from: null, projectId: body.projectId } });
    });
    await page.route('**/api/chat-framing/suggest', async (route) => {
      state.suggests.push(route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 300));
      return route.fulfill({ json: { frame: { projectId: suggestProject, kind: 'search', tags: ['synthetic'], links: [], confirmed: false, source: 'suggested' }, reason: null } });
    });
    await page.route('**/api/chat-framing/preferences', (route) => route.fulfill({ json: state.prefs }));
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
    for (const [id, name] of [['p-old', 'Synthetic archived project'], ['p-code', 'Synthetic code project'], ['p-cowork', 'Synthetic cowork project']]) {
      // The confirm row: no chip for a project the chat cannot live in.
      {
        const b = backend({ suggestProject: id });
        const page = await open(b);
        await send(page, `Synthetic message for ${id}`);
        const row = page.getByRole('group', { name: 'Suggested frame' });
        await row.waitFor({ timeout: 5000 });
        await row.getByText('#synthetic', { exact: true }).waitFor();
        assert.equal(await row.getByText(name, { exact: true }).count(), 0, `${id}: no project chip`);
        // The Edit picker offers only projects a chat can live in.
        await row.getByRole('button', { name: 'Edit frame' }).click();
        const options = await row.locator('select option').allTextContents();
        assert.ok(options.includes('Synthetic chat project'), `${id}: picker offers the Chat-mode project`);
        for (const hidden of ['Synthetic archived project', 'Synthetic code project', 'Synthetic cowork project']) assert.ok(!options.includes(hidden), `${id}: picker hides ${hidden}`);
        await row.getByRole('button', { name: 'Edit frame' }).click();
        await row.getByRole('button', { name: 'Accept frame' }).click();
        await row.waitFor({ state: 'detached', timeout: 5000 });
        assert.equal(b.state.moves.length, 1);
        assert.equal(b.state.moves[0].projectId, null, `${id}: accepting keeps the chat where it is`);
        assert.equal(b.state.moves[0].frame.projectId, null);
        await page.close();
      }
      // Auto-accept: the chat stays a free chat, visible, and can still be sent to.
      {
        const b = backend({ suggestProject: id, autoAccept: true });
        const page = await open(b);
        await send(page, `Synthetic auto message for ${id}`);
        for (let i = 0; i < 50 && !b.state.moves.length; i++) await page.waitForTimeout(100);
        assert.equal(b.state.moves.length, 1, `${id}: auto-accept saved the frame`);
        assert.equal(b.state.moves[0].projectId, null, `${id}: auto-accept never moves the chat into it`);
        assert.ok(b.state.freeChats.some((c) => c.id === b.state.moves[0].id), `${id}: still a free chat`);
        assert.equal(b.state.projects.find((p) => p.id === id).chats.length, 0);
        await page.close();
      }
    }
    // Control: a Chat-mode project is still suggested and auto-accept still moves the chat into it.
    {
      const b = backend({ suggestProject: 'p-chat', autoAccept: true });
      const page = await open(b);
      await send(page, 'Synthetic message for the chat project');
      await page.locator('.chat-header .crumb-back').filter({ hasText: 'Synthetic chat project' }).waitFor({ timeout: 8000 });
      assert.equal(b.state.moves[0].projectId, 'p-chat');
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('chat-framing-destination-810: PASS');
  } catch (error) {
    console.error('chat-framing-destination-810: FAIL', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await fixture.close?.();
    process.exit(process.exitCode || 0);
  }
})();
