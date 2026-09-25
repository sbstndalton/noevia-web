// Single source for the noevia leaf mark (#306). Builds the sprig in final
// 22x22 viewBox coordinates and emits, deterministically:
//   - src/components/leafLogoGeometry.ts  (element list rendered inline by Logo())
//   - public/icon.svg                      (flat mark for favicons, 16-32px)
//   - public/icon-maskable.svg             (illustrated mark on the app ground, safe-zone padded)
//   - with --png (needs PLAYWRIGHT_MODULE): public/icon-192.png, icon-512.png, apple-touch-icon.png
// Design: a bare twig enters from the top-right corner, kinked at two joints
// like a real limb, tapering to a fine tip that reaches down-left toward the
// viewer; three leaves emerge at its end. The mid leaf continues the twig from
// its tip, the dark leaf sits up-left and the light leaf right/below on short
// petioles. Petioles leave a node swelling at an acute angle along the twig's
// growth direction, flare at the base, taper toward the blade and continue
// into the midrib; the axil carries a small contact shadow. Blades bow along
// an S-shaped midrib and droop; the dark leaf's far edge curls to show its
// underside. Element attrs use React names; '@ID' tokens are replaced per
// rendered instance so gradient/clip ids never collide.
// Run: node scripts/logo-geometry.cjs [--png]
// tests/logo-geometry.test.cjs fails if the committed outputs drift from this.
const fs = require('node:fs');
const path = require('node:path');

const r2 = (v) => +v.toFixed(2);
const f2 = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

// ---- twig centreline: three cubic segments with tangent breaks at the joints
// (the knuckled kink where the limb leaves the bough, a second elbow mid-way),
// traced from the lower limb of the user's reference painting. Global u in
// [0,1] runs far (top-right entry) -> near (tip). Widths taper to a hair and
// swell slightly at each joint.
const SEGS = [
  { p0: { x: 21.8, y: 0.4 }, c1: { x: 20.9, y: 2.3 }, c2: { x: 19.6, y: 4.5 }, p3: { x: 18.6, y: 5.5 } },
  { p0: { x: 18.6, y: 5.5 }, c1: { x: 17.2, y: 6.5 }, c2: { x: 15.2, y: 7.0 }, p3: { x: 13.7, y: 8.1 } },
  { p0: { x: 13.7, y: 8.1 }, c1: { x: 12.7, y: 8.9 }, c2: { x: 11.4, y: 10.0 }, p3: { x: 10.4, y: 11.5 } },
];
const segAt = (u) => { const i = Math.min(SEGS.length - 1, Math.floor(u * SEGS.length)); return { S: SEGS[i], t: u * SEGS.length - i }; };
const bez = (u) => { const { S, t } = segAt(u); const v = 1 - t; const k = (a) => v * v * v * S.p0[a] + 3 * v * v * t * S.c1[a] + 3 * v * t * t * S.c2[a] + t * t * t * S.p3[a]; return { x: k('x'), y: k('y') }; };
const bezD = (u) => { const { S, t } = segAt(u); const v = 1 - t; const k = (a) => 3 * v * v * (S.c1[a] - S.p0[a]) + 6 * v * t * (S.c2[a] - S.c1[a]) + 3 * t * t * (S.p3[a] - S.c2[a]); return { x: k('x'), y: k('y') }; };
const unitN = (u) => { const d = bezD(u), l = Math.hypot(d.x, d.y); return { x: d.y / l, y: -d.x / l }; }; // left normal = upper side
const unitT = (u) => { const d = bezD(u), l = Math.hypot(d.x, d.y); return { x: d.x / l, y: d.y / l }; };
const W_FAR = 0.82, W_TIP = 0.22;
const knob = (u) => 1 + 0.32 * (Math.exp(-Math.pow((u - 1 / 3) / 0.045, 2)) + Math.exp(-Math.pow((u - 2 / 3) / 0.045, 2)));
const halfW = (u) => (W_FAR + (W_TIP - W_FAR) * Math.pow(u, 0.7)) * knob(u);
// ribbon outline around the centreline with round caps
function ribbon(off = 0, scaleW = 1, t0 = 0, t1 = 1, w = halfW) {
  const N = 72, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N, c = bez(t), n = unitN(t);
    const h = w(t), cx = c.x + n.x * h * off, cy = c.y + n.y * h * off, hw = h * scaleW;
    L.push({ x: cx + n.x * hw, y: cy + n.y * hw }); R.push({ x: cx - n.x * hw, y: cy - n.y * hw });
  }
  const hwEnd = w(t1) * scaleW, hwStart = w(t0) * scaleW;
  return `M${f2(L[0])} L${L.slice(1).map(f2).join(' L')} A${hwEnd.toFixed(2)},${hwEnd.toFixed(2)} 0 0 1 ${f2(R[N])} L${R.slice(0, N).reverse().map(f2).join(' L')} A${hwStart.toFixed(2)},${hwStart.toFixed(2)} 0 0 1 ${f2(L[0])} Z`;
}

