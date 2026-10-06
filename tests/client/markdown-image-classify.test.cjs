'use strict';
// #390: the pure classifier behind the Markdown image decision (auto-load only what never leaves
// the server; a remote source becomes a click-to-load chip instead — see markdown-image.ts for
// the PRODUCT.md reasoning). Rendering itself is covered in markdown-render.test.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../src/markdown-image.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const exports_ = {};
vm.runInNewContext(code, { exports: exports_, URL });
const { classifyImageSrc, imageHost } = exports_;

test('a data: URI of an image type <img> can actually decode is inline — nothing to fetch, so nothing to ask about', () => {
  assert.equal(classifyImageSrc('data:image/png;base64,iVBORw0KGgo='), 'inline');
  assert.equal(classifyImageSrc('data:image/jpeg;base64,/9j/4AAQ='), 'inline');
  assert.equal(classifyImageSrc('data:image/webp;base64,UklGRg=='), 'inline');
});

test('an https/http URL is remote — a fetch the reader has to ask for, never automatic', () => {
  assert.equal(classifyImageSrc('https://picsum.photos/40'), 'remote');
  assert.equal(classifyImageSrc('http://example.com/pic.png'), 'remote');
});

test('anything this renderer has no sanitiser for is unsafe: never a live element, same as an unrecognised link', () => {
  assert.equal(classifyImageSrc('javascript:alert(1)'), 'unsafe');
  assert.equal(classifyImageSrc('data:text/html,<script>alert(1)</script>'), 'unsafe');
  assert.equal(classifyImageSrc('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), 'unsafe', 'svg is excluded even though it decodes — see the file comment');
  assert.equal(classifyImageSrc('ftp://example.com/pic.png'), 'unsafe');
  assert.equal(classifyImageSrc('/uploads/pic.png'), 'unsafe', 'no same-origin sanitiser exists yet for a bare path — do not invent one here');
  assert.equal(classifyImageSrc('mailto:a@b.com'), 'unsafe');
});

test('imageHost reads the host a click-to-load chip would actually fetch from', () => {
  assert.equal(imageHost('https://picsum.photos/40'), 'picsum.photos');
  assert.equal(imageHost('http://example.com:8080/x.png'), 'example.com:8080');
});

test('imageHost degrades to the raw source rather than throwing on something unparseable', () => {
  assert.equal(imageHost('not a url'), 'not a url');
});
