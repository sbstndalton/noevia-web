// #971: storage listing names come from an untrusted WebDAV server. The server skips names with bidi
// controls, but other right-to-left or confusable characters remain legal, so every listed name is
// rendered inside <bdi> and cannot reorder the surrounding UI text. Synthetic source check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const file of ['StorageFileBrowser.tsx', 'FolderPicker.tsx']) {
  test(`${file} isolates every listed name with <bdi>`, () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/components', file), 'utf8');
    const uses = src.match(/\{e\.name\}/g) || [];
    assert.ok(uses.length > 0);
    assert.equal((src.match(/<bdi>\{e\.name\}<\/bdi>/g) || []).length, uses.length, 'an e.name rendered outside <bdi>');
  });
}
