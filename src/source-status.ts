import type { ProjectFile } from './types';
import type { MessageKey, Translate } from './i18n';

/** Reasons the server writes itself carry a stable id (#607), so the browser can show them in the
 *  interface language. Files stored before the ids existed only have the English sentence; these
 *  are the sentences noevia has ever written, matched exactly. Anything else (a message from the
 *  OCR service or a PDF library) stays as the server sent it. */
const LEGACY_REASONS: Record<string, string> = {
  'This file is not readable as text — it looks like binary data despite its extension. The original is kept.': 'binaryText',
  'No body text was recovered from this DOCX. The original is kept.': 'docxEmpty',
  'DOCX body text and tables only; layout, images, headers, footers, comments and footnotes are not interpreted.': 'docxPartial',
  'DOCX body text and tables only; layout, images, headers, footers, comments and footnotes are not interpreted. Text extraction limit reached.': 'docxPartialLimit',
  'Original stored; resize below 8 MB for model image input.': 'imageTooLarge',
  'OCR limited to 50 image-bearing pages per document.': 'ocrPageLimit',
  'OCR response omitted pages; refresh to retry.': 'ocrOmittedPages',
  'No readable text was recovered by OCR; try a clearer scan or an unlocked original.': 'noOcrText',
  'No readable native text. Scanned or image-based content needs OCR; OCR is not installed.': 'noNativeText',
};
type Reasoned = { reason?: string; reasonId?: string; reasonParams?: Record<string, string | number> };

const REASON_IDS = new Set(['binaryText', 'encoding', 'docxPartial', 'docxEmpty', 'imageTooLarge', 'ocrPageLimit', 'ocrOmittedPages', 'noOcrText', 'noNativeText']);

function reasonText(t: Translate | undefined, id: string | undefined, params: Record<string, string | number> | undefined, english: string | undefined): string {
  if (!t) return english || '';
  if (id === 'docxPartialLimit') return `${t('projects.view.reason.docxPartial')} ${t('projects.view.reason.limitReached')}`;
  if (id && REASON_IDS.has(id)) return t(`projects.view.reason.${id}` as MessageKey, params);
  return english || '';
}

/** The reason an attachment is stored as-is, in the interface language when `t` is given. */
export function attachmentReason(a: Reasoned | undefined, t?: Translate): string {
  if (!a?.reason && !a?.reasonId) return '';
  let id = a.reasonId, params = a.reasonParams;
  if (!id && a.reason) {
    id = LEGACY_REASONS[a.reason];
    const enc = /^Not valid UTF-8; read as (.+)\. Characters outside that encoding/.exec(a.reason);
    if (!id && enc) { id = 'encoding'; params = { encoding: enc[1] }; }
  }
  return reasonText(t, id, params, a.reason);
}

/** A document's extraction error, in the interface language when `t` is given. */
export function documentError(d: { error?: string; errorId?: string } | undefined, t?: Translate): string {
  if (!d?.error && !d?.errorId) return '';
  return reasonText(t, d.errorId || (d.error ? LEGACY_REASONS[d.error] : undefined), undefined, d.error);
}

export function sourceStatus(file: ProjectFile, t?: Translate): string {
  const d = file.document;
  if (!d) return '';
  const pages = d.pages ? ` · ${d.pages} ${d.pages === 1 ? "page" : "pages"}` : '';
  const incomplete = (d.pageStatus || []).filter(p => !['native', 'blank', 'ocr'].includes(p.status));
  // #700: a 'degraded' page had no text from layout analysis, so the PDF's own text layer was used.
  // Its words are searchable, but the document is only partially extracted, never plain ready.
  const fallback = (d.pageStatus || []).filter(p => p.status === 'degraded');
  const fallbackPages = fallback.slice(0, 20).map(p => p.number).join(', ') + (fallback.length > 20 ? '…' : '');
  const partial = t ? t('projects.view.partiallyExtracted') : 'Partially extracted';
  return `${d.stale ? 'Refresh failed · using previous text' : d.state === 'failed' ? (t ? t('projects.view.notReadable') : 'Not readable') : d.state === 'partial' || fallback.length ? partial : (d.pageStatus || []).some(p => p.status === 'ocr') ? 'Text ready · OCR used; verify numbers' : 'Native text ready'}${pages}` +
    `${incomplete.length ? ' · check pages ' + incomplete.slice(0, 20).map(p => p.number).join(', ') + (incomplete.length > 20 ? '…' : '') : ''}${d.truncated ? ' · extraction/summary limited' : ''}` +
    `${fallback.length ? ' · ' + (t ? t('projects.view.reason.nativeFallback', { pages: fallbackPages }) : `pages ${fallbackPages}: layout analysis found no text, so the PDF's own text layer was used; reading order and tables there may be rough`) : ''}` +
    `${d.error ? ' · ' + documentError(d, t) : ''}${d.indexing === 'pending' ? ' · indexing' : file.content && ['unavailable', 'failed', 'partial'].includes(d.indexing || '') ? ' · search limited; page reads available for extracted text' : ''}`;
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

export type SkippedToastState = { signature: string; message: string };

/**
 * Decides what, if anything, should happen to the skipped-sources toast for
 * a project given its previously-shown signature/message and the latest
 * refresh result. `show` is:
 *   - a string: the toast should be (re)displayed with this message
 *   - null: the toast should be cleared (a clean refresh followed one that
 *     had skipped entries) — but only when the error currently on screen IS
 *     that previous skipped-sources toast; an unrelated project error (e.g.
 *     a save failure) must not be wiped out by an unrelated clean sync.
 *   - undefined: no change — the same set is still skipped (already shown or
 *     dismissed) or there was nothing to report and nothing to clear.
 *
 * `currentError` is whatever is currently shown in the caller's error UI
 * (or null/empty if nothing is shown).
 */
export function resolveSkippedToast(
  prev: SkippedToastState,
  skipped: SkippedSource[],
  currentError: string | null | undefined,
): { signature: string; message: string; show: string | null | undefined } {
  const signature = skippedSignature(skipped);
  if (!signature) {
    if (prev.signature && currentError === prev.message) return { signature: '', message: '', show: null };
    return { signature: prev.signature, message: prev.message, show: undefined };
  }
  if (signature === prev.signature) return { signature, message: prev.message, show: undefined };
  const message = sourceRefreshIssues(skipped);
  return { signature, message, show: message };
}

/** Why an upload that the server accepted is nevertheless not usable, or '' when it is readable.
 *  "Saved" must never be shown for a file whose text could not be read (#577). */
export function uploadUnreadableReason(result: { attachment?: { state?: string; group?: string } & Reasoned; document?: { state?: string; error?: string; errorId?: string } } | undefined, t?: Translate): string {
  const a = result?.attachment, d = result?.document;
  const label = t ? t('projects.view.notReadable') : 'Not readable';
  if (d?.state === 'failed') return `${label}${d.error || d.errorId ? ' · ' + documentError(d, t) : ''}`;
  if (a && a.state === 'stored' && (a.group === 'Text' || a.group === 'Documents')) return `${label} · ${attachmentReason(a, t) || (t ? t('projects.view.reason.noText') : 'the original is kept, but no text could be read from it')}`;
  return '';
}

/** Mirrors server/source-readability.cjs: an original whose text could not be read (#586). It is kept
 *  and downloadable but is not a text source, so it is listed apart and never counted. */
export function isUnreadableSource(file: ProjectFile): boolean {
  const a = file.attachment, d = file.document;
  if (a && a.state === 'stored' && (a.group === 'Text' || a.group === 'Documents')) return true;
  return !!(d && d.state === 'failed' && !String(file.content || '').trim());
}
