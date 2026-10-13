'use strict';
// #1649: three follow-ups to the strip's two popovers (web#40, #1631).
//   1. The turn-metrics popover and the routing-details popover share a place over the composer, so opening
//      one closes the other (the pointerdown handler only ever closed the metrics one).
//   2. `routingOpen` follows the <details> toggle event only, so it stayed true after the panel left the page
//      (a remount at the phone/wide breakpoint, or a decision that stops being displayable), and the
//      ResizeObserver kept running for a closed panel.
//   3. The composer was observed once per open; a replaced composer was not observed until the strip resized.
// These are behavioural: the real StatsBar is bundled and mounted in an isolated jsdom realm, with a recording
// ResizeObserver, so the assertions are about the effects and observers, not the source text.
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');

const ROOT = path.resolve(__dirname, '../..');
let bundle;

async function realm(t) {
  bundle ??= build({
    stdin: {
      contents: `import { act } from 'react'; import { createRoot } from 'react-dom/client';
        import { StatsBar } from './src/components/StatsBar';
        let root = null;
        // The chat view and the strip are siblings under one parent, as in App; the composer is keyed by chat,
        // so a new chat replaces the composer element while the strip (and any open popover) stays mounted.
        export async function render(el, props, chatKey = 'chat-1') {
          await act(async () => {
            root ??= createRoot(el);
            root.render(<div className="stack"><div key={chatKey} className="composer"><div className="composer-inner chat-composer-inner" /></div><StatsBar {...props} /></div>);
          });
        }
        export async function unmount() { if (root) { await act(async () => root.unmount()); root = null; } }
        export async function run(fn) { await act(async () => { fn(); }); }`,
      resolveDir: ROOT,
      loader: 'tsx',
    },
    jsx: 'automatic', bundle: true, write: false, format: 'iife', globalName: 'Strip1649', platform: 'browser',
    // NODE_PATH is honoured so a checkout whose node_modules predates a dependency can borrow it (local runs only).
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  const code = (await bundle).outputFiles[0].text;
  const dom = new JSDOM('<!doctype html><body><div id="strip"></div></body>', {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.IS_REACT_ACT_ENVIRONMENT = true;
  // Recording ResizeObserver: `live` is every target observed and not yet unobserved or disconnected.
  const instances = [];
  w.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.targets = new Set(); instances.push(this); }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
  };
  const observed = () => new Set(instances.flatMap(o => [...o.targets]));
  w.MessageChannel = class { constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }; } };
  w.eval(code);
  t.after(async () => { await w.Strip1649.unmount(); w.close(); });
  return { w, doc: w.document, api: w.Strip1649, observed };
}

const decision = {
  offered: [{ id: 'fast', label: 'Fast model' }, { id: 'code', label: 'Code model' }],
  scores: { fast: 0.5, code: 0.25 },
  selectedRole: 'fast',
  effectiveRole: 'fast',
  backend: 'decision-service',
  model: 'convaiinnovations/laya',
  calibrated: false,
  latencyMs: 12,
  status: 'accepted',
  fallbackReason: null,
};

// jsdom has no matchMedia, so narrow() reads the forced-layout flag the stylesheet also honours.
const setPhone = (doc, on) => { if (on) doc.documentElement.dataset.layout = 'mobile'; else delete doc.documentElement.dataset.layout; };

// A details panel reports its open state the way a browser does: the attribute, then a toggle event.
async function setPanelOpen(api, panel, open) {
  await api.run(() => { panel.open = open; panel.dispatchEvent(new panel.ownerDocument.defaultView.Event('toggle')); });
}

const props = (extra = {}) => ({ stats: null, reply: null, routingDecision: decision, modelLabel: 'Test model', ...extra });
const wide = (doc) => doc.querySelector('.stats-disclosure.is-wide');
const phoneStrip = (doc) => doc.querySelector('.stats-disclosure:not(.is-wide)');
const metricsButton = (doc) => doc.querySelector('.stats-more');
const routingPanel = (doc) => doc.querySelector('.routing-details');

