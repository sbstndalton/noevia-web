'use strict';
// #437: dropping a file onto the composer/chat pane must run through the exact same attachment
// pipeline the existing "+" picker uses — same validation, size limits and error copy — never a
// second upload path. `uploadAttachments` is the one implementation both the picker (inside
// ComposerActions) and `useAttachmentDrop` call; this pins that sharing at the source level and
// checks the drop hook ignores non-file drags. The real drag/drop DOM behaviour (no jsdom in this
// repo) and the "oversize file shows the picker's own error" case are proven in the browser by
// apps/web/qa/composer-434.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const actionsSrc = fs.readFileSync(path.join(__dirname, '../../src/components/ComposerActions.tsx'), 'utf8');
const chatSrc = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');

test('there is exactly one attachment upload implementation, exported so a drop handler can call it too', () => {
  assert.match(actionsSrc, /export async function uploadAttachments\(sink: AttachmentSink, files: File\[\], t: Translate\): Promise<void> \{/);
  const occurrences = actionsSrc.match(/uploadProjectFile\(/g) || [];
  assert.equal(occurrences.length, 1, 'uploadProjectFile should be called from exactly one place (uploadAttachments), not duplicated for drop');
});

test('the file-input picker\'s own upload() delegates to uploadAttachments rather than reimplementing it', () => {
  const upload = actionsSrc.slice(actionsSrc.indexOf('const upload = async (files: File[])'), actionsSrc.indexOf('return <div className="composer-actions"'));
  assert.match(upload, /await uploadAttachments\(\{ project, disabled, diary, chatOnly, onChanged, onBusy, onStatus \}, files, t\);/);
});

test('a drag not carrying files (a dragged link or text selection) is left alone, not treated as an empty drop', () => {
  assert.match(actionsSrc, /function isFileDrag\(event: DragEvent\): boolean \{/);
  assert.match(actionsSrc, /return !!types && Array\.from\(types\)\.includes\('Files'\);/);
  const dropFn = actionsSrc.slice(actionsSrc.indexOf('const onDrop = (event: DragEvent) => {'), actionsSrc.indexOf('return { isDragOver, dropProps'));
  assert.match(dropFn, /if \(!isFileDrag\(event\)\) return;/);
});

test('the drop hook never uploads while disabled or without a project, matching the picker\'s own button state', () => {
  assert.match(actionsSrc, /const canDrop = !sink\.disabled && !!sink\.project;/);
  const dropFn = actionsSrc.slice(actionsSrc.indexOf('const onDrop = (event: DragEvent) => {'), actionsSrc.indexOf('return { isDragOver, dropProps'));
  assert.match(dropFn, /if \(!canDrop\) return;/);
});

test('multiple dropped files all go through the same per-file loop as the picker (no special-casing a single file)', () => {
  const dropFn = actionsSrc.slice(actionsSrc.indexOf('const onDrop = (event: DragEvent) => {'), actionsSrc.indexOf('return { isDragOver, dropProps'));
  assert.match(dropFn, /const files = Array\.from\(event\.dataTransfer\?\.files \?\? \[\]\);/);
  assert.match(dropFn, /if \(files\.length\) void uploadAttachments\(sink, files, t\);/);
});

test('ChatView wires the drop handlers onto the whole chat pane, not just the composer bar, with a visible drag-over state and an accessible announcement', () => {
  assert.match(chatSrc, /import \{ ComposerActions, useAttachmentDrop \} from '\.\/ComposerActions';/);
  assert.match(chatSrc, /const \{ isDragOver, dropProps \} = useAttachmentDrop\(\{/);
  assert.match(chatSrc, /className=\{`main chat-workspace\$\{messages\.length === 0 \? ' is-empty' : ''\}\$\{isDragOver \? ' is-drag-over' : ''\}`\} \{\.\.\.dropProps\}/);
  assert.match(chatSrc, /<div className="chat-drop-overlay" aria-hidden="true"><span>\{t\('composer\.dropHint'\)\}<\/span><\/div>/);
  assert.match(chatSrc, /<span className="sr-only" role="status" aria-live="polite">\{isDragOver \? t\('composer\.dropHint'\) : ''\}<\/span>/);
});

test('the drop hint string is registered in every real locale catalogue, not only English', () => {
  const locales = ['de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE'];
  for (const locale of locales) {
    const text = fs.readFileSync(path.join(__dirname, `../../src/i18n/${locale}.ts`), 'utf8');
    assert.match(text, /'composer\.dropHint':/, `${locale}.ts is missing composer.dropHint`);
  }
});
