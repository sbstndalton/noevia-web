// The composer's tool catalogue (#237). Pure: filtering, ordering and which boxes a turn adds,
// tested in tests/tool-catalogue.test.cjs. The server's /api/toolboxes/permitted is the source
// of the boxes; nothing here can make an unavailable tool available.

export type ToolPermission = 'allowed' | 'needs-approval' | 'unavailable';
export interface PermittedTool { name: string; description: string; write: boolean; permission: ToolPermission; reason: string | null }
export interface PermittedBox {
  id: string; label: string; description: string; source: 'builtin' | 'mcp' | 'code';
  state: 'available' | 'unavailable'; reason: string | null; active: boolean; tools: PermittedTool[];
}
export interface CatalogueEntry {
  key: string; kind: 'box' | 'tool'; boxId: string; boxLabel: string; name: string; label: string;
  description: string; permission: ToolPermission; reason: string | null; active: boolean;
}

const words = (q: string) => q.toLowerCase().split(/\s+/).map(w => w.replace(/^[@/]+/, '')).filter(Boolean);

/**
 * Flatten boxes into rows (a box, then its tools) and keep those matching every word of the
 * query against the label, name, description or box. Unavailable rows sort after usable ones
 * but stay visible, so the permission boundary is shown rather than hidden.
 */
export function filterCatalogue(boxes: PermittedBox[], query: string): CatalogueEntry[] {
  const q = words(query);
  const rows: CatalogueEntry[] = [];
  for (const box of boxes) {
    const boxPermission: ToolPermission = box.state === 'available' ? (box.tools.some(t => t.permission === 'allowed') ? 'allowed' : box.tools.some(t => t.permission === 'needs-approval') ? 'needs-approval' : 'unavailable') : 'unavailable';
    rows.push({ key: `box:${box.id}`, kind: 'box', boxId: box.id, boxLabel: box.label, name: box.id, label: box.label,
      description: box.description, permission: boxPermission, reason: box.reason, active: box.active });
    for (const tool of box.tools) rows.push({ key: `tool:${box.id}:${tool.name}`, kind: 'tool', boxId: box.id, boxLabel: box.label,
      name: tool.name, label: tool.name, description: tool.description, permission: tool.permission, reason: tool.reason, active: box.active });
  }
  const hit = (row: CatalogueEntry) => {
    const hay = `${row.label} ${row.name} ${row.description} ${row.boxLabel}`.toLowerCase();
    return q.every(w => hay.includes(w));
  };
  // Without a query, show boxes only: the full tool list is what the search is for.
  const matched = q.length ? rows.filter(hit) : rows.filter(r => r.kind === 'box');
  const rank = (r: CatalogueEntry) => (r.permission === 'unavailable' ? 1 : 0);
  return matched.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r);
}

/** `@tool_name` mentions in the draft that name a usable tool. */
export function mentionedTools(text: string, boxes: PermittedBox[]): string[] {
  const usable = new Set(boxes.filter(b => b.state === 'available').flatMap(b => b.tools.filter(t => t.permission !== 'unavailable').map(t => t.name)));
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)@([A-Za-z0-9_.-]+)/g)) if (usable.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * Boxes this turn adds beyond the chat's own selection: the ones toggled on in the catalogue
 * plus the boxes of mentioned tools. Only available, not-already-active, non-code boxes; the
 * server filters again against what it offers.
 */
export function turnBoxesFor(text: string, boxes: PermittedBox[], toggled: string[]): string[] {
  const mentioned = new Set(mentionedTools(text, boxes));
  const ids: string[] = [];
  for (const box of boxes) {
    if (box.state !== 'available' || box.active || box.source === 'code') continue;
    if (toggled.includes(box.id) || box.tools.some(t => mentioned.has(t.name))) ids.push(box.id);
  }
  return ids.slice(0, 20);
}

/** Insert `@name ` at the caret, replacing a lone "/" that opened the catalogue. */
export function insertMention(draft: string, name: string): string {
  const base = draft === '/' ? '' : draft.replace(/\/$/, '');
  return `${base}${base && !/\s$/.test(base) ? ' ' : ''}@${name} `;
}

export interface CataloguePlacement { top: string; bottom: string; maxHeight: number }

/**
 * Where the catalogue panel opens relative to its trigger (#353). It normally opens upward
 * from the composer, but an empty new chat can put the trigger high enough that the panel's
 * usual height pushes its header off the top of the viewport. Flip below when there is more
 * room there, and always clamp to what actually fits so the search box stays visible either way
 * (mirrors the measure-then-flip approach in ComposerActions). Both `top` and `bottom` are
 * always returned (one of them `'auto'`) so the inline style fully overrides the CSS default
 * instead of combining with it.
 */
export function placeCatalogue(rect: { top: number; bottom: number }, viewportHeight: number): CataloguePlacement {
  const gap = 8, min = 240, cap = 440;
  const above = rect.top - gap, below = viewportHeight - rect.bottom - gap;
  const useBelow = above < min && below > above;
  const maxHeight = Math.max(120, Math.min(cap, useBelow ? below : above));
  return { top: useBelow ? `calc(100% + ${gap}px)` : 'auto', bottom: useBelow ? 'auto' : `calc(100% + ${gap}px)`, maxHeight };
}
