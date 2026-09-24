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
//   type-scale     a font-size in px/rem off the type scale (tokens.css --text-*); em, % and
//                  keywords stay allowed because they are relative to a scale step.
//   font-weight    a weight other than 400/500/600/700 (HIG: no in-between weights). A weight may
//                  come from a --*-weight token (theme families pick their display weight, #249);
//                  the token's own declaration is then held to the same four weights.
//   transition-all `transition: all` or `transition-property: all`, or a shorthand with no property
//                  (which means all): name what animates (#247). motion.css is exempt from both
//                  motion rules: it holds the reduced-motion floor and describes the contract.
//   motion-token   a literal duration in a transition or animation; use the motion contract in
//                  tokens.css (--motion-immediate/-quick/-considered/-async). tokens.css defines them.
//   undefined-token  var(--x) where --x is defined in no stylesheet or script (a fallback such as
//                  var(--surface, #fff) then silently pins one theme's colour).
// Silence a deliberate case on the line itself or the line above:  /* design-lint: allow <rule> — reason */
const fs = require('node:fs');
const path = require('node:path');

function* files(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) { if (/\.(css|tsx?|js)$/.test(target) && !/\.min\.js$/.test(target)) yield target; return; }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    yield* files(path.join(target, entry.name));
  }
}

// Mirrors the --text-* tokens in src/styles/tokens.css (HIG text styles, sized for the web).
const TYPE_SCALE = new Set([11, 12, 13, 14, 15, 16, 17, 20, 22, 26, 32, 40, 52]);
const WEIGHTS = new Set(['400', '500', '600', '700', 'normal', 'bold', 'inherit']);

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
    for (const m of line.matchAll(/(?<![-\w])font-size\s*:\s*([\d.]+)(px|rem)\b/g)) {
      if (m[2] === 'rem' || !TYPE_SCALE.has(Number(m[1]))) push('type-scale', `${m[1]}${m[2]} is off the type scale; use a --text-* token`);
    }
    for (const m of line.matchAll(/(?<![-\w])font-weight\s*:\s*(var\(\s*--[\w-]*weight[\w-]*[^)]*\)|[\w]+)/g)) {
      if (!m[1].startsWith('var(') && !WEIGHTS.has(m[1])) push('font-weight', `weight ${m[1]}; use 400, 500, 600 or 700`);
    }
    for (const m of line.matchAll(/--[\w-]*weight[\w-]*\s*:\s*([\w]+)/g)) {
      if (!WEIGHTS.has(m[1])) push('font-weight', `weight token ${m[1]}; use 400, 500, 600 or 700`);
    }
    // motion.css owns the reduced-motion floor (1ms) and documents the rules in prose.
    if (/\.css$/.test(file) && !/(^|\/)motion\.css$/.test(file)) {
      for (const m of line.matchAll(/(?<![-\w])transition(-property)?\s*:\s*([^;}]*)/g)) {
        const value = m[2].trim();
        if (/^all\b|,\s*all\b/.test(value) || (!m[1] && /^(?:var\(|[\d.]+m?s\b|ease|linear|cubic-bezier)/.test(value))) push('transition-all', `transition: ${value.slice(0, 40)} animates every property; name them`);
      }
      if (!/tokens\.css$/.test(file)) for (const m of line.matchAll(/(?<![-\w])(transition|animation)(-duration|-delay)?\s*:\s*([^;}]*)/g)) {
        if (/(?<![\w.-])\d*\.?\d+m?s\b/.test(m[3].replace(/var\([^)]*\)/g, '')) && !/^\s*(none|0m?s)\s*$/.test(m[3])) push('motion-token', `${m[1]}${m[2] || ''}: ${m[3].trim().slice(0, 50)} uses a literal duration; use a --motion-* token`);
      }
    }
  });
  return findings;
}

/** Cross-file: custom properties referenced but never defined (CSS, style objects or setProperty). */
function undefinedTokens(files) {
  const defined = new Set();
  for (const { text } of files) {
    for (const m of text.matchAll(/(--[\w-]+)['"]?\s*:/g)) defined.add(m[1]);
    for (const m of text.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) defined.add(m[1]);
  }
  const findings = [];
  for (const { file, text } of files) {
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[\w-]+)/g)) if (!defined.has(m[1])) findings.push({ file, line: i + 1, rule: 'undefined-token', token: m[1], message: `${m[1]} is not defined anywhere`, snippet: line.trim().slice(0, 160) });
    });
  }
  return findings;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  // public/ holds the scripts that set runtime tokens (viewport height, glass pointer position).
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(root, 'src'), path.join(root, 'public')];
  const all = [];
  const sources = [];
  for (const target of targets) for (const file of files(path.resolve(target))) sources.push({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') });
  for (const source of sources) all.push(...lint(source.text, source.file));
  all.push(...undefinedTokens(sources));
  for (const f of all) console.error(`${f.file}:${f.line}  ${f.rule}  ${f.message}\n    ${f.snippet}`);
  console.log(all.length ? `design lint: ${all.length} finding${all.length === 1 ? '' : 's'}` : 'design lint: clean');
  process.exitCode = all.length ? 1 : 0;
}

module.exports = { lint, undefinedTokens, TYPE_SCALE };
