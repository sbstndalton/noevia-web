// #1612, #1613, #1614 (live QA, 2026-10-12): Settings at an 809px-wide window put the page into the
// 192px column meant for the section list (components.css set the two-pane grid from 701px; the
// one-pane rule in shell-v2.css, and SettingsShell, switch at 820px), so every heading broke
// mid-word, cards were slivers, and the Memory box and Display name input were a few pixels wide.
// Offline: the app is built from this checkout and every API is a synthetic stub or answered by
// the diary fixture; nothing reaches a real server.
//
// For every Settings section at 809x844, 700x800 and 390x844 (one pane at a time), and at 840x900
// (the narrowest two-pane window), this asserts:
//   - the page pane is wider than the section list's column (the list is hidden when it is not
//     shown, so the page also takes most of the window);
//   - no word in the page is broken across lines mid-word (a heading, button or badge narrower than
//     its own longest word), except long URL text, which is allowed to wrap anywhere but must keep a
//     readable width;
//   - nothing in the page runs past the right edge of the page or of its own card;
//   - every text input and textarea is at least 160px wide (a select, which sizes to its options, 100px).
//
// Fails on a build without the change, passes with it.
//   npm run build -- --outDir ../dist-before        (or any build of the parent commit)
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=../dist-after QA_SHOTS=<dir> node qa/settings-layout-1612-1614.cjs
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = Number(process.env.QA_PORT || 31612);
const SHOTS = process.env.QA_SHOTS || '';
const ONLY = process.env.QA_ONLY ? process.env.QA_ONLY.split(',') : null; // e.g. QA_ONLY=809x844:connectors

const SECTIONS = ['appearance', 'keyboard', 'personalization', 'memory', 'notifications', 'data', 'usage', 'profile', 'security', 'diary',
  'connectors', 'providers', 'users', 'models', 'address', 'features', 'experimental', 'backups', 'status', 'capabilities'];
// A section that has a second state worth checking (an open editor) gets it as `<id>+<step>`.
const STEPS = { memory: [['edit', async (page) => { await page.getByRole('button', { name: /^Edit/ }).first().click(); await page.locator('.memory-item > input').waitFor(); }]] };
const SIZES = [[809, 844], [700, 800], [390, 844], [840, 900], [320, 568]];

