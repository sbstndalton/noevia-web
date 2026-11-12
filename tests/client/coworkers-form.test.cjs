'use strict';
// sbstndalton/noevia#2446: the coworker settings form (src/coworker-form.ts): limits, what changed, grants, tints, and
// what a 409 `stale_revision` does to the person's edits.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./spaces-load.cjs');
const f = load('coworker-form.ts');
const plain = (o) => JSON.parse(JSON.stringify(o));

const rec = (over = {}) => ({ id: 'c1', name: 'QA Researcher', glyph: '🔎', tint: 'info', brief: 'Be brief.', projectId: null, chatId: null, spaces: ['s1', 's2'], defaultSpace: 's1', createdAt: 1, updatedAt: 2, ...over });
const fields = (over = {}) => ({ ...f.fieldsOf(rec()), ...over });

test('limits: name 1 to 60, instructions at most 8000 characters, glyph at most 16 (counted in characters, not code units)', () => {
  assert.deepEqual(plain(f.formProblems(fields())), []);
  assert.deepEqual(plain(f.formProblems(fields({ name: '   ' }))), ['name-empty']);
  assert.deepEqual(plain(f.formProblems(fields({ name: 'n'.repeat(61) }))), ['name-long']);
  assert.deepEqual(plain(f.formProblems(fields({ name: 'n'.repeat(60) }))), []);
  assert.deepEqual(plain(f.formProblems(fields({ name: '😀'.repeat(60) }))), []);
  assert.deepEqual(plain(f.formProblems(fields({ brief: 'b'.repeat(8000) }))), []);
  assert.deepEqual(plain(f.formProblems(fields({ brief: 'b'.repeat(8001) }))), ['brief-long']);
  assert.deepEqual(plain(f.formProblems(fields({ brief: '😀'.repeat(8000) }))), [], 'emoji count once');
  assert.deepEqual(plain(f.formProblems(fields({ glyph: 'g'.repeat(17) }))), ['glyph-long']);
  assert.equal(f.COWORKER_BRIEF_MAX, 8000);
});

test('tints are design-token names; anything else shows the default; a missing glyph is the first letter', () => {
  assert.deepEqual(plain(f.TINTS), ['primary', 'secondary', 'tertiary', 'success', 'warning', 'info']);
  assert.equal(f.tintOf('success'), 'success');
  assert.equal(f.tintOf(''), 'secondary');
  assert.equal(f.tintOf('hotpink'), 'secondary');
  assert.equal(f.glyphOf({ glyph: '', name: 'ada' }), 'A');
  assert.equal(f.glyphOf({ glyph: ' 🔎 ', name: 'ada' }), '🔎');
  assert.equal(f.glyphOf({ glyph: '', name: '  ' }), '?');
});

test('only what changed is sent (text trimmed); nothing changed is null', () => {
  const base = fields();
  assert.equal(f.changesFrom(base, { ...base }), null);
  assert.deepEqual(plain(f.changesFrom(base, { ...base, name: '  QA Reader ' })), { name: 'QA Reader' });
  assert.deepEqual(plain(f.changesFrom(base, { ...base, brief: 'Longer.', tint: 'warning' })), { brief: 'Longer.', tint: 'warning' });
  assert.deepEqual(plain(f.changesFrom(base, { ...base, defaultSpace: null })), { defaultSpace: null }, 'clearing the default is a change');
});

test('tools travel only when the record has them', () => {
  const without = fields();
  assert.equal('toolboxes' in without, false);
  assert.equal(f.changesFrom(without, { ...without, toolboxes: ['files'] }), null, 'a server without the field is never sent it');
  const withTools = { ...fields(), toolboxes: ['files'] };
  assert.deepEqual(plain(f.changesFrom(withTools, { ...withTools, toolboxes: ['files', 'web'] })), { toolboxes: ['files', 'web'] });
});

test('the default Space is always one of the granted Spaces', () => {
  assert.deepEqual(plain(f.withGrants(fields(), ['s2'])).defaultSpace, 's2', 'revoking the default falls back to the first granted');
  assert.equal(f.withGrants(fields(), []).defaultSpace, null);
  assert.equal(f.withGrants(fields({ defaultSpace: null }), ['s2', 's3']).defaultSpace, 's2');
  assert.equal(f.withGrants(fields(), ['s1', 's2', 's3']).defaultSpace, 's1');
});

test('grants to a Space that no longer exists are dropped before saving', () => {
  const out = plain(f.pruneGrants(fields(), new Set(['s2'])));
  assert.deepEqual(out.spaces, ['s2']);
  assert.equal(out.defaultSpace, 's2');
});

test('a 409 reloads the record and keeps the edits: untouched fields take the newer value, edited ones stay', () => {
  const base = { revision: 3, fields: fields() };
  const draft = fields({ name: 'QA Reader (mine)', brief: 'My new instructions.' });
  const fresh = { revision: 5, specialist: rec({ glyph: '✨', brief: 'Changed by someone else.', name: 'Someone else renamed it', tint: 'warning' }) };
  const out = plain(f.afterStale({ base, draft }, fresh));
  assert.equal(out.base.revision, 5, 'the next save is based on the fresh revision');
  assert.equal(out.draft.name, 'QA Reader (mine)', 'my edit stays');
  assert.equal(out.draft.brief, 'My new instructions.', 'my edit stays even where theirs differs');
  assert.equal(out.draft.glyph, '✨', 'a field I did not touch takes the newer value');
  assert.equal(out.draft.tint, 'warning');
  // The next save sends exactly my two edits on top of the fresh record.
  assert.deepEqual(plain(f.changesFrom(out.base.fields, out.draft)), { name: 'QA Reader (mine)', brief: 'My new instructions.' });
});

test('a 409 with no edits just adopts the fresh record', () => {
  const base = { revision: 1, fields: fields() };
  const out = plain(f.afterStale({ base, draft: fields() }, { revision: 2, specialist: rec({ name: 'Renamed elsewhere' }) }));
  assert.equal(out.draft.name, 'Renamed elsewhere');
  assert.equal(f.changesFrom(out.base.fields, out.draft), null);
});
