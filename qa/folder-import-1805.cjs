// #1805: import a whole folder, every subfolder included, into a project's Sources.
//
// A real application server (server/index.cjs from an assembled noevia-core + noevia-web tree), a real
// browser, and a synthetic WebDAV server standing in for connected storage. A synthetic folder is
// written to a temp directory: three levels, `readme.md` in two different subfolders, a `.git`, a
// `node_modules` and an unreadable `tool.exe`. The script:
//   1. picks it with the "Add folder" button (a labelled <input webkitdirectory>) and waits for the
//      one-time status announcement;
//   2. checks storage holds every readable file under its relative path, the same-named files did not
//      collide, `.git`/`node_modules`/`tool.exe` never left the browser or are listed as skipped with a
//      reason, and Sources shows `docs/readme.md` and `notes/readme.md` as two rows;
//   3. edits one file and imports the same folder again: one update, the rest unchanged, no copies;
//   4. takes light and dark screenshots at 2000 px and 390 px of that result (QA_SHOTS);
//   5. drops a second folder on Sources (a DataTransfer whose item is a directory entry, as Chrome,
//      Safari and Firefox hand one over) and checks it is walked to every level.
// Synthetic data only; never the live server.
//
// FAILS on main (there is no "Add folder"), PASSES with the change.
// Run: PLAYWRIGHT_MODULE=<playwright-core> APP_DIR=<assembled apps/web with dist/> [QA_SHOTS=<dir>] node qa/folder-import-1805.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31805), origin = `http://localhost:${PORT}`;
const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const shots = process.env.QA_SHOTS || '';
const PROJECT = 'QA 1805 Folder Import';

/** WebDAV over an in-memory tree: PROPFIND (Depth 1), GET, PUT, MKCOL (needs its parent). */
function startDav() {
  const dirs = new Set(['']), files = new Map(), puts = [];
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const href = (p, dir) => '/dav/' + p.split('/').filter(Boolean).map(encodeURIComponent).join('/') + (dir && p ? '/' : '');
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/dav\/?/, '').replace(/\/+$/, '');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PROPFIND') {
        if (files.has(p)) {
          res.writeHead(207, { 'Content-Type': 'application/xml' });
          return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${href(p)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${files.get(p).length}</d:getcontentlength><d:getetag>"e${p.length}-${files.get(p).length}"</d:getetag></d:prop></d:propstat></d:response></d:multistatus>`);
        }
        if (!dirs.has(p)) { res.writeHead(404); return res.end(); }
        const rows = [`<d:response><d:href>${href(p, true)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`];
        for (const d of dirs) if (d && parentOf(d) === p) rows.push(`<d:response><d:href>${href(d, true)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`);
        for (const [f, body] of files) if (parentOf(f) === p) rows.push(`<d:response><d:href>${href(f)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${body.length}</d:getcontentlength></d:prop></d:propstat></d:response>`);
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${rows.join('')}</d:multistatus>`);
      }
      if (req.method === 'GET') { if (!files.has(p)) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(files.get(p)); }
      if (req.method === 'MKCOL') {
        if (dirs.has(p)) { res.writeHead(405); return res.end(); }
        if (!dirs.has(parentOf(p))) { res.writeHead(409); return res.end(); }
        dirs.add(p); res.writeHead(201); return res.end();
      }
      if (req.method === 'PUT') {
        if (!dirs.has(parentOf(p))) { res.writeHead(409); return res.end(); }
        if (req.headers['if-none-match'] === '*' && files.has(p)) { res.writeHead(412); return res.end(); }
        const existed = files.has(p);
        files.set(p, Buffer.concat(chunks)); puts.push(p);
        res.writeHead(existed ? 204 : 201, { ETag: `"put${puts.length}"` }); return res.end();
      }
      if (req.method === 'DELETE') { files.delete(p); res.writeHead(204); return res.end(); }
      res.writeHead(405); res.end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, dirs, files, puts })));
}

/** The synthetic folder on disk: three levels, two `readme.md`s, and what must be skipped. */
function writeFolder(base) {
  const tree = {
    'readme.md': '# QA1805 top readme\n',
    'docs/readme.md': '# QA1805 docs readme\n',
    'docs/api/auth.md': '# QA1805 auth\n\nSynthetic token flow.\n',
    'notes/readme.md': '# QA1805 notes readme\n',
    'notes/2026/q4/plan.txt': 'QA1805 synthetic plan\n',
    '.git/config': '[core]\n\tbare = false\n',
    '.git/HEAD': 'ref: refs/heads/main\n',
    'node_modules/left-pad/index.js': 'module.exports = () => 1;\n',
    'node_modules/left-pad/readme.md': '# not ours\n',
    'tool.exe': 'MZ synthetic',
  };
  for (const [rel, body] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), body);
  }
}

async function api(page, url, body, method = body === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ url, body, method }) => {
    const csrf = decodeURIComponent(document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('cowork_csrf='))?.slice(12) || '');
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { url, body, method });
}

