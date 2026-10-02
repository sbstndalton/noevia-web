// Synthetic browser regression for #741 (chat framing, phase 5: organisation). No live account, Diary,
// model or decision service: the suggest endpoint is stubbed and the chat lists live in this script,
// so what the page saves is exactly what it reads back.
//
//   npm run build -- --outDir /path/outside/sync
//   QA_DIST=/path/outside/sync PLAYWRIGHT_MODULE=/path/to/playwright [CHROME_EXECUTABLE=/path/to/chromium] \
//     node qa/chat-organise-741.cjs
//
// Walks: tag a chat (accept a suggested frame with nested tags) -> the tags show in the sidebar, nested
// like folders -> a tag filters the list -> `[[` in the composer suggests chats by title, Enter links
// one (saved on the frame through the list save) -> the linked chat's header shows the backlink ->
// the graph has the chat and a tag hub, and the hub filters the sidebar. Then, with the flag off, none
// of it appears.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const port = 31741;

function backend({ flag = true } = {}) {
  const state = {
    projects: [{ id: 'p-trip', name: 'Synthetic trip', goal: '', instructions: '', memories: [], files: [], assets: [], sourceFolders: [], modes: ['chat'], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, chats: [] }],
    freeChats: [
      { id: 'older-a', title: 'Synthetic packing list', preview: 'socks', updatedAt: 2000 },
      { id: 'older-b', title: 'Synthetic visa notes', preview: 'forms', updatedAt: 1500 },
    ],
    histories: {}, suggests: [], moves: [], listSaves: [],
  };
  const merge = (list, incoming) => {
    const byId = new Map(list.map((c) => [c.id, c]));
    return incoming.map((c) => ({ ...(byId.get(c.id) || {}), ...c }));
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
      const meta = [...state.freeChats, ...state.projects.flatMap((p) => p.chats)].find((c) => c.id === id);
      const target = body.projectId === null ? null : state.projects.find((p) => p.id === body.projectId);
      if (!meta || (body.projectId !== null && !target)) return route.fulfill({ status: 404, json: { error: 'no such chat or project' } });
      state.freeChats = state.freeChats.filter((c) => c.id !== id);
      for (const p of state.projects) p.chats = p.chats.filter((c) => c.id !== id);
      const next = { ...meta, ...('frame' in body ? { frame: body.frame } : {}) };
      if (target) target.chats = [next, ...target.chats]; else state.freeChats = [next, ...state.freeChats];
      return route.fulfill({ json: { ok: true, from: null, projectId: body.projectId } });
    });
    await page.route('**/api/chat-framing/suggest', (route) => {
      state.suggests.push(route.request().postDataJSON());
      return route.fulfill({ json: { frame: { projectId: 'p-trip', kind: 'search', tags: ['travel/europe', 'budget'], links: ['older-b'], confirmed: false, source: 'suggested' }, reason: null } });
    });
    await page.route('**/api/chat-framing/preferences', (route) => route.fulfill({ json: { autoAccept: false } }));
    await page.route('**/api/account/instructions', (route) => route.fulfill({ json: { text: '', style: 'default', advanced: {}, language: '', maxChars: 4000 } }));
  };
  return { state, install };
}

