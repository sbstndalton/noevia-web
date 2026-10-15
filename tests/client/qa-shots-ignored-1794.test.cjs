// noevia#1794: QA screenshots were committed under qa-shots-1784-1789/. Screenshots stay outside the
// repo (scripts write them to $QA_SHOTS); the folder pattern is ignored so a stray run cannot add them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

test('.gitignore ignores qa-shots folders', () => {
  const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(lines.some((l) => /^\/?qa-shots\*\/?$/.test(l)), 'qa-shots*/ is ignored');
});

test('no PNG screenshots are kept in the repository root or qa/', () => {
  for (const dir of ['.', 'qa']) {
    const found = fs.readdirSync(path.join(root, dir), { withFileTypes: true })
      .filter((e) => (e.isDirectory() && /^qa-shots/.test(e.name)) || (e.isFile() && e.name.endsWith('.png')))
      .map((e) => path.join(dir, e.name));
    assert.deepEqual(found, [], `screenshots in the repo: ${found.join(', ')}`);
  }
});
