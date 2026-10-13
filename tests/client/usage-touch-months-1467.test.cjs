// #1467: the Usage activity heat map cells are 10 px, so on touch a month opens its days as a list of
// full-size (44 px or taller) rows. The compact grid is unchanged. Covers the pure month grouping, the
// touch list rendered through Vite's SSR pipeline, the CSS contract for the rows, and the pointer test
// that decides whether the list is shown at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const css = fs.readFileSync(path.join(SRC, 'styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const day = (d, replies = 1, input = 100, output = 50) => ({ day: d, input, output, replies });

test('days group by calendar month in arrival order, across a year boundary', async () => {
  const { groupUsageDaysByMonth } = await loadPure();
  const groups = groupUsageDaysByMonth([day('2025-12-30'), day('2025-12-31'), day('2026-01-01'), day('2026-01-02'), day('2026-03-05')]);
  assert.deepEqual(groups.map(g => g.key), ['2025-12', '2026-01', '2026-03']);
  assert.deepEqual(groups.map(g => [g.year, g.month]), [[2025, 12], [2026, 1], [2026, 3]]);
  assert.deepEqual(groups[0].days.map(d => d.day), ['2025-12-30', '2025-12-31']);
  assert.deepEqual(groups[1].days.map(d => d.day), ['2026-01-01', '2026-01-02']);
  assert.deepEqual(groups[2].days.map(d => d.day), ['2026-03-05']);
});

test('no activity means no months', async () => {
  const { groupUsageDaysByMonth } = await loadPure();
  assert.deepEqual(groupUsageDaysByMonth([]), []);
});

test('the pointer test reads a coarse or hover-less primary input as touch', async () => {
  const { isCoarsePointerDevice } = await loadPure('composer-focus');
  const matches = (q) => ({ matchMedia: (query) => ({ matches: q.includes(query) }) });
  assert.equal(isCoarsePointerDevice(matches(['(pointer: coarse)'])), true);
  assert.equal(isCoarsePointerDevice(matches(['(hover: none)'])), true);
  assert.equal(isCoarsePointerDevice(matches([])), false, 'a mouse or trackpad keeps the compact grid only');
  assert.equal(isCoarsePointerDevice(undefined), false);
});

test('the touch list stays closed until a month is tapped, then lists only that month’s days', () => withTouch(({ UsageTouchMonths }, React, render) => {
  const months = [
    { key: '2026-01', label: 'Jan 2026', days: [day('2026-01-01'), day('2026-01-02')] },
    { key: '2026-02', label: 'Feb 2026', days: [day('2026-02-14')] },
  ];
  const closed = render(React.createElement(UsageTouchMonths, { months, openKey: null, onOpen() {}, activeDay: null, onPick() {} }));
  assert.equal((closed.match(/aria-expanded="false"/g) || []).length, 2, 'both months start closed');
  assert.doesNotMatch(closed, /usage-touch-days/);
  assert.doesNotMatch(closed, /usage-touch-day"/);

  const open = render(React.createElement(UsageTouchMonths, { months, openKey: '2026-01', onOpen() {}, activeDay: '2026-01-02', onPick() {} }));
  assert.equal((open.match(/class="usage-touch-day"/g) || []).length, 2, 'one full row per day in the tapped month');
  assert.doesNotMatch(open, /2026-02-14/, 'the other month is not listed');
  assert.match(open, /aria-pressed="true"[^>]*>[\s\S]*?2026-01-02/, 'the active day is marked');
  assert.match(open, /aria-controls="usage-touch-days"/);
  assert.match(open, /aria-expanded="true"/);
}));

test('each touch row and month button is at least 44 px tall in the stylesheet', () => {
  for (const selector of ['.usage-touch-month', '.usage-touch-day']) {
    const rule = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `${selector} has a rule`);
    assert.match(rule[1], /min-height:\s*44px/, `${selector} is a full-size target`);
  }
});

test('the compact activity grid keeps its 10 px cells', () => {
  assert.match(css, /\.usage-cell \{ width: 10px; height: 10px;/);
});

async function loadPure(name = 'usage-months') {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  try {
    return await server.ssrLoadModule(`/src/${name}.ts`);
  } finally {
    await server.close();
  }
}

async function withTouch(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    const mod = await server.ssrLoadModule('/src/components/UsageTouchMonths.tsx');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    return await fn(mod, React, renderToStaticMarkup);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}
