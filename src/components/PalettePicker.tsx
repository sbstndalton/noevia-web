import { useState } from 'react';
import { applyPalette, currentPalette, palettes, type Palette } from '../appearance';

const labels = { warm: ['Warm', 'Cream & earth'], cool: ['Cool', 'Slate & soft white'], neutral: ['Neutral', 'Charcoal & gray'] };
export function PalettePicker({ theme, onChange }: { theme: 'light' | 'dark'; onChange?: (palette: Palette) => void }) {
  const [palette, setPalette] = useState(currentPalette);
  return <fieldset className="palette-picker">
    <legend>Color palette</legend>
    <p>The same palette follows you across light and dark mode.</p>
    <div className="palette-choices">
      {palettes.map(value => <button type="button" key={value} aria-pressed={palette === value}
        aria-label={`${labels[value][0]} palette`} onClick={() => { applyPalette(value); setPalette(value); onChange?.(value); }}>
        <span className="palette-preview" data-theme={theme} data-palette={value} aria-hidden="true"><i/><i/><i/></span>
        <strong>{labels[value][0]}</strong><small>{labels[value][1]}</small>
      </button>)}
    </div>
  </fieldset>;
}
