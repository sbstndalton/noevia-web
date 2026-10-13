// The Code tab's plain words (#1581). Pure, so the node tests can load it without React or the DOM.
// A harness is named by its id in the catalogue (code.harness.<id>.label) and keeps the server's own
// label when this build has no plain name for it. Its version is an operator detail: it stays in the
// hover text, not in the words a person reads.

type Translate = (key: string) => string;
export type HarnessInfo = { id: string; label: string; version?: string | null };
export type PreparationOption = { id: string; available: boolean };

/** The harness as a person names it. */
export function harnessName(t: Translate, harness: HarnessInfo): string {
  const key = `code.harness.${harness.id}.label`;
  const text = t(key);
  return text === key ? harness.label : text;
}

/** The product and version, for the hover text only; undefined when the server reports no version. */
export function harnessVersionNote(harness: HarnessInfo): string | undefined {
  return harness.version ? `${harness.label} ${harness.version}` : undefined;
}

/** The preparation modes the Code tab offers. A mode that is not available is left out of the list
 *  rather than shown greyed, with its measurement; the server still reports it. */
export function offeredPreparations<M extends PreparationOption>(modes: readonly M[]): M[] {
  return modes.filter((mode) => mode.available);
}

/** The preparation mode a task actually uses: the chosen one while it is still offered, otherwise the
 *  first offered one. The select, the note and the start request all read this, so they cannot disagree
 *  when a mode drops out of the list on a poll (#1581 review). */
export function effectivePreparationId(offered: readonly { id: string }[], chosen: string): string {
  return offered.some((mode) => mode.id === chosen) ? chosen : (offered[0]?.id ?? 'direct');
}
