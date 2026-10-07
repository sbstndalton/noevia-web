// #1008 review / #1013: open Models & routing on a given section. The section rides on the
// `noevia:open-model-settings` event (App switches the view; a mounted ModelsSettings switches its
// section), and is also kept here until a ModelsSettings that is not mounted yet takes it.
let pending: string | null = null;

export function openModelSettings(detail: { model?: string; section?: string } = {}): void {
  pending = detail.section ?? null;
  window.dispatchEvent(new CustomEvent('noevia:open-model-settings', { detail }));
}

/** The section asked for before Models & routing mounted, once. */
export function takePendingModelsSection(): string | null {
  const s = pending; pending = null; return s;
}

/** `?section=` on /models (#1013): the section a link or a reload names. */
export function sectionFromLocation(): string | null {
  try { return new URLSearchParams(window.location.search).get('section'); } catch { return null; }
}
