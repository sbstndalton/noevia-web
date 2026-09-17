#!/usr/bin/env node
'use strict';
// Deterministic design checks kept from a one-off Impeccable 4.1.0 triage (D4, 2026-09-17).
// Dev-only, no dependencies, never shipped in the image. Usage: npm run lint:design [paths...]
//
// Rules:
//   side-tab       a colored border of 2px+ on one side of a box — the most recognisable
//                  "generated UI" accent. Blockquotes are exempt (a quotation rule is typography).
//   overshoot-ease cubic-bezier control points outside 0..1 on the y axis (bounce/elastic motion).
//   gradient-text  background-clip: text.
// Silence a deliberate case on the line itself or the line above:  /* design-lint: allow <rule> — reason */
const fs = require('node:fs');
const path = require('node:path');

function* files(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) { if (/\.(css|tsx)$/.test(target)) yield target; return; }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    yield* files(path.join(target, entry.name));
  }
}

function lint(text, file = '') {
  const findings = [];
  const lines = text.split('\n');
  let selector = '';
  const allowed = (i, rule) => [lines[i], lines[i - 1] || ''].some((l) => new RegExp(`design-lint: allow ${rule}\\b`).test(l));
  lines.forEach((line, i) => {
    const open = line.lastIndexOf('{');
    if (open >= 0) selector = line.slice(0, open).trim() || selector;
    const push = (rule, message) => { if (!allowed(i, rule)) findings.push({ file, line: i + 1, rule, message, snippet: line.trim().slice(0, 160) }); };
    for (const m of line.matchAll(/border-(left|right|inline-start|inline-end)(-width)?\s*:\s*([^;}]*)/g)) {
      const width = m[3].match(/(\d+(?:\.\d+)?)px/);
      if (width && Number(width[1]) >= 2 && !/blockquote/i.test(selector)) push('side-tab', `${m[3].trim()} on one side of ${selector || 'a box'}`);
    }
    for (const m of line.matchAll(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g)) {
      const [y1, y2] = [Number(m[2]), Number(m[4])];
      if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) push('overshoot-ease', `${m[0]} overshoots; use an ease-out curve`);
    }
    for (const _ of line.matchAll(/background-clip\s*:\s*text/g)) push('gradient-text', 'gradient text');
  });
  return findings;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(root, 'src')];
  const all = [];
  for (const target of targets) for (const file of files(path.resolve(target))) all.push(...lint(fs.readFileSync(file, 'utf8'), path.relative(root, file)));
  for (const f of all) console.error(`${f.file}:${f.line}  ${f.rule}  ${f.message}\n    ${f.snippet}`);
  console.log(all.length ? `design lint: ${all.length} finding${all.length === 1 ? '' : 's'}` : 'design lint: clean');
  process.exitCode = all.length ? 1 : 0;
}

module.exports = { lint };
