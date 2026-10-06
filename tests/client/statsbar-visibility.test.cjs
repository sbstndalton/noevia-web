// #365: the bottom inference status bar rendered on every view, not only chats, and overlapped
// Diary's calendar header there. shouldShowStatsBar (statsbar-visibility.ts) is the pure gate App.tsx
// renders StatsBar behind; unit-tested directly here since mounting App.tsx needs a live SSE stream,
// workspace fetches and a real DOM.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadPure(relPath) {
  const file = path.join(__dirname, '..', relPath);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => ({}) });
  return exports;
}

const { shouldShowStatsBar } = loadPure('../src/statsbar-visibility.ts');

test('hidden on every non-chat view regardless of message count or telemetry', () => {
  for (const kind of ['plugins', 'archived', 'preview', 'models', 'projects', 'project', 'diary']) {
    assert.equal(shouldShowStatsBar(kind, 0, false), false, kind);
    assert.equal(shouldShowStatsBar(kind, 5, true), false, `${kind} with messages+telemetry`);
  }
});

test('hidden on a chat view with no messages and no telemetry yet (#239)', () => {
  assert.equal(shouldShowStatsBar('chat', 0, false), false);
});

test('shown on a chat view once there is a message, even with no telemetry (rehydrated reply, #357)', () => {
  assert.equal(shouldShowStatsBar('chat', 1, false), true);
});

test('shown on a blank chat that already has live telemetry (a reply arriving before the first message commits)', () => {
  assert.equal(shouldShowStatsBar('chat', 0, true), true);
});

test('shown on a chat view with messages and telemetry', () => {
  assert.equal(shouldShowStatsBar('chat', 3, true), true);
});

// Guards the actual render call in App.tsx, not just the pure helper, so a future edit that
// stops passing view.kind through cannot silently reintroduce the #365 regression.
test('App.tsx gates the StatsBar render on shouldShowStatsBar(view.kind, ...)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  assert.match(src, /const showStats = shouldShowStatsBar\(view\.kind, messages\.length, view\.kind === 'chat' && !!replyTelemetryByChat\[view\.chatId\]\);/);
  // #527: the page strip (or, in phone-sized space, its screen-reader line) and the model sheet's
  // copy are both behind that same gate; nothing else renders a StatsBar.
  assert.match(src, /\{showStats && <StatsBar \{\.\.\.statsProps\} variant=\{phoneSpace \? 'announce' : 'default'\} \/>\}/);
  assert.match(src, /sheetStatus=\{phoneSpace && showStats \? <StatsBar \{\.\.\.statsProps\} variant="sheet" \/> : null\}/);
  assert.equal(src.match(/<StatsBar\b/g).length, 2);
});
