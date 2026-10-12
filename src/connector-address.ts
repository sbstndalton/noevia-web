// #1560: a connector's address as a person reads it. A WebDAV path arrives percent-encoded ("noevia%20folder"),
// which reads as raw URL encoding; decodeURI turns the escapes back into the characters they stand for but
// keeps the reserved ones (%2F, %3F, %23…) encoded, so the displayed address still means the same place.
// A string that cannot be decoded (a malformed escape) is shown exactly as it arrived.
export function displayAddress(url: string): string {
  try { return decodeURI(url); } catch { return url; }
}
