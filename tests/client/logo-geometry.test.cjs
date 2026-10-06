const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { outputs } = require('../../scripts/logo-geometry.cjs');

test('committed leaf-mark outputs match scripts/logo-geometry.cjs (rerun it if this fails)', () => {
  const root = path.join(__dirname, '../..');
  for (const [rel, expected] of Object.entries(outputs())) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), expected, `${rel} drifted from the generator; run: node scripts/logo-geometry.cjs`);
  }
});

test('the generator is deterministic and emits per-instance id tokens', () => {
  const a = outputs(), b = outputs();
  assert.deepEqual(a, b);
  assert.match(a['src/components/leafLogoGeometry.ts'], /@ID-/);
  assert.doesNotMatch(a['public/icon.svg'], /@ID/);
  assert.doesNotMatch(a['public/icon-maskable.svg'], /@ID/);
});
