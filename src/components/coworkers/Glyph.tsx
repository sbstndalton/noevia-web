import type { JSX } from 'react';
import { glyphOf, tintOf } from '../../coworker-form';

/** A coworker's tile: its glyph (or first letter) on its tint. Decorative: the name is always beside it. */
export function CoworkerGlyph({ coworker, size = 'md' }: { coworker: { glyph: string; name: string; tint: string }; size?: 'md' | 'lg' }): JSX.Element {
  return <span className={`cw-glyph cw-tint-${tintOf(coworker.tint)} is-${size}`} aria-hidden="true">{glyphOf(coworker)}</span>;
}
