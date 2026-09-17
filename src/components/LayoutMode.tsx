import { useEffect, useState } from 'react';
import type { JSX } from 'react';

export type LayoutMode = 'auto' | 'mobile' | 'desktop';

/** The API `public/layout-mode.js` installs before the bundle loads. */
type LayoutApi = { get(): LayoutMode; device(): 'mobile' | 'desktop'; set(mode: LayoutMode): string };
const api = (): LayoutApi | undefined => (window as unknown as { noeviaLayout?: LayoutApi }).noeviaLayout;

const OPTIONS: [LayoutMode, string][] = [['auto', 'Automatic'], ['mobile', 'Phone'], ['desktop', 'Desktop']];

/**
 * Choose the layout the app renders at, rather than letting the window size decide alone.
 *
 * The work happens in `layout-mode.js`, which rewrites the viewport meta tag — the single
 * input every `max-width` rule in this app reads. That is also why the explanation shown
 * here changes with the device: a phone can genuinely be widened to the desktop layout,
 * while a desktop browser ignores the viewport meta and can only preview the phone one.
 */
export function LayoutModeControl(): JSX.Element | null {
  const [mode, setMode] = useState<LayoutMode>(() => api()?.get() ?? 'auto');
  const [device, setDevice] = useState<'mobile' | 'desktop'>(() => api()?.device() ?? 'desktop');

  useEffect(() => {
    const onChange = () => { const a = api(); if (a) { setMode(a.get()); setDevice(a.device()); } };
    window.addEventListener('noevia-layout-change', onChange);
    return () => window.removeEventListener('noevia-layout-change', onChange);
  }, []);

  if (!api()) return null;
  const choose = (next: LayoutMode) => { api()?.set(next); setMode(next); };
  const note = device === 'mobile'
    ? 'Automatic follows this device, which looks like a phone or tablet. Desktop renders the full-width layout and scales it down, the same as your browser’s “Request desktop site”.'
    : 'Automatic follows this device, which looks like a desktop. Phone previews the compact layout in a phone-width column — this browser ignores the viewport width a phone would report, so the preview covers the shell, Settings and Models rather than every view.';

  return <section className="settings-appearance">
    <div><h2>Layout</h2><p>Pick the size the interface is drawn at.</p></div>
    <div className="theme-choice">
      {OPTIONS.map(([id, label]) => <button key={id} className={mode === id ? 'is-active' : ''} aria-pressed={mode === id} onClick={() => choose(id)}>
        {label}{id === 'auto' ? ` · ${device === 'mobile' ? 'phone' : 'desktop'}` : ''}
      </button>)}
    </div>
    <p className="route-note">{note}</p>
  </section>;
}
