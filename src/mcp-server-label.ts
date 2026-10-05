import { useEffect, useState } from 'react';
import { fetchToolboxes } from './api';

/** The name to show for an MCP server id on the approval card (#887): a directory server's title,
 *  else the id the server reported. Looked up once from /api/toolboxes; until it answers (or if it
 *  cannot) the id itself is shown, so the card never waits on this. */
let titles: Map<string, string> | null = null;
let loadedAt = 0;
const FRESH_MS = 30_000; // an administrator can add a server while the page is open
let inflight: Promise<Map<string, string>> | null = null;

export function loadServerTitles(load: typeof fetchToolboxes = fetchToolboxes): Promise<Map<string, string>> {
  if (titles && Date.now() - loadedAt < FRESH_MS) return Promise.resolve(titles);
  inflight ||= load().then((r) => {
    const found = new Map<string, string>();
    for (const s of r.mcp?.servers || []) if (s.id && s.title) found.set(s.id, s.title);
    titles = found;
    loadedAt = Date.now();
    return found;
  }).finally(() => { inflight = null; });
  return inflight;
}

/** A directory title comes from registry metadata nobody here vetted, so it never stands alone: the
 *  id noevia assigned stays visible beside it, and a title of "Nextcloud" cannot pass for the
 *  operator's own server. */
export function labelFor(id: string, known: Map<string, string> | null | undefined): string {
  const title = known?.get(id);
  return title ? `${title} (${id})` : id;
}

export function useServerLabel(id: string | undefined): string | undefined {
  const [label, setLabel] = useState<string | undefined>(() => (id ? labelFor(id, titles) : undefined));
  useEffect(() => {
    if (!id) { setLabel(undefined); return; }
    setLabel(labelFor(id, titles));
    if (titles?.has(id) && Date.now() - loadedAt < FRESH_MS) return;
    let live = true;
    loadServerTitles().then((m) => { if (live) setLabel(labelFor(id, m)); }).catch(() => undefined);
    return () => { live = false; };
  }, [id]);
  return label;
}
