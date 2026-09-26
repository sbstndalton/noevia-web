// One place a model file's on-disk size becomes a display string (#443). The composer's Manual
// picker (ModelPopup.tsx) and the "Your models" card (LibraryTab.tsx) previously computed their
// own numbers from two different sources — the composer from InstalledModel.sizeGB (server/
// llamacpp-manager.cjs: `model.meta.size / 1e9`, decimal GB, computed from the byte count the
// native engine itself reports for the file) and the library card from a separately formatted
// string proxied from the external Model Loader service (`GET /api/model-manager/models`),
// which most likely divides the same byte count by 1024**3 (binary GiB) while still labelling
// it "GB" — about a 7% disagreement for the identical file.
//
// The fix is not a unit conversion: it is removing the second source entirely. Every surface in
// this app that already has (or can derive) the model's InstalledModel.sizeGB uses THIS
// formatter over that one number, so the composer and the library card are structurally unable
// to disagree — same field, same rounding, same label. Decimal GB (bytes / 1e9) was kept as the
// one convention because it is the math the authoritative source (the native engine's own
// reported byte size) already does correctly; relabelling it GiB would mean re-deriving a binary
// value this file never receives.
//
// A surface that only has a raw byte count (LibraryTab's own file-scan entries, which include
// files not resolved to an InstalledModel yet) converts with `bytesToModelSizeGB` first — same
// math, same rounding, so a scanned file and its InstalledModel counterpart still print
// identically once both are known.
const BYTES_PER_GB = 1e9;

/** Rounds to the one decimal place every model-size display uses. Exported so a caller doing
 *  its own locale-aware number formatting (Intl.NumberFormat, for a translated string) can still
 *  share the rounding step — see GuidedOptimize.tsx. */
export function roundModelSizeGB(sizeGB: number): number {
  return Math.round(sizeGB * 10) / 10;
}

/** A raw byte count (LibraryTab's file-scan entries) to the same decimal-GB number the server
 *  computes for InstalledModel.sizeGB, so a file and its installed-model counterpart never
 *  drift apart. */
export function bytesToModelSizeGB(bytes: number): number {
  return roundModelSizeGB(bytes / BYTES_PER_GB);
}

/** The full display string ("3.3 GB"), or null when the size is unknown. `null`/`undefined`/
 *  non-finite/non-positive all read as unknown, matching every call site's previous `!= null`
 *  guard. The unit label is hard-coded "GB" because that is the only math this function ever
 *  does (decimal, bytes / 1e9) — a value computed with 2**30 must never pass through here. */
export function formatModelSizeGB(sizeGB: number | null | undefined): string | null {
  return typeof sizeGB === 'number' && Number.isFinite(sizeGB) && sizeGB > 0 ? `${roundModelSizeGB(sizeGB)} GB` : null;
}
