import type { JSX } from 'react';

// Model names differ at both ends: the family at the start, the size and quantization at the
// end ("Qwen3.5-4B-…-Q5_K_M"). Cutting only the end hides the part that tells two models apart,
// so a long name keeps its tail and gives up the middle. The full name is the tooltip and the
// accessible name (user review, 2026-09-19).
const TAIL = 10;

export function MiddleTruncate({ text, className = '' }: { text: string; className?: string }): JSX.Element {
  if (text.length <= TAIL + 6) return <span className={`mid-trunc ${className}`} title={text}>{text}</span>;
  const head = text.slice(0, -TAIL), tail = text.slice(-TAIL);
  return <span className={`mid-trunc ${className}`} title={text} aria-label={text}>
    <span className="mid-trunc-head" aria-hidden="true">{head}</span><span className="mid-trunc-tail" aria-hidden="true">{tail}</span>
  </span>;
}
