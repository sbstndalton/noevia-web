/** How a Markdown `![alt](src)` should be treated (#390).
 *
 *  PRODUCT.md: "Nothing leaves the server unless the user connects something that sends it."
 *  A remote `https:`/`http:` image URL in model output is untrusted text — auto-loading it makes
 *  the reader's browser fetch a third party without asking (tracking pixel, IP leak, or
 *  prompt-injection exfiltration through a URL carrying data as query params). So a remote image
 *  never auto-loads: it renders as a placeholder the reader can choose to load, the same shape as
 *  the tool-approval gate elsewhere in this app (show what would happen, let a human decide).
 *
 *  A `data:` image never leaves the server at all — it is already fully inside the message text,
 *  so there is nothing to fetch and nothing to decide. Only the image subtypes a `<img>` can
 *  actually decode are allowed; `svg+xml` is excluded even though it decodes, because a data URI
 *  is exactly the shape a filter like this exists to catch and an SVG can carry active content in
 *  contexts other than a plain `<img>` (this renderer never generates one, but the class name having
 *  a "safe" implication anywhere near SVG is not worth it for a case that no real model reply needs).
 *
 *  Anything else (a bare path, `javascript:`, `ftp:`, `data:text/html`, ...) is not a scheme this
 *  renderer has a sanitiser for, so it is treated the same as an unsafe link: never rendered as a
 *  live element. */
export type ImageClass = 'inline' | 'remote' | 'unsafe';

const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/]+=*$/i;
const SAFE_IMAGE_REMOTE = /^https?:\/\//i;

export function classifyImageSrc(src: string): ImageClass {
  const trimmed = src.trim();
  if (SAFE_IMAGE_DATA.test(trimmed)) return 'inline';
  if (SAFE_IMAGE_REMOTE.test(trimmed)) return 'remote';
  return 'unsafe';
}

/** The host shown on the load-it-yourself chip, so the reader knows where the click will send a
 *  request before they make it. Falls back to the raw source if it does not parse as a URL. */
export function imageHost(src: string): string {
  try { return new URL(src).host || src; } catch { return src; }
}
