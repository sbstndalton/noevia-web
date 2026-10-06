#!/usr/bin/env node
// Repo-split guard (#897, docs/adr-0001-rust-and-repo-split.md): src/ (the future noevia-web)
// and server/ (the future noevia-core) must not import each other. Data both sides read lives in
// contracts/. Fails with one line per offending import; reading the other side's files as text
// (fs.readFileSync in a test) is not an import and is not flagged.
//
// Usage: node scripts/check-boundaries.cjs [apps/web root]
const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set(['node_modules', 'ui-data', 'dist']);
const SOURCE_EXT = /\.(c|m)?(j|t)sx?$/;
// import x from '...', export ... from '...', import '...', import('...'), require('...')
const SPECIFIER = /\bfrom\s*(['"])([^'"\n]+)\1|\bimport\s*(['"])([^'"\n]+)\3|\b(?:import|require)\s*\(\s*(['"`])([^'"`\n]+)\5\s*\)/g;

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function findViolations(root) {
  const src = path.join(root, 'src');
  const server = path.join(root, 'server');
  const rules = [
    { from: src, forbidden: server, label: 'src/ must not import from server/' },
    { from: server, forbidden: src, label: 'server/ must not import from src/' },
  ];
  const violations = [];
  for (const rule of rules) {
    for (const file of walk(rule.from, [])) {
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(SPECIFIER)) {
          const spec = match[2] || match[4] || match[6];
          if (!spec || !(spec.startsWith('.') || path.isAbsolute(spec))) continue;
          const target = path.resolve(path.dirname(file), spec);
          if (inside(target, rule.forbidden)) {
            violations.push({
              file: path.relative(root, file), line: index + 1, specifier: spec, rule: rule.label,
            });
          }
        }
      });
    }
  }
  return violations;
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const violations = findViolations(root);
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.rule} ('${v.specifier}')`);
  if (violations.length) {
    console.error(`check-boundaries: ${violations.length} cross-boundary import(s). Move shared data to contracts/.`);
    process.exit(1);
  }
  console.log('check-boundaries: src/ and server/ do not import each other.');
}

module.exports = { findViolations };
