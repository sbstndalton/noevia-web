#!/usr/bin/env node
'use strict';
// Icon tone audit (#1623). Every icon drawn in src/ is either decorative (information only: two-tone,
// one inner part in the theme accent) or a control (anything you can press: one neutral colour).
// This walks the TSX source with the TypeScript parser and reports, for each icon element, the tone
// it renders with and the nearest pressable thing around it in the same JSX tree, so the
// classification can be reviewed in one table and tests/client/icon-tones.test.cjs can hold the rule
// "a decorative icon is never inside a control".
//
//   node scripts/icon-tone-audit.cjs            markdown table (file, line, icon, tone, context)
//   node scripts/icon-tone-audit.cjs --json     the same rows as JSON
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
/** Components that render one vendored icon, and the tone each renders with when none is given. */
const ICON_COMPONENTS = { Icon: 'control', ShellIcon: 'control', PlusIcon: 'control', SlidersIcon: 'control', ChevronDown: 'control', ChevronLeft: 'control', ArrowRight: 'control', SendIcon: 'control' };
/** Elements and roles that are pressable. A decorative icon may not sit inside any of them. */
const INTERACTIVE_TAGS = new Set(['button', 'a', 'summary', 'select', 'option', 'label']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'tab', 'option', 'switch', 'checkbox', 'radio', 'treeitem']);
/** Object keys whose JSX value a menu renders inside a role="menuitem" button (ContextMenu). */
const MENU_ICON_KEYS = new Set(['icon']);

function* tsxFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* tsxFiles(full);
    else if (/\.tsx$/.test(entry.name)) yield full;
  }
}

const tagName = (node) => (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
const attributes = (node) => (ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes).properties;
function attr(node, name) {
  const a = attributes(node).find((p) => ts.isJsxAttribute(p) && p.name.getText() === name);
  if (!a) return undefined;
  if (!a.initializer) return true;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  const expr = a.initializer.expression;
  if (expr && (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))) return expr.text;
  return expr ? `{${expr.getText()}}` : true;
}

/** Why this element is pressable, or '' when it is not. */
function pressable(node) {
  const tag = tagName(node);
  if (INTERACTIVE_TAGS.has(tag)) return `<${tag}>`;
  const role = attr(node, 'role');
  if (typeof role === 'string' && INTERACTIVE_ROLES.has(role)) return `role="${role}"`;
  if (attr(node, 'onClick') !== undefined) return `<${tag} onClick>`;
  return '';
}

/** The nearest pressable context of an icon element, walking up the JSX tree it is written in. */
function context(node) {
  const trail = [];
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) {
      const why = pressable(p);
      if (why) return { interactive: true, where: why, trail };
      const cls = attr(p, 'className');
      trail.push(typeof cls === 'string' ? `${tagName(p)}.${cls.split(/\s+/)[0]}` : tagName(p));
    }
    // A JSX value passed as a prop: the receiving component decides where it lands.
    if (ts.isJsxAttribute(p)) {
      const owner = p.parent.parent;
      const ownerTag = tagName(owner);
      if (INTERACTIVE_TAGS.has(ownerTag)) return { interactive: true, where: `<${ownerTag} ${p.name.getText()}>`, trail };
      return { interactive: false, where: `prop ${p.name.getText()} of <${ownerTag}>`, trail };
    }
    // { label, icon: <ShellIcon/> } in a menu definition: rendered inside a menu item.
    if (ts.isPropertyAssignment(p) && MENU_ICON_KEYS.has(p.name.getText())) return { interactive: true, where: 'menu item (icon:)', trail };
    if (ts.isFunctionDeclaration(p) || ts.isSourceFile(p)) break;
  }
  return { interactive: false, where: trail[0] ? trail[0] : 'top level', trail };
}

/** Every icon element in src/: { file, line, component, icon, tone, explicit, interactive, where }. */
function audit(srcDir = path.join(ROOT, 'src')) {
  const rows = [];
  for (const file of tsxFiles(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && Object.hasOwn(ICON_COMPONENTS, tagName(node))) {
        const component = tagName(node);
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        // The named wrappers in Icons.tsx and the ShellIcon/Icon definitions themselves are plumbing.
        const isDefinition = /src\/components\/(Icons|ShellIcon)\.tsx$/.test(rel) && (component === 'Icon');
        if (!isDefinition) {
          const toneAttr = attr(node, 'tone');
          const name = attr(node, 'name');
          const ctx = context(node);
          rows.push({
            file: rel,
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            component,
            icon: typeof name === 'string' ? name : name === undefined ? component : name,
            tone: typeof toneAttr === 'string' ? toneAttr : toneAttr === undefined ? ICON_COMPONENTS[component] : toneAttr,
            explicit: toneAttr !== undefined,
            interactive: ctx.interactive,
            where: ctx.where,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

module.exports = { audit, ICON_COMPONENTS, INTERACTIVE_TAGS, INTERACTIVE_ROLES };

if (require.main === module) {
  const rows = audit();
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(rows, null, 2) + '\n'); return; }
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  console.log('| File | Line | Icon | Tone | Context |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const r of rows) console.log(`| ${cell(r.file.replace(/^src\//, ''))} | ${r.line} | ${cell(r.icon)} | ${r.tone} | ${cell(r.where)} |`);
  const count = (tone) => rows.filter((r) => r.tone === tone).length;
  console.log(`\n${rows.length} icon elements: ${count('decorative')} decorative, ${count('control')} control.`);
}
