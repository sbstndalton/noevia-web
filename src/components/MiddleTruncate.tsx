import type { JSX } from 'react';
import { splitMiddle } from '../middle-split';

// Model names differ at both ends: the family at the start, the size and quantization at the
// end ("Qwen3.5-4B-…-Q5_K_M"). Cutting only the end hides the part that tells two models apart,
// so a long name keeps its tail and gives up the middle. The full name is the tooltip and the
// accessible name (user review, 2026-09-19). Where it is cut lives in middle-split.ts.
export function MiddleTruncate({ text, className = '' }: { text: string; className?: string }): JSX.Element {
  const parts = splitMiddle(text);
  if (!parts) return <span className={`mid-trunc ${className}`} title={text}>{text}</span>;
  return <span className={`mid-trunc ${className}`} title={text} aria-label={text}>
    <span className="mid-trunc-head" aria-hidden="true">{parts.head}</span><span className="mid-trunc-tail" aria-hidden="true">{parts.tail}</span>
  </span>;
}
