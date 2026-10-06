'use strict';
// #237: the composer catalogue's search filter and what a turn adds. Synthetic boxes only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require }); return exports; };
const { filterCatalogue, mentionedTools, turnBoxesFor, insertMention, placeCatalogue } = load('src/tool-catalogue.ts');
const tool = (name, permission = 'allowed', description = '') => ({ name, description, write: permission === 'needs-approval', permission, reason: permission === 'unavailable' ? 'nope' : null });
const BOXES = [
  { id: 'core', label: 'Core', description: 'Clock and project files', source: 'builtin', state: 'available', reason: null, active: true, tools: [tool('get_current_time', 'allowed', 'The server clock')] },
  { id: 'web-search', label: 'Web search', description: 'Search the public web', source: 'mcp', state: 'available', reason: null, active: false, tools: [tool('tavily_search', 'allowed', 'Search the web')] },
  { id: 'nextcloud-notes', label: 'Notes', description: 'Nextcloud Notes', source: 'mcp', state: 'available', reason: null, active: false, tools: [tool('nc_notes_search_notes'), tool('nc_notes_create_note', 'needs-approval', 'Create a note')] },
  { id: 'gdrive', label: 'Google Drive', description: 'Search Drive', source: 'builtin', state: 'unavailable', reason: 'Connect first', active: false, tools: [tool('gdrive_search', 'unavailable')] },
  { id: 'code', label: 'Coding harness', description: 'Edit a repository', source: 'code', state: 'available', reason: null, active: true, tools: [tool('edit_file', 'needs-approval')] },
];
const keys = (rows) => Array.from(rows, (r) => r.key);

test('an empty query lists boxes only, usable before unavailable', () => {
  assert.deepEqual(keys(filterCatalogue(BOXES, '')), ['box:core', 'box:web-search', 'box:nextcloud-notes', 'box:code', 'box:gdrive']);
});
test('every query word must match label, name, description or box, case-insensitively', () => {
  assert.deepEqual(keys(filterCatalogue(BOXES, 'SEARCH web')), ['box:web-search', 'tool:web-search:tavily_search']);
  assert.deepEqual(keys(filterCatalogue(BOXES, 'notes create')), ['tool:nextcloud-notes:nc_notes_create_note']);
  assert.deepEqual(keys(filterCatalogue(BOXES, 'zzz')), []);
});
test('a leading slash or @ in the query is ignored', () => {
  assert.deepEqual(keys(filterCatalogue(BOXES, '/clock')), keys(filterCatalogue(BOXES, 'clock')));
  assert.deepEqual(keys(filterCatalogue(BOXES, '@tavily')), ['tool:web-search:tavily_search']);
});
test('unavailable matches stay visible with their reason, after the usable ones', () => {
  const rows = filterCatalogue(BOXES, 'search');
  const last = rows[rows.length - 1];
  assert.equal(last.permission, 'unavailable');
  assert.equal(last.reason, 'nope');
  assert.ok(rows.slice(0, -2).every((r) => r.permission !== 'unavailable'));
});
test('mentions count only for usable tools', () => {
  assert.deepEqual(Array.from(mentionedTools('find @tavily_search and @gdrive_search and @nope', BOXES)), ['tavily_search']);
  assert.deepEqual(Array.from(mentionedTools('mail me@tavily_search', BOXES)), [], 'an e-mail address is not a mention');
});
test('a turn adds toggled and mentioned boxes, never an unavailable, already-active or code box', () => {
  assert.deepEqual(Array.from(turnBoxesFor('use @nc_notes_create_note', BOXES, ['web-search', 'gdrive', 'core', 'code'])), ['web-search', 'nextcloud-notes']);
  assert.deepEqual(Array.from(turnBoxesFor('plain', BOXES, [])), []);
});
test('inserting a mention replaces the "/" that opened the catalogue', () => {
  assert.equal(insertMention('/', 'tavily_search'), '@tavily_search ');
  assert.equal(insertMention('look this up', 'tavily_search'), 'look this up @tavily_search ');
  assert.equal(insertMention('look /', 'x'), 'look @x ');
});

// #353: an empty new chat can put the trigger high enough that opening the panel upward
// (its usual direction) pushes the header off the top of the viewport.
test('flips below the trigger when there is little room above but more below', () => {
  const rect = { top: 40, bottom: 76 }; // near the top of a short viewport
  const placed = placeCatalogue(rect, 700);
  assert.equal(placed.top, 'calc(100% + 8px)');
  assert.equal(placed.bottom, 'auto');
  assert.equal(placed.maxHeight, 440);
});
// The reported bug (#353): a trigger at y≈276 in an empty new chat opened the panel with its
// top at y≈-164 (276 - 440), because the fixed max-height ignored the ~268px actually free
// above. Staying above is still right here (more room above than below); the height must clamp.
test('stays above the trigger but clamps to what actually fits, matching the reported regression', () => {
  const placed = placeCatalogue({ top: 276, bottom: 312 }, 900);
  assert.equal(placed.bottom, 'calc(100% + 8px)');
  assert.equal(placed.top, 'auto');
  assert.equal(placed.maxHeight, 268);
  assert.ok(276 - placed.maxHeight >= 0, 'the panel top must not go above the viewport');
});
test('with little room on both sides, still picks whichever is larger and never clamps below a usable minimum', () => {
  const placed = placeCatalogue({ top: 30, bottom: 60 }, 120);
  assert.equal(placed.top, 'calc(100% + 8px)');
  assert.equal(placed.bottom, 'auto');
  assert.equal(placed.maxHeight, 120);
});
