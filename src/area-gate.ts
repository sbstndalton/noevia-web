// An area that depends on routes the server may not have yet (Spaces, Coworkers) is shown only
// when the server says it exists for this account (sbstndalton/noevia#2446). The probe is the list
// route itself: 200 with the expected JSON shape means "there"; a 404 (server without the routes),
// a 401/403/5xx, a network failure, or a 200 that is not the list (a host that answers every path
// with the app shell) all mean "absent", so the entry never appears and the paths read as unknown.
export type AreaProbe = (path: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

export async function areaAvailable(probe: AreaProbe, path: string, listKey: string): Promise<boolean> {
  try {
    const response = await probe(path);
    if (response.status !== 200) return false;
    const body = await response.json();
    return !!body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>)[listKey]);
  } catch {
    return false;
  }
}
