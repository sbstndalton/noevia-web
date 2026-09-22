import { useLayoutEffect, useRef, type JSX, type KeyboardEvent } from 'react';

/** Keeps a track's glass thumb over its checked option, and marks the travel window. */
export function useSegmentThumb(deps: unknown[]) {
  const track = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const place = () => {
      const on = node.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!on) return;
      node.style.setProperty('--thumb-w', `${on.offsetWidth}px`);
      node.style.setProperty('--thumb-x', `${on.offsetLeft}px`);
      node.style.setProperty('--thumb-y', `${on.offsetTop}px`);
      node.style.setProperty('--thumb-h', `${on.offsetHeight}px`);
      node.dataset.wrapped = String([...node.querySelectorAll<HTMLElement>('button')].some(button => button.offsetTop !== node.querySelector<HTMLElement>('button')?.offsetTop));
      // A track that scrolls (too wide for its row) keeps the chosen option in view.
      if (node.scrollWidth > node.clientWidth) {
        const left = on.offsetLeft, right = left + on.offsetWidth;
        if (left < node.scrollLeft) node.scrollLeft = left;
        else if (right > node.scrollLeft + node.clientWidth) node.scrollLeft = right - node.clientWidth;
      }
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(node);
    // The options too: a scrolling track keeps its width while a label grows (a web font
    // arriving, the M3 check on the chosen option), and the thumb must follow it.
    node.querySelectorAll('button').forEach((b) => observer?.observe(b));
    return () => observer?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const moving = () => {
    const node = track.current;
    if (!node) return;
    node.classList.add('is-moving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => node.classList.remove('is-moving'), 380);
  };
  return { track, moving };
}

// A radio group drawn as one track with a glass thumb that slides to the chosen option
// (materials.css .glass-seg). In the liquid material the thumb refracts the labels while
// it travels; `.is-moving` marks that window. Arrow keys move the choice, as in a radio group.
export function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (value: T) => void;
}): JSX.Element {
  const { track, moving } = useSegmentThumb([value, options.length]);

  const choose = (next: T) => {
    if (next === value) return;
    moving();
    onChange(next);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = options.findIndex(([id]) => id === value);
    const next = options[(index + step + options.length) % options.length][0];
    choose(next);
    requestAnimationFrame(() => track.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };

  return <div ref={track} className="glass-seg" role="radiogroup" aria-label={label} onKeyDown={onKey}>
    {options.map(([id, text]) => <button key={id} type="button" role="radio" aria-checked={id === value}
      tabIndex={id === value ? 0 : -1} onClick={() => choose(id)}>{text}</button>)}
    <span className="glass-thumb glass glass-lens" aria-hidden="true" />
  </div>;
}
