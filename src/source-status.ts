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
export function sourceRefreshIssues(skipped: { folder: string; file?: string; reason: string; retained?: boolean }[]): string {
  return skipped.map(s => `${s.file || s.folder}: ${s.reason}${s.retained ? ' Previous readable text retained.' : ''}`).join('\n');
}
