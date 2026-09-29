// #577: an upload the server could not read must not be shown as "Saved", and a SKILL.md upload
// must be readable and appear as a Skill awaiting review, even with Docling live as the
// extraction backend. Real application server (server/index.cjs) plus a synthetic Docling worker
// that refuses Markdown (as the live one did) and reads anything else. Synthetic data only.
//
// Run: PLAYWRIGHT_MODULE=<playwright-core> [APP_DIR=<web dir of another build>] node qa/upload-readability-577.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { withLocale } = require('./qa-locale.cjs');
const PORT = 31577, DOCLING_PORT = 31578, origin = `http://localhost:${PORT}`;
const web = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
async function api(page, url, body, method = body === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ url, body, method }) => {
    const csrf = decodeURIComponent(document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('cowork_csrf='))?.slice(12) || '');
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { url, body, method });
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-upload577-'));
  const docling = http.createServer(async (req, res) => {
    for await (const _ of req);
    const name = String(req.headers['x-document-name'] || '');
    if (/\.md$/i.test(name)) { res.statusCode = 422; return res.end('{}'); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ total: 1, pages: [{ number: 1, text: 'Synthetic extracted text', status: 'native' }] }));
  });
  await new Promise(r => docling.listen(DOCLING_PORT, '127.0.0.1', r));
  const server = spawn(process.execPath, ['server/index.cjs'], { cwd: web, stdio: 'ignore', env: {
    ...process.env, UI_DATA_DIR: dir, UI_PORT: String(PORT), UI_HOST: '127.0.0.1', PUBLIC_ORIGIN: origin, LEGACY_AUTH_COMPAT: 'false',
    INFERENCE_BASE_URL: 'http://127.0.0.1:1/v1', MODEL_MANAGER_KIND: 'none', MCP_SERVERS: '', MCP_SERVER_URL: '',
    DOCLING_BASE_URL: `http://127.0.0.1:${DOCLING_PORT}` } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/setup/status')).ok) break; } catch { } await new Promise(r => setTimeout(r, 50)); }
    const ctx = await browser.newContext(withLocale({ viewport: { width: 1440, height: 950 } }));
    const page = await ctx.newPage();
    await page.goto(origin);
    assert.equal((await api(page, '/api/setup/complete', { setupCode: fs.readFileSync(path.join(dir, 'first-run-setup-code'), 'utf8').trim(), publicOrigin: origin, username: 'uploadqa', displayName: 'Synthetic upload QA', password: 'synthetic upload qa password', diaryEnabled: false })).status, 201);
    await api(page, '/api/profile/onboarding', {});
    const project = (await api(page, '/api/projects', { name: 'Upload QA', model: 'synthetic', toolboxes: ['core'] })).body;
    await page.reload();
    await page.getByText('Upload QA', { exact: true }).first().click();
    await page.getByRole('tab', { name: /Sources/ }).first().click().catch(async () => { await page.getByText('Sources', { exact: true }).first().click(); });
    const input = page.locator('.project-sources input[type=file]').first();
    const skill = '---\nname: synthetic-skill\ndescription: Synthetic skill for browser proof\n---\n\nDo the synthetic thing.\n';

    // (a) SKILL.md: readable, listed, and a Skill awaiting review.
    await input.setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(skill) });
    await page.getByText(/Upload results \(1\)/).waitFor({ timeout: 15000 });
    const rowA = await page.locator('.upload-progress li').first().textContent();
    const summaryA = await page.locator('summary').filter({ hasText: /Upload results/ }).first().innerText();
    assert.match(summaryA, /saved/i, 'SKILL.md summary: ' + summaryA);
    assert.doesNotMatch(rowA, /Not readable/, 'SKILL.md row: ' + rowA);
    const saved = (await api(page, '/api/workspace')).body.projects.find(p => p.id === project.id);
    const file = saved.files.find(f => /SKILL\.md$/.test(f.name));
    assert.ok(file && file.content.includes('Do the synthetic thing.'), 'SKILL.md text must be readable, got ' + JSON.stringify(file && { c: file.content, a: file.attachment, d: file.document }));
    await page.getByText(/Some instruction files need review/).waitFor({ timeout: 15000 });
    console.log('PASS (a) SKILL.md is readable and a Skill awaiting review');

    // (b) A forced-unreadable file (NUL bytes) must say why and must not count as saved.
    await input.setInputFiles({ name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.concat([Buffer.from([0, 1, 2, 0, 255]), Buffer.from('binary junk')]) });
    await page.waitForFunction(() => /Upload results \(1\)/.test(document.body.innerText) && !/Uploading files/.test(document.body.textContent), null, { timeout: 15000 });
    await page.waitForFunction(() => /broken\.txt/.test(document.querySelector('.upload-progress')?.textContent || ''), null, { timeout: 15000 });
    const rowB = await page.locator('.upload-progress li').first().textContent();
    const summaryB = await page.locator('summary').filter({ hasText: /Upload results/ }).first().innerText();
    assert.match(rowB, /Not readable · /, 'unreadable row must say Not readable · reason, got: ' + rowB);
    assert.match(summaryB, /some files were not added/, 'unreadable file must not be counted as saved: ' + summaryB);
    console.log('PASS (b) unreadable upload shows "Not readable · reason" and is not counted as saved');
  } finally { await browser.close(); server.kill('SIGTERM'); await once(server, 'exit'); await new Promise(r => docling.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
