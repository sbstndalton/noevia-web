const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');

// Issue #311: after 20a24c2 shipped the new leaf mark, a duplicated drawing of
// the old two-square mark could in principle still ship in the built bundle
// (a new call site that didn't go through the shared Logo component, or a
// stale dist from a partial build). This builds the real dist and greps it,
// so a future regression is caught in CI rather than by a user's browser.
test('the built dist never contains the old two-square logo geometry or colours', () => {
  const root = path.join(__dirname, '../..');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-dist-check-'));
  try {
    const build = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.cjs'), '--outDir', outDir], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
    });
    assert.equal(build.status, 0, `build failed:\n${build.stdout}\n${build.stderr}`);

    const files = [];
    (function walk(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) walk(full);
        else if (/\.(js|html|svg|json|webmanifest)$/.test(item.name)) files.push(full);
      }
    })(outDir);
    assert.ok(files.length > 0, 'expected build output under ' + outDir);

    // The old mark: two rounded squares, corner radius 3.5, with #9aa0e4 as
    // the highlight fill. Neither has any legitimate use outside that old
    // drawing (unlike #4f56ab, which is also the real brand primary colour
    // used for theme-color and --md-primary, so it is deliberately not
    // checked here). A hit means an old drawing snuck back in somewhere that
    // does not go through the shared Logo/icon.svg source.
    const OLD_MARKERS = [/rx="3\.5"/, /#9aa0e4/i];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const marker of OLD_MARKERS) {
        assert.doesNotMatch(text, marker, `${path.relative(outDir, file)} contains old-logo marker ${marker}`);
      }
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