// ---- leaf in local coordinates: base at 0,0, grows toward -y, the tip
// droops toward +x. Midrib is a gentle S; the blade is fuller near the base.
const TIP = { x: 2.3, y: -8.9 };
const RIB = `M0,-0.3 C0.15,-3.2 -0.55,-6.2 ${TIP.x},${TIP.y}`;
const EDGE_L = `M0,0 C-2.7,-1.1 -3.55,-4.7 -1.9,-7.4 C-1.2,-8.5 -0.1,-9.05 ${TIP.x},${TIP.y}`;
const EDGE_R = `M${TIP.x},${TIP.y} C2.75,-7.0 2.65,-4.2 1.85,-2.3 C1.35,-1.05 0.65,-0.15 0,0`;
const LEAF = `${EDGE_L} ${EDGE_R.replace(/^M[^ ]+ /, '')} Z`;
// left half-blade (base -> left edge -> tip -> back down the midrib)
const RIB_BACK = 'C-0.55,-6.2 0.15,-3.2 0,-0.3';
const HALF_L = `${EDGE_L} ${RIB_BACK} Z`;
// twist (R): the far edge shows as a pale band along the +x side
const TWIST = `M0,0 C0.65,-0.15 1.35,-1.05 1.85,-2.3 C2.65,-4.2 2.75,-7.0 ${TIP.x},${TIP.y} C1.5,-6.6 1.5,-4.2 1.05,-2.4 C0.8,-1.3 0.45,-0.4 0,0 Z`;
// curled tip (U): underside flap along the -x edge near the tip; on the dark
// leaf (mirror -1, pointing up-left) that is the far, upper edge.
const CURL = `M-1.9,-7.4 C-1.2,-8.5 -0.1,-9.05 ${TIP.x},${TIP.y} C1.0,-8.3 0.1,-7.2 -0.35,-5.6 C-1.0,-6.0 -1.6,-6.6 -1.9,-7.4 Z`;
const CURL_FOLD = `M${TIP.x},${TIP.y} C1.0,-8.3 0.1,-7.2 -0.35,-5.6`;

function parse(d) { return d.match(/[MCLZ]|-?\d*\.?\d+/g); }
function mapPath(d, f) {
  const t = parse(d); const out = []; let i = 0;
  while (i < t.length) {
    const c = t[i++];
    if (c === 'Z') { out.push('Z'); continue; }
    const n = c === 'C' ? 3 : 1; const pts = [];
    for (let k = 0; k < n; k++) { const p = f(+t[i], +t[i + 1]); i += 2; pts.push(f2(p)); }
    out.push(c + pts.join(' '));
  }
  return out.join(' ');
}
function points(d) { const t = parse(d).filter((x) => !/[MCLZ]/.test(x)).map(Number); const p = []; for (let i = 0; i < t.length; i += 2) p.push({ x: t[i], y: t[i + 1] }); return p; }

