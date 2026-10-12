'use strict';
// #1297: "Upload files" was a styled <label> around a display:none file input with tabindex -1, so
// Tab skipped it and no keyboard user could open the picker. It is a native button now that opens
// the picker through a ref; Enter and Space on a focused button are a click. This test pins that
// wiring against the source (the repo has no DOM harness; see project-view-delete-chat-confirm).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ProjectView.tsx'), 'utf8');

test('Upload files is a native, focusable button, not a label', () => {
  assert.doesNotMatch(src, /<label className=\{`btn btn-secondary btn-sm\$\{busyDocs \? ' is-busy' : ''\}`\}>/, 'the upload control is no longer a label');
  const button = src.match(/<button type="button" className=\{`btn btn-secondary btn-sm\$\{busyDocs \? ' is-busy' : ''\}`\}[\s\S]*?<\/button>/);
  assert.ok(button, 'expected the Upload files button');
  assert.match(button[0], /onClick=\{\(\) => uploadInput\.current\?\.click\(\)\}/, 'it opens the picker');
  assert.match(button[0], /disabled=\{busyDocs\}/, 'it is disabled while an upload runs');
  assert.match(button[0], /t\('projects\.view\.uploadFiles'\)/, 'its accessible name is the Upload files copy');
});

test('the file input is reached through a ref and is not made a tab stop of its own', () => {
  assert.match(src, /const uploadInput = useRef<HTMLInputElement>\(null\);/);
  const input = src.match(/<input ref=\{uploadInput\}[\s\S]*?\/>/);
  assert.ok(input, 'the file input carries the ref');
  assert.match(input[0], /type="file"/);
  assert.match(input[0], /display: 'none'/, 'the input stays hidden; the button is the visible control');
  assert.doesNotMatch(input[0], /tabIndex=\{0\}/);
});
