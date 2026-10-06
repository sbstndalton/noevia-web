// #948: the Diary "last backed up" date follows the interface language (appLocale()), not the
// browser default. Synthetic source check; the behaviour of the model-manager fixes is covered by
// qa/download-errors-948.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('DiaryStorageStatus formats lastBackedUp with appLocale()', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryStorageStatus.tsx'), 'utf8');
  assert.match(src, /import \{ appLocale \} from '\.\.\/user-preferences'/);
  assert.match(src, /new Date\(status\.lastBackedUp \* 1000\)\.toLocaleString\(appLocale\(\)\)/);
  assert.doesNotMatch(src, /toLocaleString\(\)/, 'a bare toLocaleString() ignores the interface language');
});