// ---- leaf placement. Each leaf: node on the twig (u), side (+1 upper),
// petiole direction (screen deg, 0 = +x, clockwise), petiole length, blade
// rotation (deg clockwise, 0 = pointing up), mirror flips the droop.
// The tip leaf (u = 1, no petiole) continues the twig's own direction.
const LEAVES = {
  // dark: upper-left of the tip; blade follows its petiole up-left, tip droops (mirror -1), curl on the far edge
  dark: { t: 0.84, side: 1, petAng: -128, petLen: 1.5, rot: -50, mirror: -1, scale: 0.9 },
  // mid: continues the twig from its very tip through a short petiole
  mid: { t: 1, side: 0, petAng: 128, petLen: 0.75, rot: 212, mirror: 1, scale: 0.92 },
  light: { t: 0.88, side: -1, petAng: 58, petLen: 1.35, rot: 152, mirror: -1, scale: 0.9 },
};
const COLORS = {
  dark: { base: '#2F7D4F', lit: '#46A468', shade: '#1F5A37', rib: '#8BD29E' },
  light: { base: '#7CC48A', lit: '#A6E0AE', shade: '#57A36A', rib: '#3F8A57' },
  mid: { base: '#4FA36A', lit: '#72C189', shade: '#347E4D', rib: '#9EDCAE' },
};
const BRANCH = { far: '#C9A57F', lit: '#A9764C', base: '#84593A', shade: '#5B3B22' };
const PETIOLE = '#6E8A3F';

