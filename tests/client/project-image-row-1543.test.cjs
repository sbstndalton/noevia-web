'use strict';
// #1543: an image source's row showed a letterboxed thumbnail that could not be read, then a generic
// document glyph beside the name, so it did not match the document rows. The thumbnail is the row's
// icon now (no document glyph on an image row), and it fills its square so the preview is readable.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ProjectView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../src/styles/noevia.css'), 'utf8');

test('an image row has no separate document glyph; document rows keep theirs', () => {
  assert.match(src, /\{f\.attachment\?\.assetId \? null : <ShellIcon name="file"(?: tone="decorative")?\/>\}/);
  assert.match(src, /\{f\.attachment\?\.assetId && <img className="source-thumbnail"/, 'the thumbnail still shows for an image row');
});

test('the thumbnail fills its square so the image is readable', () => {
  const rule = css.match(/\.source-thumbnail\s*\{[^}]*\}/);
  assert.ok(rule, 'the .source-thumbnail rule exists');
  assert.match(rule[0], /object-fit:\s*cover/);
  assert.doesNotMatch(rule[0], /object-fit:\s*contain/);
});
