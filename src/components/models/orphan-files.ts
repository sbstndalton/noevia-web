// Setup files that the engine lists but no models.ini section points at.
// They are never "loaded" or "vision", so a name search and the Loaded/vision
// filters must apply to them the same way they apply to configured models —
// otherwise a zero-result search or the Loaded filter still shows unrelated
// setup files (#174). Kept import-free so it can be unit tested directly.
export function filterOrphanFiles<T extends { name: string }>(orphanFiles: T[], query: string, filter: 'all' | 'loaded' | 'vision' | 'unconfigured'): T[] {
  const needle = query.trim().toLowerCase();
  return orphanFiles
    .filter(f => !needle || f.name.toLowerCase().includes(needle))
    .filter(() => filter === 'all' || filter === 'unconfigured');
}