const NOW = Date.now();
const USER = { id: 'qa', username: 'admin', displayName: 'Synthetic Person', role: 'admin', onboarded: true, diaryEnabled: true };
const PROFILE = {
  user: USER,
  passkeys: [{ id: 'pk1', name: 'Synthetic security key', deviceType: 'multiDevice', backedUp: true, createdAt: NOW - 9e8, lastUsedAt: NOW - 1e6 }],
  sessions: [
    { id: 's1', createdAt: NOW - 9e7, lastSeenAt: NOW - 6e4, expiresAt: NOW + 9e8, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0 Safari/537.36', ip: '127.0.0.1', current: true },
    { id: 's2', createdAt: NOW - 9e8, lastSeenAt: NOW - 7e6, expiresAt: NOW + 9e8, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1', ip: '192.168.100.200' },
  ],
};
const USERS = { users: [
  USER,
  { id: 'u2', username: 'synthetic-member-with-a-long-user-name', displayName: 'Synthetic Member With A Long Display Name', role: 'member', disabled: false },
  { id: 'u3', username: 'synthetic-guest', displayName: 'Synthetic Guest', role: 'member', disabled: true },
] };
const PROVIDERS = { providers: [
  { id: 'local', label: 'Local inference', baseUrl: 'http://host.docker.internal:8013/v1', isDefault: true, managed: true, apiKeyMasked: null },
  { id: 'p2', label: 'Synthetic cloud provider', baseUrl: 'https://api.synthetic-provider.example.invalid/openai/v1/chat/completions/with/a/very/long/path', apiKeyMasked: 'sk-…abcd', defaultModel: 'synthetic-model-with-a-rather-long-name-v2' },
] };
const TOOLBOXES = { toolboxes: [], mcp: { configured: true, discovered: 12, servers: [
  { id: 'synthetic-built-in-server', auth: 'internal', directory: false, error: null, discovered: 4, checkedAt: NOW }, { id: 'synthetic-added-server', auth: 'directory', directory: true, title: 'Synthetic added server', error: null, discovered: 8, checkedAt: NOW },
  { id: 'synthetic-broken-server', auth: 'directory', directory: true, error: 'discovery failed', discovered: 0 },
] } };
const MEMORY = { memories: ['I work as a nurse in Bergen.', 'Synthetic long line: always answer in short paragraphs and name the unit when quoting a measurement, including the unusual ones.', 'synthetic-unbroken-identifier-that-is-quite-long-and-has-no-spaces-in-it-at-all-1234567890'],
  useProjectMemories: true, updatedAt: NOW, maxItems: 50, maxItemChars: 300 };
const WORKSPACE = { projects: [{ id: 'p1', name: 'Synthetic project with a rather long name', memories: ['Synthetic project line.'], files: [], chats: [] }], freeChats: [] };
const HEALTH = { inferenceUp: true, diaryUp: true, mcpUp: true };

async function stub(page) {
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET') {
      if (p === '/api/profile' || p === '/api/auth/session') return route.fulfill(json(PROFILE));
      if (p === '/api/admin/users' || p === '/api/users') return route.fulfill(json(USERS));
      if (p === '/api/providers') return route.fulfill(json(PROVIDERS));
      if (p === '/api/toolboxes') return route.fulfill(json(TOOLBOXES));
      if (p === '/api/health') return route.fulfill(json(HEALTH));
      if (p === '/api/account/memory') return route.fulfill(json(MEMORY));
      if (p === '/api/workspace') return route.fulfill(json(WORKSPACE));
      if (p === '/api/connectors') {
        const res = await route.fetch();
        const body = await res.json();
        const drive = body.connectors.find((c) => c.id === 'gdrive');
        if (drive) { drive.state = 'connected'; drive.email = 'synthetic.person.with.a.rather.long.address@example.invalid'; }
        return route.fulfill(json(body));
      }
    }
    return route.fallback();
  });
}

// Everything below runs in the page. A "word" is a run of non-space characters in a text node; it is
// broken when its own client rects sit on more than one line.
const audit = () => {
  const scroll = document.querySelector('.settings-detail-scroll');
  const detail = document.querySelector('.settings-detail');
  const nav = document.querySelector('.settings-navigation');
  const box = (el) => el.getBoundingClientRect();
  const visible = (el) => { const b = box(el); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const out = { detailWidth: Math.round(box(detail).width), // The list's column: its own width when shown, else the first track of the window's grid (a hidden
    // list must not leave its column behind, which is what squeezed the page into 192px).
    navWidth: Math.round(Math.max(nav && getComputedStyle(nav).display !== 'none' ? box(nav).width : 0,
      (() => { const tracks = getComputedStyle(document.querySelector('.settings-stage')).gridTemplateColumns.split(' '); return tracks.length > 1 ? parseFloat(tracks[0]) : 0; })())),
    stageWidth: Math.round(box(document.querySelector('.settings-stage')).width), broken: [], past: [], narrowInputs: [], urls: [], emptySection: !scroll || scroll.textContent.trim().length < 20 };
  if (!scroll) return out;
  const scrollBox = box(scroll);
  const right = scrollBox.right - parseFloat(getComputedStyle(scroll).paddingRight) + 1;

  // Words broken mid-word.
  const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !visible(el) || el.closest('script,style,svg,pre,textarea,option')) continue;
    const text = n.textContent;
    const re = /[^\s\-\u2010-\u2015\/]+/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length < 3) continue;
      const r = document.createRange();
      r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const rects = [...r.getClientRects()].filter((q) => q.width > 0);
      const tops = new Set(rects.map((q) => Math.round(q.top / 4)));
      if (tops.size > 1) {
        // An identifier (an address, a path, a key) has no better break point than "anywhere" when it
        // cannot fit its line; an ordinary word never breaks.
        const anywhere = /[@.:_]/.test(m[0]) && m[0].length >= 12;
        (anywhere ? out.urls : out.broken).push({ word: m[0].slice(0, 40), el: label(el), width: Math.round(box(el).width) });
      }
    }
  }
  // URL-like text must not stack: a URL line is never narrower than a readable measure.
  for (const el of scroll.querySelectorAll('*')) {
    if (!visible(el) || el.children.length) continue;
    if (/^https?:\/\/\S+$/.test(el.textContent.trim()) && box(el).width < 100) out.urls.push({ word: el.textContent.trim().slice(0, 40), el: label(el), width: Math.round(box(el).width), narrow: true });
  }

  // Anything that runs past the page's right edge or past its own card, unless something between
  // the two scrolls on purpose.
  for (const el of scroll.querySelectorAll('*')) {
    if (!visible(el) || el.closest('svg,pre,code,select,option,.sr-only,[hidden]')) continue;
    const b = box(el);
    let clipped = false;
    for (let a = el.parentElement; a && a !== scroll; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { clipped = true; break; }
    }
    if (clipped) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') continue;
    if (b.right > right + 0.5) out.past.push({ el: label(el), right: Math.round(b.right), limit: Math.round(right), text: (el.textContent || '').trim().slice(0, 30) });
    else if (el.scrollWidth > el.clientWidth + 1 && /visible/.test(cs.overflowX) && cs.display !== 'inline' && cs.display !== 'contents') out.past.push({ el: label(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: (el.textContent || '').trim().slice(0, 30) });
  }

  // Fields the person types into.
  for (const el of scroll.querySelectorAll('input, textarea, select')) {
    if (!visible(el)) continue;
    if (el.tagName === 'INPUT' && /^(checkbox|radio|range|file|hidden|color|button|submit)$/.test(el.type)) continue;
    if (el.closest('[role="switch"]')) continue;
    const w = Math.round(box(el).width);
    // A select is as wide as its longest option, so only a collapsed one counts.
    if (w < (el.tagName === 'SELECT' ? 100 : 160)) out.narrowInputs.push({ el: label(el), type: el.type || el.tagName, width: w, name: el.getAttribute('aria-label') || el.name || '' });
  }
  return out;
};