function leafGeo(k) {
  const L = LEAVES[k];
  const c = bez(L.t), n = unitN(L.t), tg = unitT(L.t);
  const node = { x: c.x + n.x * halfW(L.t) * 0.5 * L.side, y: c.y + n.y * halfW(L.t) * 0.5 * L.side };
  const pa = (L.petAng * Math.PI) / 180;
  const base = { x: node.x + Math.cos(pa) * L.petLen, y: node.y + Math.sin(pa) * L.petLen };
  const a = (L.rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const xf = (x, y) => { x *= L.mirror * L.scale; y *= L.scale; return { x: base.x + x * ca - y * sa, y: base.y + x * sa + y * ca }; };
  const W = (d) => mapPath(d, xf);
  const pts = points(W(LEAF));
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  // petiole centreline: leaves the node at an acute angle following the twig's
  // growth direction, then sweeps outward and enters the blade along its axis
  const bladeDir = { x: -sa, y: ca }; // local -y (blade axis) in world space, pointing base -> tip
  const bladeIn = { x: -bladeDir.x, y: -bladeDir.y };
  const lead = L.side === 0 ? 0.35 : 0.5;
  const pc1 = { x: node.x + tg.x * lead + n.x * L.side * 0.2, y: node.y + tg.y * lead + n.y * L.side * 0.2 };
  const pc2 = { x: base.x + bladeIn.x * 0.45, y: base.y + bladeIn.y * 0.45 };
  const petiole = { p0: node, c1: pc1, c2: pc2, p3: base };
  return {
    d: W(LEAF), rib: W(RIB), half: W(HALF_L), twist: W(TWIST), curl: W(CURL), fold: W(CURL_FOLD),
    node, base, tip: xf(TIP.x, TIP.y), mid: xf(0, -4.5), x0, x1, y0, y1, tg, n, side: L.side,
    hl: { x: x0 + (x1 - x0) * 0.36, y: y0 + (y1 - y0) * 0.3 },
    petiole, nodeR: halfW(L.t),
  };
}
// tapered ribbon along a cubic (petiole): wider at the twig (pulvinus flare), narrowing to the blade
function cubicRibbon(P, w0, w1, off = 0, scaleW = 1, u0 = 0, u1 = 1) {
  const N = 16, L = [], R = [];
  const at = (t) => { const v = 1 - t; const k = (a) => v * v * v * P.p0[a] + 3 * v * v * t * P.c1[a] + 3 * v * t * t * P.c2[a] + t * t * t * P.p3[a]; return { x: k('x'), y: k('y') }; };
  const dv = (t) => { const v = 1 - t; const k = (a) => 3 * v * v * (P.c1[a] - P.p0[a]) + 6 * v * t * (P.c2[a] - P.c1[a]) + 3 * t * t * (P.p3[a] - P.c2[a]); return { x: k('x'), y: k('y') }; };
  const w = (t) => (w0 + (w1 - w0) * Math.pow(t, 0.6)) * (1 + 0.35 * Math.exp(-Math.pow(t / 0.12, 2)));
  for (let i = 0; i <= N; i++) {
    const t = u0 + ((u1 - u0) * i) / N, c = at(t), d = dv(t), l = Math.hypot(d.x, d.y) || 1, nx = d.y / l, ny = -d.x / l;
    const h = w(t), cx = c.x + nx * h * off, cy = c.y + ny * h * off, hw = h * scaleW;
    L.push({ x: cx + nx * hw, y: cy + ny * hw }); R.push({ x: cx - nx * hw, y: cy - ny * hw });
  }
  return `M${f2(L[0])} L${L.slice(1).map(f2).join(' L')} L${R.reverse().map(f2).join(' L')} Z`;
}
const G = { dark: leafGeo('dark'), mid: leafGeo('mid'), light: leafGeo('light') };

// ---- element builders
const el = (tag, attrs, children) => (children ? { tag, attrs, children } : { tag, attrs });
const stop = (offset, stopColor, stopOpacity) => el('stop', stopOpacity === undefined ? { offset, stopColor } : { offset, stopColor, stopOpacity });
const lin = (id, a, b, stops) => el('linearGradient', { id: `@ID-${id}`, gradientUnits: 'userSpaceOnUse', x1: r2(a.x), y1: r2(a.y), x2: r2(b.x), y2: r2(b.y) }, stops);
const rad = (id, c, r, stops) => el('radialGradient', { id: `@ID-${id}`, gradientUnits: 'userSpaceOnUse', cx: r2(c.x), cy: r2(c.y), r: r2(r) }, stops);
const url = (id) => `url(#@ID-${id})`;

// draw order: branch behind everything, then dark (upper, behind), mid, light in front
const ORDER = ['dark', 'mid', 'light'];

function branchEls(N, defs, body, drawnLeaves) {
  const far = bez(0), near = bez(1);
  defs.push(lin('bough', far, near, [stop(0, BRANCH.far), stop(0.3, BRANCH.lit), stop(0.7, BRANCH.base), stop(1, BRANCH.shade)]));
  defs.push(lin('bough-hi', far, near, [stop(0, '#F3E3D1', 0.2), stop(1, '#F3E3D1', 0.55)]));
  body.push(el('path', { d: ribbon(), fill: url('bough') }));
  body.push(el('path', { d: ribbon(-0.5, 0.22, 0.03, 0.96), fill: url('bough-hi') }));
  // rounded near end: a soft dark rim on the underside so the tip reads as a
  // foreshortened tip and not a cut face
  body.push(el('path', { d: ribbon(0.55, 0.3, 0.02, 0.7), fill: '#3A2414', fillOpacity: 0.28 }));
  if (N) body.push(el('path', { d: ribbon(), stroke: '#3A2414', strokeOpacity: 0.35, strokeWidth: 0.16, fill: 'none' }));
}

function illustrated(variant) {
  const N = true; void variant;
  const defs = [], body = [];
  branchEls(N, defs, body);
  const branchD = ribbon();
  defs.push(el('clipPath', { id: '@ID-twig-clip' }, [el('path', { d: branchD })]));
  const drawn = [];
  for (const k of ORDER) {
    const g = G[k], c = COLORS[k];
    // petiole first (under its own blade), with a contact shadow on the stem
    {
      const P = g.petiole;
      // node: a slight swelling on the twig where the petiole emerges
      if (g.side !== 0) body.push(el('circle', { cx: r2(g.node.x - g.n.x * g.side * g.nodeR * 0.35), cy: r2(g.node.y - g.n.y * g.side * g.nodeR * 0.35), r: r2(g.nodeR * 0.62), fill: BRANCH.base }));
      // axil: small dark contact shadow in the angle between petiole and twig (tip side)
      if (g.side !== 0) body.push(el('path', { d: `M${f2(g.node)} L${f2({ x: g.node.x + g.tg.x * 0.7, y: g.node.y + g.tg.y * 0.7 })} L${f2({ x: P.c1.x + g.n.x * g.side * 0.25, y: P.c1.y + g.n.y * g.side * 0.25 })} Z`, fill: '#0B2A17', fillOpacity: 0.32 }));
      body.push(el('path', { d: cubicRibbon(P, 0.26, 0.15), fill: '#0B2A17', fillOpacity: 0.28, transform: 'translate(0.18 0.28)', clipPath: url('twig-clip') }));
      defs.push(lin(`${k}-pet`, P.p0, P.p3, [stop(0, BRANCH.base), stop(0.55, PETIOLE), stop(1, '#5E9A4C')]));
      body.push(el('path', { d: cubicRibbon(P, 0.26, 0.15), fill: url(`${k}-pet`) }));
      body.push(el('path', { d: cubicRibbon(P, 0.26, 0.15, -0.55, 0.22, 0.05, 0.98), fill: '#F3E3D1', fillOpacity: 0.55 }));
    }
    defs.push(lin(`${k}-body`, { x: g.x0, y: g.y0 }, { x: g.x1, y: g.y1 }, [stop(0, c.lit), stop(0.5, c.base), stop(1, c.shade)]));
    defs.push(lin(`${k}-base`, g.base, g.mid, [stop(0, '#0B2A17', N ? 0.45 : 0.35), stop(1, '#0B2A17', 0)]));
    defs.push(rad(`${k}-hl`, g.hl, N ? 3.2 : 2.8, [stop(0, '#FFFFFF', N ? 0.5 : 0.42), stop(1, '#FFFFFF', 0)]));
    // contact shadow onto the stem and onto leaves already drawn
    defs.push(el('clipPath', { id: `@ID-${k}-under` }, [branchD, ...drawn].map((d) => el('path', { d }))));
    body.push(el('path', { d: g.d, fill: '#0B2A17', fillOpacity: N ? 0.38 : 0.3, transform: 'translate(0.4 0.5)', clipPath: url(`${k}-under`) }));
    body.push(el('path', { d: g.d, fill: url(`${k}-body`) }));
    // the blade bows along the midrib: the half turned away from the light is a touch darker
    body.push(el('path', { d: g.half, fill: '#0B2A17', fillOpacity: N ? 0.14 : 0.1 }));
    body.push(el('path', { d: g.d, fill: url(`${k}-base`) }));
    body.push(el('path', { d: g.d, fill: url(`${k}-hl`) }));
    if (!N && k === 'light') {
      defs.push(lin('light-tw', { x: g.x1, y: g.y0 }, { x: g.x0, y: g.y1 }, [stop(0, '#D4F0D4', 0.85), stop(1, '#9ED2A8', 0.5)]));
      body.push(el('path', { d: g.twist, fill: url('light-tw') }));
    }
    body.push(el('path', { d: g.rib, stroke: c.rib, strokeOpacity: 0.45, strokeWidth: 0.28, strokeLinecap: 'round', fill: 'none' }));
    if (N && k === 'dark') {
      defs.push(lin('dark-curl', g.tip, g.mid, [stop(0, '#BFE3C4'), stop(1, '#7DBA8C')]));
      body.push(el('path', { d: g.curl, fill: url('dark-curl') }));
      body.push(el('path', { d: g.fold, stroke: '#1A4D2F', strokeOpacity: 0.55, strokeWidth: 0.28, strokeLinecap: 'round', fill: 'none' }));
    }
    if (N) body.push(el('path', { d: g.d, stroke: '#123D24', strokeOpacity: 0.35, strokeWidth: 0.16, fill: 'none' }));
    drawn.push(g.d);
  }
  return [el('defs', {}, defs), ...body];
}

const FLAT_LIT = { dark: '#3E9560', mid: '#63B67C', light: '#93D39E' };
function flat() {
  // Crisp at 16-32px: solid silhouettes, no gradients. Twig = one tapered path
  // with a darker underside band; each leaf = base colour + a lighter half-blade
  // on the lit side of the midrib; petioles are too thin to survive 16px, so
  // each is a short leaf-coloured wedge that merges blade into twig.
  const out = [el('path', { d: ribbon(0, 1.3), fill: BRANCH.base })];
  out.push(el('path', { d: ribbon(0.5, 0.45, 0, 0.92), fill: BRANCH.shade, clipPath: url('flat-twig') }));
  const defs = [el('clipPath', { id: '@ID-flat-twig' }, [el('path', { d: ribbon(0, 1.3) })])];
  for (const k of ORDER) {
    out.push(el('path', { d: cubicRibbon(G[k].petiole, 0.42, 0.55), fill: COLORS[k].base }));
    out.push(el('path', { d: G[k].d, fill: COLORS[k].base }));
    out.push(el('path', { d: G[k].half, fill: FLAT_LIT[k] }));
  }
  return [el('defs', {}, defs), ...out];
}

// ---- outputs
const kebab = (s) => (/^(viewBox|gradientUnits)$/.test(s) ? s : s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
function toSvg(nodes, ns) {
  return nodes.map((n) => {
    const a = Object.entries(n.attrs).map(([k, v]) => `${kebab(k)}="${String(v).replace(/@ID/g, ns)}"`).join(' ');
    return n.children ? `<${n.tag}${a ? ' ' + a : ''}>${toSvg(n.children, ns)}</${n.tag}>` : `<${n.tag} ${a}/>`;
  }).join('\n  ');
}
const root = path.join(__dirname, '..');
const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" role="img" aria-label="noevia">';
const APP_BG = '#f7f6fd';
function outputs() {
  const mark = illustrated('u');
  const flatMark = flat();
  const iconSvg = `${SVG_OPEN}\n  <!-- noevia mark, flat: three leaves emerging at the tip of a bare twig. Fixed colours on purpose — a favicon cannot follow the app's accent palette. Generated by scripts/logo-geometry.cjs. -->\n  ${toSvg(flatMark, 'noevia-flat')}\n</svg>\n`;
  // Home-screen icon: the illustrated mark on the app ground, inside the safe
  // area iOS/Android crop to (mark spans the central 66% of the 180px tile).
  const inset = 30, scale = (180 - 2 * inset) / 22;
  const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" role="img" aria-label="noevia">\n  <!-- Home-screen icon: the illustrated mark on a solid ground, inside the safe area iOS and Android crop to. Generated by scripts/logo-geometry.cjs. -->\n  <rect width="180" height="180" fill="${APP_BG}"/>\n  <g transform="translate(${inset} ${inset}) scale(${r2(scale)})">\n  ${toSvg(mark, 'noevia-mask')}\n  </g>\n</svg>\n`;
  const ts = `// GENERATED by scripts/logo-geometry.cjs — do not edit by hand.
// Element list for the illustrated leaf mark rendered by Logo(). Attribute
// values containing '@ID' are rewritten per rendered instance so gradient/clip
// ids never collide when several logos share a page.
export type LeafLogoNode = { tag: string; attrs: Record<string, string | number>; children?: LeafLogoNode[] };
export const LEAF_LOGO: LeafLogoNode[] = ${JSON.stringify(mark, null, 2)};
`;
  return {
    'src/components/leafLogoGeometry.ts': ts,
    'public/icon.svg': iconSvg,
    'public/icon-maskable.svg': maskableSvg,
  };
}
module.exports = { outputs };

async function renderPngs() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const svg = fs.readFileSync(path.join(root, 'public', 'icon-maskable.svg'), 'utf8');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`);
      await page.screenshot({ path: path.join(root, 'public', file), omitBackground: false });
      await page.close();
    }
  } finally { await browser.close(); }
}

if (require.main === module) {
  for (const [rel, content] of Object.entries(outputs())) fs.writeFileSync(path.join(root, rel), content);
  if (process.argv.includes('--png')) renderPngs().catch((e) => { console.error(e); process.exitCode = 1; });
}
