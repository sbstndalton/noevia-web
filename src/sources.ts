/** What a project source may be, shared by every path that adds one.
 *
 *  These rules used to live in one component and be absent from the other, so
 *  the same file was accepted or refused depending on which button you used.
 */

// Mirrors TEXT_EXTENSIONS in server/storage-client.cjs. A source is stored and
// handed to the model as text, so anything else arrives as replacement
// characters — the file is "added" and reads as gibberish.
export const TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.json', '.csv', '.yml', '.yaml',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.sh', '.html', '.css',
];

export const isTextFile = (name: string) =>
  TEXT_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e));

// Images are not text and are not decoded as text: they are stored as bytes
// and shown to the model as pictures, so they get their own path entirely.
export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// A document is neither text nor a picture: it is converted to text on the
// server at ingest, so it ends up an ordinary source.
export const DOCUMENT_EXTENSIONS = ['.pdf'];
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const uploadLimit = (name: string) => /\.pdf$/i.test(name) ? 60 * 1024 * 1024 : MAX_DOCUMENT_BYTES;
export const isDocumentFile = (name: string) =>
  DOCUMENT_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e));
export const isImageFile = (file: File) => IMAGE_MIME.includes(file.type.toLowerCase());

/** base64 without the data: prefix, read in one pass. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.onload = () => {
      const out = String(reader.result || '');
      const comma = out.indexOf(',');
      resolve(comma >= 0 ? out.slice(comma + 1) : out);
    };
    reader.readAsDataURL(file);
  });
}

/** The server truncates a stored source at 200k characters, but the request
 *  carrying it is capped at 1 MB — and JSON-escaping inflates the payload well
 *  past its byte size. Refuse locally with a reason rather than letting the
 *  save 413 somewhere the user cannot see it. */
export const MAX_SOURCE_BYTES = 200_000;

/** A file refused locally. `reason` is the English sentence; `code`, `size` and `limit` let the screen
 *  word it in the interface language with the locale's own byte units (#640). */
export type Rejection = { name: string; reason: string; code: 'image' | 'document' | 'notText' | 'tooLarge'; size?: number; limit?: number };
type Say = (key: string, params?: Record<string, string | number>) => string;

/** "a.bin (not a text file), b.txt (256 KB, over the 195 KB limit)": in the interface language when
 *  given the translator and a byte formatter, in the English fallback otherwise. */
export function describeRejection(rejected: Rejection[], t?: Say, sizeText?: (bytes: number) => string): string {
  const reasonText = (r: Rejection): string => {
    if (!t) return r.reason;
    if (r.code === 'tooLarge') return t('projects.reject.tooLarge', { size: sizeText ? sizeText(r.size ?? 0) : String(r.size ?? 0), limit: sizeText ? sizeText(r.limit ?? MAX_SOURCE_BYTES) : String(r.limit ?? MAX_SOURCE_BYTES) });
    if (r.code === 'image') return t('projects.reject.image', { group: t('projects.view.groupImages') });
    if (r.code === 'document') return t('projects.reject.document', { group: t('projects.view.groupDocuments') });
    return t('projects.reject.notText');
  };
  return rejected.map((r) => `${r.name} (${reasonText(r)})`).join(', ');
}

/** Split a chosen file list into what can be stored and what cannot. */
export async function readTextSources(
  files: File[],
): Promise<{ accepted: { name: string; content: string }[]; rejected: Rejection[] }> {
  const accepted: { name: string; content: string }[] = [];
  const rejected: Rejection[] = [];
  for (const file of files) {
    if (!isTextFile(file.name)) {
      rejected.push({
        name: file.name,
        code: isImageFile(file) ? 'image' : isDocumentFile(file.name) ? 'document' : 'notText',
        reason: isImageFile(file)
          ? 'an image — add it under Images'
          : isDocumentFile(file.name)
            ? 'a document — add it under Documents'
            : 'not a text file',
      });
      continue;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      rejected.push({ name: file.name, code: 'tooLarge', size: file.size, limit: MAX_SOURCE_BYTES, reason: `${Math.round(file.size / 1024)} KB, over the ${Math.round(MAX_SOURCE_BYTES / 1024)} KB limit` });
      continue;
    }
    accepted.push({ name: file.name, content: await file.text() });
  }
  return { accepted, rejected };
}
