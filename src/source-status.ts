import type { ProjectFile } from './types';
export function sourceStatus(file: ProjectFile): string {
  const d = file.document;
  if (!d) return '';
  const pages = d.pages ? ` · ${d.pages} ${d.pages === 1 ? "page" : "pages"}` : '';
  const incomplete = (d.pageStatus || []).filter(p => !['native', 'blank', 'ocr'].includes(p.status));
  return `${d.stale ? 'Refresh failed · using previous text' : d.state === 'failed' ? 'Not readable' : d.state === 'partial' ? 'Partially readable' : (d.pageStatus || []).some(p => p.status === 'ocr') ? 'Text ready · OCR used; verify numbers' : 'Native text ready'}${pages}` +
    `${incomplete.length ? ' · check pages ' + incomplete.slice(0, 20).map(p => p.number).join(', ') + (incomplete.length > 20 ? '…' : '') : ''}${d.truncated ? ' · extraction/summary limited' : ''}` +
    `${d.error ? ' · ' + d.error : ''}${d.indexing === 'pending' ? ' · indexing' : file.content && ['unavailable', 'failed', 'partial'].includes(d.indexing || '') ? ' · search limited; page reads available for extracted text' : ''}`;
}
export type SkippedSource = { folder: string; file?: string; reason: string; retained?: boolean };

export function sourceRefreshEntries(skipped: SkippedSource[]): string[] {
  return skipped.map(s => `${s.file || s.folder}: ${s.reason}${s.retained ? ' Previous readable text retained.' : ''}`);
}

export function sourceRefreshIssues(skipped: SkippedSource[]): string {
  return sourceRefreshEntries(skipped).join('\n');
}

/** A stable, order-independent fingerprint of a skipped-source set, used to
 * decide whether a toast is reporting something new or just repeating what
 * the person already dismissed. */
export function skippedSignature(skipped: SkippedSource[]): string {
  return skipped
    .map(s => `${s.file || s.folder}\u0000${s.reason}\u0000${s.retained ? '1' : '0'}`)
    .sort()
    .join('\u0001');
}

/**
 * Decides what, if anything, should happen to the skipped-sources toast for
 * a project given its previously-shown signature and the latest refresh
 * result. `show` is:
 *   - a string: the toast should be (re)displayed with this message
 *   - null: the toast should be cleared (a clean refresh followed one that
 *     had skipped entries)
 *   - undefined: no change — the same set is still skipped (already shown or
 *     dismissed) or there was nothing to report and nothing to clear.
 */
export function resolveSkippedToast(
  prevSignature: string,
  skipped: SkippedSource[],
): { signature: string; show: string | null | undefined } {
  const signature = skippedSignature(skipped);
  if (!signature) {
    return prevSignature ? { signature: '', show: null } : { signature: prevSignature, show: undefined };
  }
  if (signature === prevSignature) return { signature, show: undefined };
  return { signature, show: sourceRefreshIssues(skipped) };
}
