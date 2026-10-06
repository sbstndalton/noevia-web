'use strict';
// #343/#336 follow-up: LibraryTab.tsx gated Tune/Delete only on isSystemModel (Laya), not on the
// embedding/reranking models a live sidecar depends on, nor on non-chat models generally (the
// Overview copy says tuning is for chat models only). This repo has no jsdom/@testing-library
// available to actually render the component (see library-tab-delete-error.test.cjs for the same
// source-pattern approach used elsewhere in this file's test history), so this asserts the guard
// conditions directly against the source, the same way that regression already does.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/models/LibraryTab.tsx'), 'utf8');

test('ModelCard imports the chat-generation-model check and derives protectedModel from the distinct sidecarProtected field, not canDelete', () => {
  assert.match(src, /import \{ isChatGenerationModel \} from '\.\.\/\.\.\/model-kind';/);
  assert.match(src, /const chatModel = isChatGenerationModel\(m\.name, m\.labels\);/);
  assert.match(src, /const protectedModel = !system && m\.sidecarProtected === true;/);
  assert.doesNotMatch(src, /const protectedModel = .*canDelete/, 'protectedModel must not be derived from canDelete: canDelete can be false for unrelated reasons and DeleteModel already falls back to the folder-scan path in that case');
});

test('Tune is hidden for any non-chat (embedding/reranking) model, not just Laya', () => {
  // #421: the button also carries a per-model aria-label now, between className and onClick.
  assert.match(src, /\{!system && !missing && chatModel && <button className="popup-tab" aria-label=\{t\('mm\.card\.tuneNamed', \{ model: m\.name \}\)\} onClick=\{onConfigure\}>\{t\('mm\.card\.tune'\)\}<\/button>\}/);
});

test('Delete is hidden for a model a live sidecar depends on (protectedModel), matching the system-model treatment', () => {
  assert.match(src, /\{!system && !protectedModel && <DeleteModel model=\{m\} file=\{file\} onDeleted=\{onDeleted\}\/>\}/);
});

test('the meta row shows a short "protected" tag (with a title explaining why) for a sidecar-dependent model', () => {
  assert.match(src, /\{protectedModel && <span className="model-card-tag" title=\{t\('mm\.card\.protectedTitle'\)\}>\{t\('mm\.card\.protectedLabel'\)\}<\/span>\}/);
});

test('the expanded detail note distinguishes system, sidecar-protected, and merely non-chat models', () => {
  assert.match(src, /protectedModel \? <p className="mm-note" role="status">\{t\('mm\.card\.protectedLabel'\)\}\{t\('mm\.card\.protectedNote'\)\}<\/p>/);
  assert.match(src, /: missing \? null\n\s*: !chatModel \? <p className="mm-note" role="status">\{t\('mm\.card\.nonChatNote'\)\}<\/p>/);
});

test('DeleteModel\'s own canDelete fallback (folder-scan delete path) is untouched by the sidecarProtected guard', () => {
  assert.match(src, /if \(m\.canDelete !== false && m\.source !== 'preset'\) \{/, 'a model with canDelete:false but sidecarProtected:false must still be able to delete through the folder-scan fallback');
});

test('every new mm.card.* key referenced by LibraryTab is defined in the English base catalogue', () => {
  const enGB = fs.readFileSync(path.join(__dirname, '../../src/i18n/models/en-GB.ts'), 'utf8');
  for (const key of ['mm.card.protectedLabel', 'mm.card.protectedTitle', 'mm.card.protectedNote', 'mm.card.nonChatNote']) {
    assert.match(src, new RegExp(key.replace(/[.]/g, '\\.')), `${key} referenced in LibraryTab.tsx`);
    assert.match(enGB, new RegExp(`'${key.replace(/[.]/g, '\\.')}':`), `${key} defined in en-GB.ts`);
  }
});
