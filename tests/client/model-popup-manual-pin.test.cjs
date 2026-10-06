'use strict';
// #384: choosing a model row patched only `model`, and chat.cjs routes on `routing` alone — so a
// model pick never actually stuck; the very next send was still Auto-routed. The fix sends
// {model, routing:'manual'} atomically from every place this popup lets someone pick a model, and
// the server (routes/projects.cjs) treats a model-only patch as an implicit manual choice too, so
// older/other callers stay safe. This repo has no jsdom/@testing-library (see
// library-tab-non-chat-models.test.cjs for the same source-pattern approach), so this asserts the
// call sites directly against the source.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ModelPopup.tsx'), 'utf8');

test('clicking an installed model row sends {model, routing: \'manual\'} in one save', () => {
  assert.match(
    src,
    /onClick=\{\(\) => void save\(m\.name, \{ model: m\.name, routing: 'manual' \}\)\}/,
    'the model row must patch routing atomically with model, not in a separate request',
  );
});

test('setting a hosted/cloud model id (Enter key and the Set button) also pins routing to manual', () => {
  assert.match(
    src,
    /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' && cloudModel\.trim\(\)\) void save\('cloud-model', \{ model: cloudModel\.trim\(\), routing: 'manual' \}\); \}\}/,
    'pressing Enter in the hosted-model-id field must also send routing:manual',
  );
  assert.match(
    src,
    /onClick=\{\(\) => void save\('cloud-model', \{ model: cloudModel\.trim\(\), routing: 'manual' \}\)\}/,
    'the Set button for a hosted-model-id must also send routing:manual',
  );
});

test('the Auto/Manual segment toggle is untouched by the #384 fix (it never sends a model)', () => {
  assert.match(src, /onClick=\{\(\) => void save\('routing', \{ routing: mode \}\)\}/);
});

test('the segment reads live off activeProject.routing, so reopening the popup reflects whatever was last persisted', () => {
  assert.match(src, /const auto = activeProject\?\.routing === 'auto';/);
});
