#!/usr/bin/env node
// Appends a cache-busting `?v=<version>` query to every icon/manifest URL in
// the built dist, so a release always ships a fresh favicon and manifest
// icons even though Cloudflare (and browsers) cache /icon.svg,
// /apple-touch-icon.png, /icon-192.png and /icon-512.png by extension for
// hours, and those files live outside the hashed /assets/ bundle so their
// filenames never change on their own. See issue #311: after 20a24c2 shipped
// the new leaf mark, the JS bundle updated immediately (hashed filename) but
// the favicon stayed cached because its URL never changed.
//
// The version comes from package.json ("version"), bumped on every release
// that touches the icon files; deploy tooling that wants stronger uniqueness
// can override it with STAMP_VERSION (e.g. the release git SHA).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');
const version = process.env.STAMP_VERSION || pkg.version;
const distDir = process.argv[2] || path.join(__dirname, '..', 'dist');

const ICON_FILES = ['icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable.svg'];

function stampUrls(text) {
  let out = text;
  for (const name of ICON_FILES) {
    // Only stamp bare references (no existing query string) so re-running
    // the script is idempotent.
    const re = new RegExp(`(["'/])(${name.replace('.', '\\.')})(["'])`, 'g');
    out = out.replace(re, (_m, pre, file, post) => `${pre}${file}?v=${version}${post}`);
  }
  return out;
}

function stampFile(relPath) {
  const filePath = path.join(distDir, relPath);
  if (!fs.existsSync(filePath)) return false;
  const before = fs.readFileSync(filePath, 'utf8');
  const after = stampUrls(before);
  if (after !== before) fs.writeFileSync(filePath, after);
  return after !== before;
}

// version.json: fetched at runtime with `cache: 'no-store'` by
// src/stale-shell-guard.ts to detect a stale cached app shell (issue #311)
// regardless of any HTTP or platform cache on index.html/the JS bundle
// themselves. Must stay in sync with the __NOEVIA_BUILD__ define in
// vite.config.ts, which uses the same STAMP_VERSION/package.json version.
function writeVersionJson() {
  fs.writeFileSync(path.join(distDir, 'version.json'), JSON.stringify({ version }) + '\n');
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.error(`stamp-icons: dist dir not found at ${distDir}`);
    process.exit(1);
  }
  const changed = [];
  for (const rel of ['index.html', 'manifest.webmanifest']) {
    if (stampFile(rel)) changed.push(rel);
  }
  writeVersionJson();
  console.log(`stamp-icons: version=${version} stamped=${changed.join(', ') || '(none)'} wrote version.json`);
}

main();
