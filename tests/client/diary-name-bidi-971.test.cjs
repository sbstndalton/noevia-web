// #971 follow-up: Diary views render storage file and folder names from an untrusted WebDAV server.
// Names with bidi controls are skipped server-side, but other right-to-left or confusable
// characters stay legal, so each rendered name sits in <bdi>. Synthetic source check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/components', f), 'utf8');
const cases = [
  ['DiaryContextPanel.tsx', ['{file.name}']],
  ['DiaryMarkdownWorkspace.tsx', ['{file.name}', '{match.name}', '{match.path}']],
  ['DiaryView.tsx', ['{record.folder.name}', '{file.name}']],
];
for (const [file, exprs] of cases) {
  test(`${file} isolates rendered storage names with <bdi>`, () => {
    const src = read(file);
    for (const e of exprs) {
      // Rendered as JSX text (attribute uses like key={...} are not text).
      const rendered = (src.match(new RegExp(`(?<![=(])${e.replace(/[.{}]/g, '\\$&')}`, 'g')) || []).length;
      assert.ok(rendered > 0, `${e} not found`);
      assert.equal(src.split(`<bdi>${e}</bdi>`).length - 1, rendered, `${e} rendered outside <bdi>`);
    }
  });
}
