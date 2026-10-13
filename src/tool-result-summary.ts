/** #1524: what a collapsed tool-call row says about a tool's result. The raw payload stays behind the
 *  row's own disclosure; the row gets a count, not the JSON, and never a file or folder name (the
 *  owner's data stays out of collapsed rows). Pure, with no imports: the caller words the summary in
 *  the interface language. */
export type ToolResultSummary =
  | { kind: 'listed'; items: number }
  | { kind: 'search'; results: number }
  | { kind: 'error' }
  | { kind: 'received' }
  | { kind: 'text'; text: string };

function jsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** The summary for one call's result. A result that is not a JSON object is plain text, kept as it was. */
export function summariseToolResult(result: string): ToolResultSummary {
  const object = jsonObject(result);
  if (!object) return { kind: 'text', text: result };
  if (object.success === false || (typeof object.error === 'string' && object.error)) return { kind: 'error' };
  if (Array.isArray(object.results)) return { kind: 'search', results: object.results.length };
  const listed = Array.isArray(object.files) ? object.files : Array.isArray(object.items) ? object.items : null;
  if (listed) return { kind: 'listed', items: listed.length };
  return { kind: 'received' };
}
