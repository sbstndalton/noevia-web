// A model's name for people to read (#1582). The server sends no display name for an installed model,
// only its router id, so until one exists the fallback tidies that id: a .gguf extension and the
// quantisation tag (Q4_K_XL, q4_0, UD-, qat, F16 ...) are dropped. This is for display text only: a
// role, a request or a key always keeps the id itself, and nothing here decides which model is meant.
const GGUF_EXTENSION = /\.gguf$/i;
// A separator, optional "UD-"/"qat-" prefixes, then a quantisation tag that ends at a separator or the end.
const QUANTISATION_TAG = /[-_.](?:(?:ud|qat)[-_.])*(?:i?q\d+(?:_[a-z0-9]+)*|f16|f32|bf16)(?=$|[-_.])/gi;

/** The id as a person reads it: no .gguf extension, no quantisation tag. An id that is only a tag is kept. */
export function modelDisplayName(name: string): string {
  if (!name) return '';
  const tidied = name.replace(GGUF_EXTENSION, '').replace(QUANTISATION_TAG, '');
  return tidied || name;
}

/** Display names for the ids shown together on one screen. Two ids that would read the same (two
 *  quantisations of one model) keep their quantisation tag, so the screen still tells them apart. */
export function displayNamer(ids: readonly string[]): (id: string) => string {
  const idsByName = new Map<string, Set<string>>();
  for (const id of ids) {
    const name = modelDisplayName(id);
    const same = idsByName.get(name) ?? new Set<string>();
    same.add(id);
    idsByName.set(name, same);
  }
  return (id: string) => {
    const name = modelDisplayName(id);
    return (idsByName.get(name)?.size ?? 0) > 1 ? id.replace(GGUF_EXTENSION, '') : name;
  };
}