async function openSection(browser, w, h, section) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(() => { try { localStorage.setItem('cowork-theme', 'light'); } catch { /* ignore */ } });
  await stub(page);
  await page.goto(`http://localhost:${PORT}/settings/${section}`);
  await page.locator('.settings-detail-scroll').waitFor({ timeout: 20000 });
  // Let the section's own data arrive.
  await page.waitForTimeout(500);
  return page;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  try {
    for (const [w, h] of SIZES) {
      for (const section of SECTIONS) {
        if (ONLY && !ONLY.some((o) => o.startsWith(`${w}x${h}:${section}`))) continue;
        const states = [['', null], ...(STEPS[section] || [])];
        for (const [step, act] of states) {
          const name = `${w}x${h} ${section}${step ? '+' + step : ''}`;
          if (ONLY && !ONLY.includes(`${w}x${h}:${section}${step ? '+' + step : ''}`)) continue;
          try {
            const page = await openSection(browser, w, h, section);
            if (act) await act(page);
            const m = await page.evaluate(audit);
            if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `settings-${w}x${h}-${section}${step ? '-' + step : ''}.png`) });
            await page.close();
            assert.ok(m.detailWidth > m.navWidth, `the page pane (${m.detailWidth}px) is wider than the list column (${m.navWidth}px)`);
            assert.ok(m.detailWidth >= 0.55 * m.stageWidth, `the page pane (${m.detailWidth}px) takes the window (${m.stageWidth}px), not a column of it`);
            assert.deepEqual(m.broken, [], 'no word is broken across lines');
            assert.deepEqual(m.urls.filter((u) => u.narrow), [], 'URL text keeps a readable width');
            assert.deepEqual(m.past, [], 'nothing runs past the edge of the page or its card');
            assert.deepEqual(m.narrowInputs, [], 'fields are at least 160px wide');
            results.push([name, null]); console.log(`PASS settings-layout: ${name}`);
          } catch (e) {
            results.push([name, e]);
            console.log(`FAIL settings-layout: ${name}\n  ${String(e.message).split('\n').slice(0, 14).join('\n  ')}`);
          }
        }
      }
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nsettings-layout-1612-1614: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
