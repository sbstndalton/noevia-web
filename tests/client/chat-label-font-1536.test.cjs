// #1536: interface labels in a chat reply (Laya routing, "Thought for", "2 tool calls", the Local badge,
// the "Sources:" heading) were set in the chat font, which is monospace when the reader picks mono.
// The reply body keeps the chat font setting; the card around it uses the interface face.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '../../src/styles/noevia.css'), 'utf8');

// Every rule whose selector list includes `selector` and that sets font-family, in source order.
function fontRulesFor(selector) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    const selectors = m[1].split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim().split(/\s+/).pop());
    if (!selectors.includes(selector)) continue;
    const font = /font-family\s*:\s*([^;]+);/.exec(m[2]);
    if (font) rules.push(font[1].trim());
  }
  return rules;
}

test('#1536 the reply card is set in the interface font, not the chat font', () => {
  const cardFonts = fontRulesFor('.assistant-card');
  assert.ok(cardFonts.length > 0, 'the card has a font rule');
  assert.equal(cardFonts.at(-1), 'var(--font-ui)', 'the last font rule that applies to the card is the interface face');
  assert.ok(!cardFonts.some((f) => f.includes('--font-chat')), 'the card never takes the chat font');
});

test('#1536 the reply body still follows the chat font setting', () => {
  const bubbleFonts = fontRulesFor('.bubble');
  assert.ok(bubbleFonts.includes('var(--font-chat)'), 'the bubble keeps the chat font');
  assert.match(CSS, /:root\[data-chat-font="mono"\] \{ --font-chat: var\(--font-mono\); \}/, 'the mono setting still exists');
});

test('#1536 monospace stays on code, reasoning text and tool identifiers', () => {
  assert.match(CSS, /code, pre, \.thinking-body, \.tool-chip/, 'thinking text and code remain monospace');
  assert.match(CSS, /\.tool-call-name \{ flex-shrink: 0; font-family: var\(--font-mono\)/, 'tool names remain monospace');
});
