// #268 synthetic browser contract QA. Build the base and branch to separate
// external directories, then run with:
// QA_BASE_DIST=/tmp/base-dist QA_BRANCH_DIST=/tmp/branch-dist \
// QA_SCREENSHOTS=/tmp/api-contract-shots PLAYWRIGHT_MODULE=/path/to/playwright-core \
// node qa/api-contract-268.cjs
// All HTTP and login responses are fulfilled in page.route; no live service is contacted.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

if (!process.env.QA_BASE_DIST || !process.env.QA_BRANCH_DIST) {
  throw new Error('Set QA_BASE_DIST and QA_BRANCH_DIST to separate production build directories.');
}
const out = path.resolve(process.env.QA_SCREENSHOTS || '/tmp/noevia-api-contract-268-qa');
fs.mkdirSync(out, { recursive: true });
const dirs = {
  base: path.resolve(process.env.QA_BASE_DIST),
  branch: path.resolve(process.env.QA_BRANCH_DIST),
};
for (const dir of Object.values(dirs)) assert.ok(fs.existsSync(path.join(dir, 'index.html')), `Missing build: ${dir}`);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };

function serveFile(route, dir, pathname) {
  const file = path.resolve(dir, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(dir, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return route.fulfill({ status: 404, body: 'not found' });
  }
  return route.fulfill({ status: 200, contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
}

async function run(browser, name, width, theme, major, save = true) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  await page.addInitScript((value) => localStorage.setItem('cowork-theme', value), theme);
  const apiCalls = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://noevia.test') return route.abort();
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      apiCalls.push(p);
      const headers = { 'content-type': 'application/json' };
      if (major !== null) headers['X-Noevia-API'] = major;
      if (p === '/api/ready') return route.fulfill({ status: 200, headers, body: JSON.stringify({ ready: true, version: 'synthetic' }) });
      if (p === '/api/setup/status') return route.fulfill({ status: 200, headers, body: JSON.stringify({ configured: true, publicOrigin: 'https://noevia.test' }) });
      if (p === '/api/auth/session') return route.fulfill({ status: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) });
      throw Error(`unexpected API request ${p}`);
    }
    return serveFile(route, dirs[name], p);
  });
  await page.goto('https://noevia.test/', { waitUntil: 'domcontentloaded' });
  const mismatch = name === 'branch' && major === '2';
  const expected = mismatch ? 'Update required' : 'Sign in to noevia';
  await page.getByRole('heading', { name: expected }).waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole('heading', { name: 'Update required' }).count(), mismatch ? 1 : 0);
  if (mismatch) assert.deepEqual(apiCalls.filter((p) => p !== '/api/ready'), [], 'mismatch must block session/setup work');
  if (save) await page.screenshot({ path: path.join(out, `${name}-${width}-${theme}.png`), fullPage: true });
  console.log(name, width, theme, expected, apiCalls.join(','));
  await page.close();
}

async function runSwitch(browser) {
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  let major = '1';
  let loginCalls = 0;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://noevia.test') return route.abort();
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      const headers = { 'content-type': 'application/json', 'X-Noevia-API': major };
      if (p === '/api/ready') return route.fulfill({ status: 200, headers, body: '{"ready":true,"version":"synthetic"}' });
      if (p === '/api/setup/status') return route.fulfill({ status: 200, headers, body: '{"configured":true,"publicOrigin":"https://noevia.test"}' });
      if (p === '/api/auth/session') return route.fulfill({ status: 401, headers, body: '{"error":"unauthorized"}' });
      if (p === '/api/auth/login/password') { loginCalls++; return route.fulfill({ status: 401, headers, body: '{"error":"synthetic"}' }); }
      throw Error(`unexpected API request ${p}`);
    }
    return serveFile(route, dirs.branch, p);
  });
  await page.goto('https://noevia.test/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Sign in to noevia' }).waitFor();
  major = '2';
  await page.getByLabel('Username').fill('synthetic-user');
  await page.getByLabel('Password').fill('synthetic-password');
  await page.getByRole('button', { name: 'Sign in with password' }).click();
  await page.getByRole('heading', { name: 'Update required' }).waitFor();
  assert.equal(loginCalls, 1);
  console.log('branch 768 switch-v1-to-v2 Update required after first incompatible API response');
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    for (const name of ['base', 'branch']) {
      for (const theme of ['light', 'dark']) {
        for (const width of [1440, 768, 390]) await run(browser, name, width, theme, '2');
      }
    }
    await run(browser, 'branch', 390, 'light', null, false); // legacy v1 has no marker
    await run(browser, 'branch', 390, 'dark', '1', false); // current v1
    await runSwitch(browser);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