(async () => {
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const errors = [];
  const open = async (b) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
    page.on('pageerror', (e) => errors.push(e.message));
    await b.install(page);
    await page.goto(`http://localhost:${port}`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    return page;
  };
  const shot = async (page, name, locator) => { if (process.env.QA_SCREENSHOTS) await (locator || page).screenshot({ path: path.join(process.env.QA_SCREENSHOTS, name) }); };
  const sidebarChat = (page, title) => page.locator('#app-navigation .chat-row .nav-item').filter({ hasText: title });
  try {
    {
      const b = backend();
      const page = await open(b);
      const composer = page.getByPlaceholder('Message noevia…');
      // 1. Tag a chat: accept the suggested frame.
      await composer.fill('Plan a synthetic weekend trip');
      await composer.press('Enter');
      await page.getByText('Synthetic streamed reply').waitFor();
      const row = page.getByRole('group', { name: 'Suggested frame' });
      await row.waitFor({ timeout: 5000 });
      const chatId = b.state.suggests[0].chatId;
      await row.getByRole('button', { name: 'Accept frame' }).click();
      await row.waitFor({ state: 'detached', timeout: 5000 });

      // 2. The tags show in the sidebar, nested like folders.
      const nav = page.locator('#app-navigation');
      await nav.getByRole('button', { name: 'Show chats tagged #travel', exact: true }).waitFor({ timeout: 5000 });
      await nav.getByRole('button', { name: 'Show chats tagged #budget', exact: true }).waitFor();
      assert.equal(await nav.getByRole('button', { name: 'Show chats tagged #travel/europe' }).count(), 0, 'nested tags start folded');
      await nav.getByRole('button', { name: 'Show tags under #travel' }).click();
      await nav.getByRole('button', { name: 'Show chats tagged #travel/europe' }).waitFor();
      await shot(page, 'sidebar-tags.png', nav);

      // 3. A tag filters the list through the search box.
      await nav.getByRole('button', { name: 'Show chats tagged #travel/europe' }).click();
      const search = page.getByRole('textbox', { name: 'Search' }).first();
      assert.equal(await search.inputValue(), '#travel/europe');
      await sidebarChat(page, 'Plan a synthetic weekend trip').waitFor();
      assert.equal(await sidebarChat(page, 'Synthetic packing list').count(), 0, 'an untagged chat is filtered out');
      assert.equal(await nav.locator('.proj-row').count(), 0, 'a tag query lists chats only');
      await search.fill('#travel packing');
      await page.waitForTimeout(100);
      assert.equal(await sidebarChat(page, 'Plan a synthetic weekend trip').count(), 0, 'tag and title words both have to match');
      await search.press('Escape');

      // 4. `[[` suggests chats by title; Enter links the first and saves it on the frame.
      await composer.click();
      await composer.pressSequentially('Compare with [[pack');
      const menu = page.getByRole('listbox', { name: 'Chats to link' });
      await menu.waitFor();
      assert.deepEqual(await menu.getByRole('option').allTextContents(), ['Synthetic packing list']);
      await shot(page, 'composer-link-menu.png', page.locator('.composer'));
      await composer.press('Enter');
      await menu.waitFor({ state: 'detached' });
      assert.equal(await composer.inputValue(), 'Compare with [[Synthetic packing list]]', 'Enter chose the link and did not send');
      const deadline = Date.now() + 5000;
      const savedLinks = () => b.state.projects[0].chats.find((c) => c.id === chatId)?.frame?.links || [];
      while (!savedLinks().includes('older-a') && Date.now() < deadline) await page.waitForTimeout(50);
      assert.deepEqual(savedLinks(), ['older-b', 'older-a'], 'the link is added to the frame, the accepted links kept');
      assert.ok(b.state.listSaves.some((s) => s.list === 'p-trip' && s.chats.some((c) => c.id === chatId && c.frame?.links?.includes('older-a'))), 'saved through the project list save');
      const saved = b.state.projects[0].chats.find((c) => c.id === chatId).frame;
      assert.equal(saved.confirmed, true, 'linking keeps the accepted frame as it was');
      assert.deepEqual(saved.tags, ['travel/europe', 'budget']);

      // 5. The linked chat's header shows the backlink.
      await sidebarChat(page, 'Synthetic packing list').click();
      const links = page.getByRole('button', { name: 'Links and backlinks for this chat' });
      await links.waitFor();
      await page.waitForFunction(() => document.querySelector('.chat-links-count')?.textContent === '1');
      await links.click();
      const panel = page.getByRole('region', { name: 'Links' });
      await panel.getByRole('heading', { name: 'Linked from' }).waitFor();
      await panel.locator('.chat-links-list').getByRole('button', { name: 'Plan a synthetic weekend trip' }).waitFor();
      // 6. The graph: this chat and the one linking to it.
      const graph = panel.getByRole('group', { name: 'Chat graph around Synthetic packing list' });
      await graph.getByRole('button', { name: 'Open chat Plan a synthetic weekend trip' }).waitFor();
      await shot(page, 'backlinks-panel.png', page.locator('.chat-workspace'));
      await panel.locator('.chat-links-list').getByRole('button', { name: 'Plan a synthetic weekend trip' }).click();
      await page.getByText('Synthetic streamed reply').waitFor();

      // The source chat's graph: links out plus a hub per tag; a hub filters the sidebar.
      await links.click();
      const ownGraph = page.getByRole('group', { name: 'Chat graph around Plan a synthetic weekend trip' });
      await ownGraph.getByRole('button', { name: 'Open chat Synthetic packing list' }).waitFor();
      await ownGraph.getByRole('button', { name: 'Open chat Synthetic visa notes' }).waitFor();
      await shot(page, 'chat-graph.png', page.getByRole('region', { name: 'Links' }));
      await ownGraph.getByRole('button', { name: 'Show chats tagged #budget' }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Search' }).first().inputValue(), '#budget');
      await sidebarChat(page, 'Plan a synthetic weekend trip').waitFor();
      await page.close();
    }

    // 7. Flag off: no Tags section, no Links control, and `[[` is plain text.
    {
      const b = backend({ flag: false });
      b.state.freeChats[0].frame = { projectId: null, kind: 'idea', tags: ['travel'], links: ['older-b'], confirmed: true, source: 'user' };
      const page = await open(b);
      await sidebarChat(page, 'Synthetic packing list').waitFor();
      assert.equal(await page.locator('#app-navigation .tag-tree').count(), 0);
      await sidebarChat(page, 'Synthetic visa notes').click();
      await page.getByPlaceholder('Message noevia…').pressSequentially('See [[Synth');
      await page.waitForTimeout(300);
      assert.equal(await page.getByRole('listbox', { name: 'Chats to link' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Links and backlinks for this chat' }).count(), 0);
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('chat-organise-741: PASS');
  } catch (error) {
    console.error('chat-organise-741: FAIL', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await fixture.close?.();
    process.exit(process.exitCode || 0);
  }
})();
