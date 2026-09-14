import { useEffect, useState } from 'react';
import { applyPalette, currentPalette, palettes, type Palette } from '../appearance';

const labels = { warm: ['Warm', 'Cream & earth'], cool: ['Cool', 'Slate & soft white'], neutral: ['Neutral', 'Charcoal & gray'], sage: ['Sage', 'Mineral & green'], iris: ['Iris', 'Ink & violet'] };
export function PalettePicker({ theme, onChange }: { theme: 'light' | 'dark'; onChange?: (palette: Palette) => void }) {
  const [palette, setPalette] = useState(currentPalette);
  useEffect(() => { const sync=()=>{const next=currentPalette();setPalette(next);onChange?.(next);};sync();window.addEventListener('cowork:appearance',sync);return()=>window.removeEventListener('cowork:appearance',sync); }, [theme]);
  return <fieldset className="palette-picker">
    <legend>Color palette</legend>
    <p>Choose the palette for {theme} mode. Your other mode keeps its own choice.</p>
    <div className="palette-choices">
      {palettes.map(value => <button type="button" key={value} aria-pressed={palette === value}
        aria-label={`${labels[value][0]} palette`} onClick={() => { applyPalette(value); setPalette(value); onChange?.(value); }}>
        <span className="palette-preview" data-theme={theme} data-palette={value} aria-hidden="true"><i/><i/><i/></span>
        <strong>{labels[value][0]}</strong><small>{labels[value][1]}</small>
      </button>)}
    </div>
  </fieldset>;
}
