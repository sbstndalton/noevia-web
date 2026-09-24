import { SegmentedControl } from './SegmentedControl';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { t as translate, useT } from '../i18n';
import type { MessageKey } from '../i18n';

export type LayoutMode = 'auto' | 'mobile' | 'desktop';

/** The API `public/layout-mode.js` installs before the bundle loads. */
type LayoutApi = { get(): LayoutMode; device(): 'mobile' | 'desktop'; set(mode: LayoutMode): string };
const api = (): LayoutApi | undefined => (window as unknown as { noeviaLayout?: LayoutApi }).noeviaLayout;

/*
 * Choose the layout the app renders at, rather than letting the window size decide alone.
 *
 * The work happens in `layout-mode.js`, which rewrites the viewport meta tag — the single
 * input every `max-width` rule in this app reads. That is also why the description changes
 * with the device: a phone can genuinely be widened to the desktop layout, while a desktop
 * browser ignores the viewport meta and can only preview the phone one.
 */
const OPTIONS: [LayoutMode, MessageKey][] = [['auto', 'appearance.layout.auto'], ['mobile', 'appearance.layout.phone'], ['desktop', 'appearance.layout.desktop']];

/** The three-way picker on its own, for embedding in a settings row. */
export function LayoutModeChoice(): JSX.Element | null {
  const t = useT();
  const [mode, setMode] = useState<LayoutMode>(() => api()?.get() ?? 'auto');
  const [device, setDevice] = useState<'mobile' | 'desktop'>(() => api()?.device() ?? 'desktop');

  useEffect(() => {
    const onChange = () => { const a = api(); if (a) { setMode(a.get()); setDevice(a.device()); } };
    window.addEventListener('noevia-layout-change', onChange);
    return () => window.removeEventListener('noevia-layout-change', onChange);
  }, []);

  if (!api()) return null;
  const choose = (next: LayoutMode) => { api()?.set(next); setMode(next); };
  return <SegmentedControl label={t('appearance.layout')} value={mode} onChange={choose}
    options={OPTIONS.map(([id, key]) => [id, `${t(key)}${id === 'auto' ? ` · ${t(device === 'mobile' ? 'appearance.layout.devicePhone' : 'appearance.layout.deviceDesktop')}` : ''}`])}/>;
}

/** What the picker does here depends on the device, so the description is not static. */
export function layoutModeDescription(t: (key: MessageKey) => string = translate): string {
  return t((api()?.device() ?? 'desktop') === 'mobile' ? 'appearance.layout.descPhone' : 'appearance.layout.descDesktop');
}
