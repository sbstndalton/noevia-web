// Live round 2 fixes, in a real browser against a real application server (server/index.cjs) and a
// disposable synthetic upstream standing in for the inference engine. Synthetic data only.
//   #562  Retry after skill_revoked resends the same Skill pin (never a silent switch to Automatic)
//   #563  the composer Skill selector does not float, backgroundless, over transcript text
//   #564  the project home composer has the Skill selector, and the first message carries the pin
//   #566  Code mode hides archived projects (sidebar list and the "Open a project" grid)
// Each scenario reports PASS or FAIL on its own line, and the process exits non-zero if any failed,
// so the same file shows the before (origin/main) and after (this branch) states.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> QA_SCREENSHOTS=<dir> node qa/live-r2-562-567.cjs [562|563|564|566]
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31742, UPSTREAM_PORT = 31743;
const origin = `http://localhost:${PORT}`;
const web = path.resolve(__dirname, '..');
const shots = process.env.QA_SCREENSHOTS || path.join(os.tmpdir(), 'noevia-live-r2-shots');
const only = process.argv[2] || null;

function makeApi(cookies) {
  return async (url, body, method = body === undefined ? 'GET' : 'POST') => {
    const r = await fetch(origin + url, {
      method,
      headers: {
        'Content-Type': 'application/json', Origin: origin,
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'X-CSRF-Token': decodeURIComponent(cookies.get('cowork_csrf') || ''),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const v of r.headers.getSetCookie()) { const p = v.split(';')[0], i = p.indexOf('='); cookies.set(p.slice(0, i), p.slice(i + 1)); }
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

/** A synthetic OpenAI-compatible upstream. A prompt containing SLOWSTREAM streams many small chunks
 *  over several seconds, so a Skill can be disabled while the reply is still running. Every chat
 *  completion request is recorded so a scenario can tell which requests reached the model. */
function startUpstream() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('health')) return res.end(JSON.stringify({ all_models_loaded: [{ loaded: true, model_name: 'synthetic-model', recipe_options: { ctx_size: 8192 } }] }));
    if (req.url.includes('models')) return res.end(JSON.stringify({ data: [{ id: 'synthetic-model' }] }));
    if (!req.url.endsWith('/chat/completions')) return res.end('{}');
    if (!body.stream) return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Synthetic title' } }] }));
    requests.push(body);
    const lastUser = [...(body.messages || [])].reverse().find(m => m.role === 'user');
    res.setHeader('Content-Type', 'text/event-stream');
    if (lastUser && /SLOWSTREAM/.test(lastUser.content || '')) {
      let i = 0;
      const timer = setInterval(() => {
        if (res.writableEnded) return clearInterval(timer);
        if (i >= 40) { clearInterval(timer); return res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); }
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: `${++i}. synthetic line\n` } }] }) + '\n\n');
      }, 150);
      res.on('close', () => clearInterval(timer));
      return;
    }
    setTimeout(() => res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Synthetic completed reply.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'), 100);
  });
  return { requests, server, listen: () => new Promise(r => server.listen(UPSTREAM_PORT, '127.0.0.1', r)), close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

const skillFile = (dir, name, marker) => ({ name: `${dir}/SKILL.md`, content: `---\nname: ${name}\ndescription: Synthetic ${name}\nversion: 1\n---\nEnd every reply with ${marker}.\n` });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-live-r2-'));
  fs.mkdirSync(shots, { recursive: true });
  const upstream = startUpstream(); await upstream.listen();
  const server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: web, stdio: 'ignore',
    env: {
      ...process.env, UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin,
      LEGACY_AUTH_COMPAT: 'false', INFERENCE_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
      MODEL_MANAGER_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`, MODEL_MANAGER_KIND: 'lemonade',
      MCP_SERVERS: '', MCP_SERVER_URL: '', NOEVIA_FEATURE_CODE_HARNESS: 'true', NOEVIA_FEATURE_PREVIEWS: 'true',
    },
  });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const results = [];
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise(r => setTimeout(r, 50)); }
    const cookies = new Map();
    const api = makeApi(cookies);
    assert.equal((await api('/api/setup/complete', {
      setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(),
      publicOrigin: origin, username: 'liveqa', displayName: 'Synthetic Live QA',
      password: 'synthetic live qa password', diaryEnabled: false,
    })).status, 201);
    assert.ok((await api('/api/profile/onboarding', {})).status < 300);
    const me = (await api('/api/profile')).body;
    const userId = me?.user?.id || me?.id || null;

    /** A project with two enabled instruction Skills (A and B) and a few chats. */
    async function skillProject(name, chatIds) {
      const created = await api('/api/projects', { name, model: 'synthetic-model', toolboxes: ['core'], files: [skillFile('skill-a', 'Skill A', 'PINEAPPLE'), skillFile('skill-b', 'Skill B', 'MANGO')] });
      const project = created.body.project || created.body;
      assert.ok(project.id, JSON.stringify(created));
      const route = `/api/projects/${project.id}/instruction-skills`;
      let listed = (await api(route)).body.skills;
      for (const s of listed) assert.equal((await api(route, { file: s.file, hash: s.hash, enabled: true }, 'PUT')).status, 200);
      if (chatIds.length) await api(`/api/projects/${project.id}/chats`, { chats: chatIds.map(id => ({ id, title: id })) });
      return { project, route };
    }
    const manifests = async (project) => (await api(`/api/projects/${project.id}/instruction-skills/manifests`)).body.skills;

    async function openView(view, contextOpts = {}) {
      const ctx = await browser.newContext(withLocale(contextOpts));
      await ctx.addCookies([...cookies].map(([n, value]) => ({ name: n, value, url: origin })));
      await ctx.addInitScript(([user, v, theme]) => {
        localStorage.setItem('noevia:last-view', JSON.stringify({ user, view: v, settings: null }));
        if (theme) { try { localStorage.setItem('noevia:theme', theme); localStorage.setItem('cowork:theme', theme); } catch { } }
      }, [userId, view, contextOpts.colorScheme || null]);
      const page = await ctx.newPage();
      await page.goto(origin);
      return { ctx, page };
    }

    async function scenario(id, title, fn) {
      if (only && only !== String(id)) return;
      try { await fn(); results.push([id, true, title]); console.log(`PASS #${id} ${title}`); }
      catch (e) { results.push([id, false, title]); console.log(`FAIL #${id} ${title}\n     ${String(e.message).split('\n').slice(0, 3).join('\n     ')}`); }
    }

    // #562 ─────────────────────────────────────────────────────────────────────────────────────
    await scenario(562, 'Retry after skill_revoked resends the same pin and refuses if that Skill is now disabled', async () => {
      const { project, route } = await skillProject('Retry pin QA', ['retry-chat']);
      const before = await manifests(project);
      const b = before.find(m => m.name === 'Skill B');
      const { ctx, page } = await openView({ kind: 'chat', chatId: 'retry-chat', projectId: project.id });
      try {
        const chatBodies = [];
        page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/chat') { try { chatBodies.push(JSON.parse(r.postData() || '{}')); } catch { } } });
        await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
        await page.getByLabel('Skill for the next message').selectOption({ label: 'Skill B · v1' });
        upstream.requests.length = 0;
        await page.getByRole('textbox', { name: 'Message', exact: true }).fill('SLOWSTREAM forty numbered lines');
        await page.keyboard.press('Enter');
        await page.getByTitle('Stop generating').waitFor({ timeout: 10000 });
        await new Promise(r => setTimeout(r, 700));
        // Another tab disables Skill B while the reply is running.
        const listed = (await api(route)).body.skills.find(s => s.name === 'Skill B');
        assert.equal((await api(route, { file: listed.file, enabled: false }, 'PUT')).status, 200);
        await page.getByText(/was disabled or changed during this reply/).waitFor({ timeout: 15000 });
        assert.equal(chatBodies.length, 1);
        assert.match(String(chatBodies[0].skill), new RegExp(`^${b.id}@`), 'the first send carried the pin');
        const upstreamBefore = upstream.requests.length;
        await page.locator('.transcript .msg-retry').click();
        for (let i = 0; i < 100 && chatBodies.length < 2; i++) await new Promise(r => setTimeout(r, 100));
        assert.equal(chatBodies.length, 2, 'Retry sent a request');
        assert.equal(JSON.stringify(chatBodies[1].skill), JSON.stringify(chatBodies[0].skill), 'Retry resends the same pin, not none');
        await new Promise(r => setTimeout(r, 800));
        assert.equal(upstream.requests.length, upstreamBefore, 'no request reached the model as Automatic');
        assert.match(await page.locator('.transcript').innerText(), /This skill is disabled/i, 'the refusal is readable');
        await page.screenshot({ path: path.join(shots, '562-retry-refused.png') });
      } finally { await ctx.close(); }
    });

    // #563 ─────────────────────────────────────────────────────────────────────────────────────
    await scenario(563, 'the composer Skill selector does not float over transcript text (375, 500, 768; light and dark)', async () => {
      const { project } = await skillProject('Selector layout QA', ['layout-chat']);
      const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Synthetic turn ${i}. ${'Padding text so the transcript actually scrolls behind the composer. '.repeat(6)}` }));
      await api('/api/chats/layout-chat/history', { history: long });
      const problems = [];
      for (const scheme of ['light', 'dark']) {
        for (const [width, height] of [[375, 700], [500, 900], [768, 900]]) {
          const { ctx, page } = await openView({ kind: 'chat', chatId: 'layout-chat', projectId: project.id }, { viewport: { width, height }, colorScheme: scheme });
          try {
            await page.getByLabel('Skill for the next message').waitFor({ timeout: 15000 });
            await page.waitForTimeout(400);
            const m = await page.evaluate(() => {
              const pin = document.querySelector('.skill-pin');
              const t = document.querySelector('.transcript').getBoundingClientRect();
              const r = pin.getBoundingClientRect();
              const overlap = Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top) > 1 && Math.min(r.right, t.right) - Math.max(r.left, t.left) > 1;
              // The painted backing behind the selector: itself or an ancestor up to the composer. Anything
              // above that (the page) is not a backing, because the transcript scrolls in between.
              let el = pin, alpha = 0;
              while (el) {
                const c = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [];
                alpha = c.length >= 4 ? Number(c[3]) : c.length === 3 ? 1 : 0;
                if (alpha > 0 || el.classList.contains('composer')) break; el = el.parentElement;
              }
              return { overlap, alpha, right: r.right, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
            });
            if (process.env.QA_DEBUG) console.log(width, scheme, JSON.stringify(await page.evaluate(() => {
              const out = []; let el = document.querySelector('.skill-pin');
              while (el && el !== document.documentElement) { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); out.push([el.className.toString().slice(0, 40), cs.position, cs.overflowY, cs.backgroundColor, Math.round(r.top), Math.round(r.bottom), cs.zIndex]); el = el.parentElement; }
              return { chain: out, scrollY: window.scrollY, innerH: innerHeight, docH: document.documentElement.scrollHeight, t: (() => { const r = document.querySelector('.transcript').getBoundingClientRect(); return [r.top, r.bottom]; })() };
            })));
            await page.screenshot({ path: path.join(shots, `563-${scheme}-${width}.png`) });
            if (m.overlap && m.alpha < 0.85) problems.push(`${scheme} ${width}px: selector overlaps the transcript with no backing (alpha ${m.alpha})`);
            if (m.sw > m.vw + 1) problems.push(`${scheme} ${width}px: horizontal overflow ${m.sw} > ${m.vw}`);
          } finally { await ctx.close(); }
        }
      }
      assert.equal(problems.join('; '), '');
    });

    // #564 ─────────────────────────────────────────────────────────────────────────────────────
    await scenario(564, 'the project home composer has the Skill selector and the first message carries the pin', async () => {
      const { project } = await skillProject('Home pin QA', []);
      const b = (await manifests(project)).find(m => m.name === 'Skill B');
      const { ctx, page } = await openView({ kind: 'project', id: project.id });
      try {
        const bodies = [];
        page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/chat') { try { bodies.push(JSON.parse(r.postData() || '{}')); } catch { } } });
        const box = page.getByRole('textbox', { name: /^Message Home pin QA/ });
        await box.waitFor({ timeout: 15000 });
        const picker = page.locator('.project-composer').getByLabel('Skill for the next message');
        await picker.waitFor({ timeout: 8000 });
        await picker.selectOption({ label: 'Skill B · v1' });
        await page.screenshot({ path: path.join(shots, '564-project-home.png') });
        await box.fill('first message pinned from the project page');
        await page.keyboard.press('Enter');
        await page.getByText('Synthetic completed reply.').waitFor({ timeout: 15000 });
        assert.equal(bodies.length, 1);
        assert.match(String(bodies[0].skill), new RegExp(`^${b.id}@`), 'the first message of the new chat is pinned');
      } finally { await ctx.close(); }
    });

    // #566 ─────────────────────────────────────────────────────────────────────────────────────
    await scenario(566, 'Code mode hides archived projects in the sidebar list and the project picker', async () => {
      const live = (await api('/api/projects', { name: 'Live synthetic coding project', model: 'synthetic-model', toolboxes: ['core'] })).body;
      const gone = (await api('/api/projects', { name: 'Archived synthetic coding project', model: 'synthetic-model', toolboxes: ['core'] })).body;
      const liveId = (live.project || live).id, goneId = (gone.project || gone).id;
      assert.equal((await api(`/api/projects/${goneId}/config`, { archived: true })).status, 200);
      const { ctx, page } = await openView({ kind: 'chat', chatId: 'code-any', projectId: null });
      try {
        await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
        await page.goto(origin + '/code');
        await page.getByText('Open a project to run Code').waitFor({ timeout: 15000 });
        await page.getByRole('button', { name: 'Open Live synthetic coding project' }).first().waitFor({ timeout: 8000 });
        await page.screenshot({ path: path.join(shots, '566-code-mode.png') });
        const text = await page.locator('body').innerText();
        assert.ok(text.includes('Live synthetic coding project'));
        assert.ok(!text.includes('Archived synthetic coding project'), 'an archived project is listed in Code mode');
        assert.equal(await page.getByRole('button', { name: 'Open Archived synthetic coding project' }).count(), 0);
      } finally { await ctx.close(); }
      void liveId;
    });
  } finally {
    await browser.close();
    server.kill('SIGTERM'); await new Promise(r => server.once('exit', r));
    await upstream.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const failed = results.filter(r => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed; screenshots in ${shots}`);
  if (failed.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
