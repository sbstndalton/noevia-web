const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '../..');
const pkgVersion = require('../../package.json').version;

// These tests assert against a specific stamped version, so they must not be
// at the mercy of whatever STAMP_VERSION happens to be set in the ambient
// environment (issue #317: the Docker build sets STAMP_VERSION to the
// release SHA for the real `npm run build`/`node --test` step, which broke
// every test here that assumed the STAMP_VERSION-less fallback). Each spawn
// below passes its own explicit env, deleting any inherited STAMP_VERSION
// unless a test means to exercise the override.
function envWithout(extra) {
  const env = { ...process.env };
  delete env.STAMP_VERSION;
  return { ...env, ...extra };
}

function fixtureDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-icons-'));
  fs.writeFileSync(path.join(dir, 'index.html'), [
    '<!doctype html><html><head>',
    '<link rel="icon" href="/icon.svg" type="image/svg+xml" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '</head><body></body></html>',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({
    name: 'noevia',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' },
      { src: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { src: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
  }));
  return dir;
}

test('stamps a version query onto every icon/manifest URL, leaving other filenames alone', () => {
  const dir = fixtureDist();
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'stamp-icons.cjs'), dir], { encoding: 'utf8', env: envWithout() });
  assert.equal(run.status, 0, run.stderr);

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, new RegExp(`href="/icon\\.svg\\?v=${pkgVersion}"`));
  assert.match(html, new RegExp(`href="/apple-touch-icon\\.png\\?v=${pkgVersion}"`));
  // Not an icon file: untouched.
  assert.match(html, /href="\/manifest\.webmanifest"/);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.match(icon.src, new RegExp(`\\?v=${pkgVersion}$`));
  // apple-touch-icon.png must keep its full name, not get truncated to icon.png.
  assert.ok(manifest.icons.some((i) => i.src.startsWith('/apple-touch-icon.png?v=')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('writes version.json with the same version used to stamp the URLs', () => {
  const dir = fixtureDist();
  spawnSync(process.execPath, [path.join(root, 'scripts', 'stamp-icons.cjs'), dir], { env: envWithout() });
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8'));
  assert.equal(version.version, pkgVersion);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('is idempotent: running twice does not double-stamp the query string', () => {
  const dir = fixtureDist();
  const script = path.join(root, 'scripts', 'stamp-icons.cjs');
  const env = envWithout();
  spawnSync(process.execPath, [script, dir], { env });
  spawnSync(process.execPath, [script, dir], { env });
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal((html.match(/\?v=/g) || []).length, 2); // icon.svg + apple-touch-icon.png, once each
  fs.rmSync(dir, { recursive: true, force: true });
});

test('honours STAMP_VERSION as an override', () => {
  const dir = fixtureDist();
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'stamp-icons.cjs'), dir], {
    encoding: 'utf8', env: envWithout({ STAMP_VERSION: '20a24c2' }),
  });
  assert.equal(run.status, 0, run.stderr);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /href="\/icon\.svg\?v=20a24c2"/);
  fs.rmSync(dir, { recursive: true, force: true });
});