test('#1649 opening the turn metrics closes an open routing-details popover, and the reverse (one popover at a time)', async (t) => {
  const { doc, api } = await realm(t);
  const strip = doc.getElementById('strip');
  await api.render(strip, props(), 'chat-1');
  assert.ok(wide(doc), 'the wide row is the strip at this width');

  // Routing open first, then the metrics: the metrics open and the routing panel closes.
  await setPanelOpen(api, routingPanel(doc), true);
  assert.equal(routingPanel(doc).open, true, 'the routing details are open');
  await api.run(() => metricsButton(doc).click());
  assert.ok(wide(doc).classList.contains('is-more-open'), 'the metrics popover opened');
  assert.equal(routingPanel(doc).open, false, 'opening the metrics closed the routing details');

  // The reverse: the metrics are open, then the user opens the routing details (its summary fires the toggle).
  await setPanelOpen(api, routingPanel(doc), true);
  assert.equal(wide(doc).classList.contains('is-more-open'), false, 'opening the routing details closed the metrics popover');
  assert.equal(metricsButton(doc).getAttribute('aria-expanded'), 'false');
});

test('#1649 routingOpen clears when the panel leaves the page at the phone/wide breakpoint, so nothing keeps observing a closed panel', async (t) => {
  const { doc, api, observed } = await realm(t);
  const strip = doc.getElementById('strip');
  await api.render(strip, props(), 'chat-1');
  await setPanelOpen(api, routingPanel(doc), true);
  assert.ok(observed().has(wide(doc)), 'an open routing panel anchors the strip, which is observed');

  // Cross the breakpoint: the wide row is replaced by the phone line, and its closed panel is a new element.
  await api.run(() => { setPhone(doc, true); doc.defaultView.dispatchEvent(new doc.defaultView.Event('noevia-layout-change')); });
  assert.ok(phoneStrip(doc), 'the phone line is showing');
  assert.equal(routingPanel(doc).open, false, 'the remounted routing panel is closed');
  assert.equal(observed().size, 0, 'no ResizeObserver target is left for a closed routing panel');
});

test('#1649 routingOpen clears when the decision stops being displayable while the panel is open', async (t) => {
  const { doc, api, observed } = await realm(t);
  const strip = doc.getElementById('strip');
  await api.render(strip, props(), 'chat-1');
  await setPanelOpen(api, routingPanel(doc), true);
  assert.ok(observed().size > 0, 'the open panel is observed');

  // The decision is still on the page but no longer displayable (no offered list, not accepted or fallback).
  await api.render(strip, props({ routingDecision: { ...decision, status: 'pending' } }), 'chat-1');
  assert.equal(routingPanel(doc), null, 'the panel is not rendered');
  assert.equal(observed().size, 0, 'nothing is observed for a panel that is not there');

  // When a displayable decision comes back the panel mounts closed, and it does not start out anchored.
  await api.render(strip, props(), 'chat-1');
  assert.equal(routingPanel(doc).open, false);
  assert.equal(observed().size, 0, 'a freshly mounted, closed panel is not anchored');
});

test('#1649 a replaced composer is observed in place of the old one while the popover is open, and the old one is released', async (t) => {
  const { doc, api, observed } = await realm(t);
  const strip = doc.getElementById('strip');
  await api.render(strip, props(), 'chat-1');
  const oldComposer = doc.querySelector('.composer');
  await setPanelOpen(api, routingPanel(doc), true);
  assert.ok(observed().has(oldComposer), 'the composer is observed while the popover is open');

  // The chat changes under the open popover: the composer element is replaced, the strip stays mounted.
  await api.render(strip, props(), 'chat-2');
  await new Promise(resolve => doc.defaultView.setTimeout(resolve, 0));
  const replacement = doc.querySelector('.composer');
  assert.notEqual(replacement, oldComposer, 'the composer element was replaced');
  assert.ok(routingPanel(doc).open, 'the popover is still open');
  assert.ok(observed().has(replacement), 'the replacement composer is observed');
  assert.equal(observed().has(oldComposer), false, 'the old composer is no longer observed');
});

test('#1649 the composer is not observed once the popover closes, and a later composer change does not re-observe it', async (t) => {
  const { doc, api, observed } = await realm(t);
  const strip = doc.getElementById('strip');
  await api.render(strip, props(), 'chat-1');
  await setPanelOpen(api, routingPanel(doc), true);
  await setPanelOpen(api, routingPanel(doc), false);
  assert.equal(observed().size, 0, 'closing the popover releases every observation');

  await api.render(strip, props(), 'chat-2');
  await new Promise(resolve => doc.defaultView.setTimeout(resolve, 0));
  assert.equal(observed().size, 0, 'a closed popover does not follow the composer');
});
