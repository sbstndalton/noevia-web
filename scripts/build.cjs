#!/usr/bin/env node
// Wraps `vite build` so extra CLI args (e.g. `--outDir`) reach vite, and then
// stamps the icon/manifest cache-busting query in whatever directory vite
// actually wrote to. `npm run build -- --outDir X` appends its extra args to
// the end of the whole npm script line, not just the first command in it, so
// a plain `vite build && node scripts/stamp-icons.cjs` script would hand
// `--outDir X` to stamp-icons instead of to vite.
//
// Also resolves STAMP_VERSION once, here, and pins it into the environment
// of both child processes — vite (which bakes it into __NOEVIA_BUILD__ via
// the `define` in vite.config.ts) and stamp-icons (which writes it into
// dist/version.json and the icon/manifest query strings) — so they always
// agree. The Dockerfile sets STAMP_VERSION from COWORK_VERSION (the release
// SHA compose.yaml already threads through as a build arg); a local
// `npm run build` with nothing set falls back to package.json's version plus
// a build timestamp, so two local builds a minute apart still get different
// version.json contents instead of silently matching each other.
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');

const args = process.argv.slice(2);
const outDirFlagIndex = args.indexOf('--outDir');
const outDir = outDirFlagIndex !== -1 && args[outDirFlagIndex + 1]
  ? path.resolve(args[outDirFlagIndex + 1])
  : path.join(__dirname, '..', 'dist');

const incoming = process.env.STAMP_VERSION;
// "dev" is compose.yaml's own default for COWORK_VERSION when nothing is
// exported (${COWORK_VERSION:-dev}); treat it the same as unset rather than
// stamping the literal string "dev" on every local/default build.
const version = incoming && incoming !== 'dev' ? incoming : `${pkg.version}+${Date.now().toString(36)}`;
const childEnv = { ...process.env, STAMP_VERSION: version };

const vite = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'),
  'build', '--configLoader', 'runner', ...args,
], { stdio: 'inherit', env: childEnv });
if (vite.status !== 0) process.exit(vite.status || 1);

const stamp = spawnSync(process.execPath, [path.join(__dirname, 'stamp-icons.cjs'), outDir], { stdio: 'inherit', env: childEnv });
process.exit(stamp.status || 0);
