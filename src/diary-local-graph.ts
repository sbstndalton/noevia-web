import { markdownFileLinks, markdownWikiLinks, resolveMarkdownPath, wikiLinkCandidates } from './diary-markdown';

// The local graph of one Diary file: what it links to and what links to it. A whole-Diary graph
// needs an index the Diary deliberately does not keep; one hop around the open file does not —
// outgoing links come from the file itself and incoming ones from the same bounded backlink scan
// "Find links to this file" already runs. Pure and deterministic so the drawing is stable.
//
// #741: the layout is generic. `radialGraph` takes any centre and neighbours (Diary files, chats,
// tag hubs) and returns positioned nodes plus one edge per neighbour; `localGraph` is the Diary's
// adapter onto it and draws exactly what it drew before.

export type GraphRelation = 'self' | 'out' | 'in' | 'both' | 'tag';
export interface GraphNode { id: string; label: string; relation: GraphRelation; x: number; y: number }
export interface GraphEdge { from: string; to: string; relation: Exclude<GraphRelation, 'self'> }
export interface LocalGraph { nodes: GraphNode[]; edges: GraphEdge[]; hidden: number }
export interface GraphNeighbour { id: string; label: string; relation: Exclude<GraphRelation, 'self'> }

export const GRAPH_LIMIT = 24;
const RELATION_ORDER: GraphRelation[] = ['both', 'out', 'in', 'tag'];

/**
 * One hop around `self`: two-way links first, then links out, links in and tag hubs, alphabetical
 * by id within each; at most `limit` drawn and the rest counted. One ring up to 12, then an outer
 * ring: readable at phone width without a layout engine.
 */
export function radialGraph(self: { id: string; label: string }, neighbours: readonly GraphNeighbour[], limit = GRAPH_LIMIT): LocalGraph {
  const seen = new Set<string>([self.id]);
  const unique = neighbours.filter((n) => n.id && !seen.has(n.id) && (seen.add(n.id), true))
    .sort((a, b) => RELATION_ORDER.indexOf(a.relation) - RELATION_ORDER.indexOf(b.relation) || a.id.localeCompare(b.id));
  const shown = unique.slice(0, limit);
  const nodes: GraphNode[] = [{ id: self.id, label: self.label, relation: 'self', x: 0, y: 0 }];
  shown.forEach((n, i) => {
    const inner = Math.min(shown.length, 12), ring = i < 12 ? 0 : 1;
    const count = ring === 0 ? inner : shown.length - 12, index = ring === 0 ? i : i - 12;
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count + (ring ? Math.PI / count : 0);
    const radius = ring === 0 ? 0.62 : 0.92;
    nodes.push({ id: n.id, label: n.label, relation: n.relation, x: Math.round(Math.cos(angle) * radius * 1000) / 1000, y: Math.round(Math.sin(angle) * radius * 1000) / 1000 });
  });
  return { nodes, edges: shown.map((n) => ({ from: self.id, to: n.id, relation: n.relation })), hidden: unique.length - shown.length };
}

const label = (path: string) => (path.split('/').pop() || path).replace(/\.md$/i, '');

/**
 * @param path the open file's storage path
 * @param text its current Markdown
 * @param root the Diary folder, for wiki-link resolution
 * @param backlinks paths of files that link here (from the bounded scan)
 */
export function localGraph({ path, text, root, backlinks }: { path: string; text: string; root: string; backlinks: string[] }): LocalGraph {
  const out = new Set<string>();
  for (const link of markdownFileLinks(text)) {
    const target = resolveMarkdownPath(path, link.href);
    if (target && target !== path) out.add(target);
  }
  for (const link of markdownWikiLinks(text)) {
    if (link.embed || !link.target) continue;
    // Without an index noevia cannot know which placement exists; the first candidate is the
    // one the preview opens first, so the graph shows the same file a click would.
    const target = wikiLinkCandidates(path, root, link.target)[0];
    if (target && target !== path) out.add(target);
  }
  const incoming = new Set(backlinks.filter((p) => p && p !== path));
  const neighbours = [...new Set([...out, ...incoming])]
    .map((id) => ({ id, label: label(id), relation: (out.has(id) && incoming.has(id) ? 'both' : out.has(id) ? 'out' : 'in') as GraphNeighbour['relation'] }));
  return radialGraph({ id: path, label: label(path) }, neighbours);
}
