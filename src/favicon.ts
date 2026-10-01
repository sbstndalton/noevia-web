// Tab-bar favicon in the season's colours. The static /icon.svg stays in index.html as the
// no-JS fallback and as the template here: its fixed fills are swapped for the palette's, so
// the icon and the sidebar mark change together. The manifest and apple-touch icons are PNG/
// static files and deliberately stay the default green (an installed icon cannot change daily).
import { PALETTE_COLOURS, type LogoPalette } from './logo-calendar';

const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
/** `colour` mixed with white or black by `percent`, like CSS color-mix in srgb. */
function mix(colour: string, towards: 'white' | 'black', percent: number): string {
  const target = towards === 'white' ? 255 : 0, k = percent / 100;
  return '#' + [0, 1, 2].map(i => Math.round(channel(colour, i) * (1 - k) + target * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** The icon.svg template recoloured for a palette; 'default' returns it unchanged. */
export function faviconSvg(template: string, palette: LogoPalette): string {
  if (palette === 'default') return template;
  const c = PALETTE_COLOURS[palette];
  const map: Record<string, string> = {
    '#84593A': c.twig, '#5B3B22': mix(c.twig, 'black', 35),
    '#2F7D4F': c.dark, '#3E9560': mix(c.dark, 'white', 18),
    '#4FA36A': c.mid, '#63B67C': mix(c.mid, 'white', 18),
    '#7CC48A': c.light, '#93D39E': mix(c.light, 'white', 18),
  };
  return template.replace(/#[0-9a-fA-F]{6}\b/g, hex => map[hex.toUpperCase()] ?? hex);
}

export function faviconHref(template: string, palette: LogoPalette): string {
  return palette === 'default' ? '/icon.svg' : `data:image/svg+xml,${encodeURIComponent(faviconSvg(template, palette))}`;
}

let template: Promise<string | null> | null = null;
function loadTemplate(): Promise<string | null> {
  template ??= fetch('/icon.svg', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.text() : null))
    .then(text => (text && text.includes('<svg') ? text : null))
    .catch(() => null)
    .then(text => { if (text === null) template = null; return text; }); // retry on the next check
  return template;
}

let applied: LogoPalette | null = null;
let wanted: LogoPalette | null = null;
/** Point the tab-bar icon at the palette. Failure keeps the static icon; a newer request wins. */
export async function applyFavicon(palette: LogoPalette): Promise<void> {
  wanted = palette;
  if (palette === applied) return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  const svg = palette === 'default' ? '' : await loadTemplate();
  if (svg === null || wanted !== palette) return;
  link.type = 'image/svg+xml';
  link.href = faviconHref(svg, palette);
  applied = palette;
}