async function openSources(page) {
  await page.goto(origin);
  await page.getByText(PROJECT, { exact: true }).first().click();
  await page.getByRole('tab', { name: /Sources/ }).first().click();
  await page.locator('.project-sources').waitFor();
}

/** Drop a folder on Sources the way a browser hands one over: an item whose entry is a directory. */
async function dropFolder(page, tree) {
  await page.evaluate((tree) => {
    const target = document.querySelector('.project-sources');
    const fileEntry = (name, fullPath, text) => ({ isFile: true, isDirectory: false, name, fullPath, file: (ok) => ok(new File([text], name, { type: 'text/markdown' })) });
    const dirEntry = (name, fullPath, spec) => {
      const children = Object.entries(spec).map(([n, v]) => (typeof v === 'string' ? fileEntry(n, `${fullPath}/${n}`, v) : dirEntry(n, `${fullPath}/${n}`, v)));
      return { isFile: false, isDirectory: true, name, fullPath, createReader() { let done = false; return { readEntries(ok) { ok(done ? [] : children); done = true; } }; } };
    };
    const [name, spec] = Object.entries(tree)[0];
    const entry = dirEntry(name, `/${name}`, spec);
    const dataTransfer = { types: ['Files'], files: [], items: [{ kind: 'file', webkitGetAsEntry: () => entry }], dropEffect: 'copy' };
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const event = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      target.dispatchEvent(event);
    }
  }, tree);
}

/** Light and dark at one width, from the live page so the import result and skipped list stay on screen. */
async function shoot(page, { width, height }, name) {
  await page.setViewportSize({ width, height });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { localStorage.setItem('cowork-theme', t); document.documentElement.setAttribute('data-theme', t); }, theme);
    const details = page.locator('.folder-import-skipped');
    if (await details.count() && !(await details.evaluate((el) => el.open))) await details.locator('summary').click();
    await page.locator('.source-actions').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, `${name}-${theme}-import.png`) });
    await page.locator('.source-list li[data-source-name$="qa-1805-notes/docs/readme.md"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, `${name}-${theme}-sources.png`) });
  }
}

