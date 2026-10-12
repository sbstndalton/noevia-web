// The files a person has attached to the next message in one chat (#1514). Names only: the files are saved
// with the project or the chat by the upload itself; this is what the composer and the sent message show.

/** The attached names with `saved` added, in order, each name once. */
export function addAttachedNames(current: readonly string[], saved: readonly string[]): string[] {
  const out = [...current];
  for (const name of saved) if (!out.includes(name)) out.push(name);
  return out;
}
