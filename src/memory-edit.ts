/** Pure decisions behind Settings → Memory (#228 review hardening). */

/** Enter commits a memory line, but never while an IME composition is still open. */
export function isCommitKey(key: string, isComposing: boolean): boolean {
  return key === 'Enter' && !isComposing;
}

/** What saving an edited line means: an emptied edit is a forget and must be confirmed, never silent. */
export function editOutcome(text: string): { kind: 'save'; text: string } | { kind: 'confirm-forget' } {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean ? { kind: 'save', text: clean } : { kind: 'confirm-forget' };
}
