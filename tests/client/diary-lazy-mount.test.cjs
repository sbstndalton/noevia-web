// #361: a hidden (mounted-but-inactive) Diary view must not fetch or poll
// /api/diary/*. App.tsx keeps DiaryView mounted with display:none when the
// chat view is active — that keeps the in-progress draft, open Markdown
// editor, local-recovery state and scroll position alive across a view
// switch (see the effect at DiaryView.tsx:104-121 that persists exactly that
// state, and diary-local-recovery.ts). So the fix is "keep-alive but
// paused": every data-fetching/polling effect now takes the `active` flag
// App.tsx derives from `view.kind === 'diary'` and returns early while
// inactive, then re-runs (fetching fresh data) the moment `active` flips
// back to true.
//
// Actually exercising those effects needs a real render pass — a plain Node
// process has no DOM and react-dom/server's static renderer never runs
// effects (see tests/client/customise-i18n-render.test.cjs for the same
// limitation), so the end-to-end behavior (mount Diary hidden behind chat,
// assert zero /api/diary/* requests, activate, assert it loads) is covered
// by qa/diary-hidden-view.cjs against the synthetic fixture in
// qa/diary-fixture.cjs (never the real Diary/corpus). What a Node test can
// do, and this file does, is pin down — for every effect that reaches
// /api/diary/* or the diary storage-status poll — that it actually checks
// `active` and lists `active` in its dependency array, so a future edit
// can't silently drop the guard while still looking correct at a glance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readSrc(file) {
  return fs.readFileSync(path.join(__dirname, '../..', 'src', file), 'utf8');
}

// Extracts the full text of every top-level `useEffect(...)` call in `src`,
// matching parens so effects containing their own `()` (arrow functions,
// function calls) don't truncate the extraction early.
function extractEffects(src) {
  const effects = [];
  const marker = 'useEffect(';
  let from = 0;
  for (;;) {
    const start = src.indexOf(marker, from);
    if (start === -1) break;
    let depth = 0, i = start + marker.length - 1; // position of the opening '('
    do {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    } while (depth > 0 && i < src.length);
    effects.push(src.slice(start, i));
    from = i;
  }
  return effects;
}

function effectsMentioning(effects, needle) {
  return effects.filter((e) => e.includes(needle));
}

function depsOf(effectText) {
  const match = effectText.match(/\},\s*\[([^\]]*)\]\s*\)\s*;?\s*$/);
  return match ? match[1] : null;
}

test('DiaryView: every effect that reaches /api/diary/* (or the storage fetch it drives) guards on `active` and lists it as a dependency', () => {
  const src = readSrc('components/DiaryView.tsx');
  const effects = extractEffects(src);
  assert.ok(effects.length > 5, 'expected to find DiaryView\'s effects');

  const cases = [
    { label: 'server recovery poll (/api/diary/exchanges)', needle: 'api/diary/exchanges' },
    { label: 'storage connection fetch (fetchStorage)', needle: 'fetchStorage()' },
    { label: 'overview/months/source load (fetchDiarySource/fetchDiaryMonth/listFiles)', needle: 'fetchDiarySource()' },
    { label: 'file browser listing (listFiles(filePath))', needle: 'listFiles(filePath)' },
  ];

  for (const { label, needle } of cases) {
    const matches = effectsMentioning(effects, needle);
    assert.ok(matches.length >= 1, `expected an effect referencing ${needle} (${label})`);
    for (const effect of matches) {
      assert.match(effect, /if\s*\(\s*!active\s*\)\s*return\s*;/, `${label}: effect does not guard on !active`);
      const deps = depsOf(effect);
      assert.ok(deps !== null, `${label}: could not find a dependency array for this effect`);
      assert.ok(/\bactive\b/.test(deps), `${label}: dependency array "${deps}" does not include active`);
    }
  }
});

test('DiaryView: passes `active` down to DiaryStorageStatus (its /api/diary/storage-status poller)', () => {
  const src = readSrc('components/DiaryView.tsx');
  assert.match(src, /<DiaryStorageStatus\b[^>]*\bactive=\{active\}/, 'DiaryStorageStatus is not given the active flag');
});

test('DiaryStorageStatus: the /api/diary/storage-status poll guards on `active` and lists it as a dependency', () => {
  const src = readSrc('components/DiaryStorageStatus.tsx');
  assert.match(src, /\bactive\s*=\s*true\b/, 'DiaryStorageStatus no longer declares an active prop (with a safe default)');
  const effects = extractEffects(src);
  const matches = effectsMentioning(effects, 'api/diary/storage-status');
  assert.ok(matches.length === 1, 'expected exactly one effect polling /api/diary/storage-status');
  const effect = matches[0];
  assert.match(effect, /if\s*\(\s*!active\s*\)\s*return\s*;/, 'storage-status poll does not guard on !active');
  const deps = depsOf(effect);
  assert.ok(deps && /\bactive\b/.test(deps), 'storage-status poll effect does not depend on active');
});

test('App.tsx: Diary.View only becomes active while it is the visible view', () => {
  const src = readSrc('App.tsx');
  const mountLine = src.split('\n').find((line) => line.includes('<Diary.View'));
  assert.ok(mountLine, 'could not find the Diary.View mount in App.tsx');
  assert.match(mountLine, /active=\{view\.kind === 'diary'\}/, 'Diary.View is not wired to the current view');
});
