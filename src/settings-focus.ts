/** #401: Settings hands focus back to whatever opened it when it closes (Escape or the Close
 *  button — both tear the shell down the same way, so one effect covers both). `previous` is the
 *  opener captured before Settings mounted; a caller that unmounts its own trigger in the very
 *  update that opens Settings (the account menu's popover, which closes itself in the same click
 *  handler that opens Settings) leaves `previous` disconnected from the document by the time
 *  Settings closes. Focusing a disconnected element is a silent no-op, which is how focus was
 *  landing on `<body>` — so this falls through to the composer, the one control guaranteed to
 *  exist in every view Settings can be opened from, instead. */
export function closeFocusTarget<T extends { isConnected: boolean }>(previous: T | null, composer: T | null): T | null {
  if (previous && previous.isConnected) return previous;
  return composer;
}