(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-qa-1805-'));
  const picked = path.join(dir, 'picked', 'qa-1805-notes');
  writeFolder(picked);
  const dav = await startDav();
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...process.env, UI_DATA_DIR: path.join(dir, 'data'), UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false',
    INFERENCE_BASE_URL: 'http://127.0.0.1:1', MODEL_MANAGER_BASE_URL: 'http://127.0.0.1:1', MCP_SERVER_URL: '', MCP_SERVERS: '', DOCLING_BASE_URL: '', DIARY_BASE_URL: 'http://127.0.0.1:1' } });
  let stderr = ''; server.stderr.on('data', (c) => { stderr += c; });
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let failed = false;
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise((r) => setTimeout(r, 50)); }
    const ctx = await browser.newContext(withLocale({ viewport: { width: 1440, height: 1000 } }));
    const page = await ctx.newPage();
    await page.goto(origin);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'data', 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'qa1805', displayName: 'Synthetic 1805 QA', password: 'synthetic qa 1805 password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    let r = await api(page, '/api/integrations/storage', { kind: 'webdav', baseUrl: `http://127.0.0.1:${dav.port}/dav`, username: 'u', secret: 's' }, 'PUT');
    assert.equal(r.status, 200, 'connect synthetic storage: ' + JSON.stringify(r.body));
    r = await api(page, '/api/projects', { name: PROJECT, model: 'synthetic-model' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const project = r.body.project || r.body;

    // 1. "Add folder" opens a labelled directory picker.
    await openSources(page);
    const add = page.getByRole('button', { name: 'Add folder', exact: true });
    assert.equal(await add.count(), 1, 'Sources offers an "Add folder" button');
    const input = page.getByLabel('Choose a folder to import, including every subfolder');
    assert.equal(await input.count(), 1, 'the folder input is labelled');
    assert.equal(await input.evaluate((el) => el.hasAttribute('webkitdirectory')), true, 'the input picks a directory');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
    assert.equal(chooser.isMultiple(), true);
    await chooser.setFiles(picked);
    const status = page.locator('.project-sources [role=status]');
    await page.waitForFunction(() => /Folder import finished/.test(document.querySelector('.project-sources [role=status]')?.textContent || ''), null, { timeout: 60000 });
    const summary = await status.textContent();
    assert.match(summary, /added 5 · updated 0 · unchanged 0 · skipped 3 · failed 0/, summary);
    console.log('PASS Add folder: ' + summary);

    // 2. Storage, the project record and Sources.
    let saved = (await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id);
    const pf = saved.projectFolder;
    const expected = ['docs/api/auth.md', 'docs/readme.md', 'notes/2026/q4/plan.txt', 'notes/readme.md', 'readme.md'].map((x) => `${pf}/Text/qa-1805-notes/${x}`);
    assert.deepEqual([...dav.files.keys()].sort(), expected.sort(), 'every readable file is in storage under its relative path');
    assert.equal(String(dav.files.get(`${pf}/Text/qa-1805-notes/docs/readme.md`)), '# QA1805 docs readme\n');
    assert.equal(String(dav.files.get(`${pf}/Text/qa-1805-notes/notes/readme.md`)), '# QA1805 notes readme\n', 'the two readme.md files did not collide');
    assert.ok(![...dav.files.keys()].some((k) => /\.git|node_modules|tool\.exe/.test(k)), 'nothing skipped reached storage');
    assert.deepEqual(saved.files.map((f) => f.name).sort(), expected.sort(), 'each is a project source under its path');
    // Row titles, without the word joiners keepIdentifiersWhole puts after hyphens.
    const titles = (await page.locator('.source-list li .source-name > span').evaluateAll((els) => els.map((el) => Array.from(el.childNodes).filter((n) => n.nodeName !== 'SMALL').map((n) => n.textContent).join('').replace(/\u2060/g, ''))));
    for (const label of ['qa-1805-notes/docs/readme.md', 'qa-1805-notes/notes/readme.md', 'qa-1805-notes/docs/api/auth.md', 'qa-1805-notes/notes/2026/q4/plan.txt']) {
      assert.ok(titles.includes(label), `Sources shows ${label} as a row title: ${JSON.stringify(titles)}`);
    }
    const skippedBox = page.locator('.folder-import-skipped');
    await skippedBox.locator('summary').click();
    const skippedText = (await skippedBox.innerText()).replace(/\s+/g, ' ');
    assert.match(skippedText, /Skipped \(3\)/);
    assert.match(skippedText, /qa-1805-notes\/\.git \(2 files\) System or tool folder, skipped on purpose/);
    assert.match(skippedText, /qa-1805-notes\/node_modules \(2 files\) System or tool folder, skipped on purpose/);
    assert.match(skippedText, /qa-1805-notes\/tool\.exe This file type cannot be read as a project source/);
    assert.equal(await page.locator('.upload-progress').getAttribute('aria-live'), 'off', 'per-file progress stays quiet; the status line announces once');
    console.log('PASS storage paths, no collision, skipped list with reasons, paths shown in Sources');

    // 3. Re-import after editing one file: one update, the rest unchanged, no copies.
    fs.writeFileSync(path.join(picked, 'notes/readme.md'), '# QA1805 notes readme, edited\n');
    const putsBefore = dav.puts.length;
    await page.locator('[data-testid=folder-import-input]').setInputFiles(picked);
    await page.waitForFunction(() => /updated 1/.test(document.querySelector('.project-sources [role=status]')?.textContent || ''), null, { timeout: 60000 });
    assert.match(await status.textContent(), /added 0 · updated 1 · unchanged 4 · skipped 3 · failed 0/);
    assert.deepEqual(dav.puts.slice(putsBefore), [`${pf}/Text/qa-1805-notes/notes/readme.md`], 'only the edited file was written');
    assert.equal(String(dav.files.get(`${pf}/Text/qa-1805-notes/notes/readme.md`)), '# QA1805 notes readme, edited\n');
    saved = (await api(page, '/api/workspace')).body.projects.find((p) => p.id === project.id);
    assert.equal(saved.files.length, 5, 'no duplicate sources');
    console.log('PASS re-import: 1 updated, 4 unchanged, one write, no duplicates');

    // 4. Light and dark at 2000 px and 390 px, showing this import's result and skipped list.
    if (shots) {
      await shoot(page, { width: 2000, height: 1250 }, '1805-2000');
      await shoot(page, { width: 390, height: 844 }, '1805-390');
      await page.setViewportSize({ width: 1440, height: 1000 });
      console.log('PASS screenshots in ' + shots);
    }

    // 5. Drop a folder on Sources.
    await dropFolder(page, { 'qa-1805-dropped': { 'intro.md': '# dropped intro', guide: { 'intro.md': '# dropped guide intro', deep: { 'step.md': '# step' } }, node_modules: { 'x.js': 'no' } } });
    await page.waitForFunction(() => /added 3/.test(document.querySelector('.project-sources [role=status]')?.textContent || ''), null, { timeout: 60000 });
    assert.ok(dav.files.has(`${pf}/Text/qa-1805-dropped/guide/deep/step.md`), 'a dropped folder is read to every level');
    assert.ok(dav.files.has(`${pf}/Text/qa-1805-dropped/intro.md`) && dav.files.has(`${pf}/Text/qa-1805-dropped/guide/intro.md`));
    assert.ok(![...dav.files.keys()].some((k) => k.includes('qa-1805-dropped/node_modules')));
    console.log('PASS drop a folder: walked to every level, node_modules skipped');

  } catch (e) {
    failed = true;
    console.log('FAIL #1805 ' + String(e.message).split('\n').slice(0, 10).join('\n     '));
    if (process.env.QA_DEBUG) console.log(stderr.slice(-4000));
  } finally {
    await browser.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
    await new Promise((r) => dav.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
