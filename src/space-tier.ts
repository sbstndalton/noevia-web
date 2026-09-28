import { useEffect, useState } from 'react';

/** #510: decluttering follows the space the window has, not the device (owner rule,
 *  2026-09-28). Keep these in step with the media queries in styles/space-tiers.css.
 *  Tier 0: at least 1024 wide and 760 tall, everything shows.
 *  Tier 1: under 1024 wide or under 760 tall, low-value lines go.
 *  Tier 2: under 768 wide or under 600 tall, the full phone treatment. */
export const SPACE_TIER1_QUERY = '(max-width: 1023px), (max-height: 759px)';
export const SPACE_TIER2_QUERY = '(max-width: 767px), (max-height: 599px)';
export type SpaceTier = 0 | 1 | 2;

const read = (): SpaceTier => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 0;
  return window.matchMedia(SPACE_TIER2_QUERY).matches ? 2 : window.matchMedia(SPACE_TIER1_QUERY).matches ? 1 : 0;
};

/** The current space tier, tracking resizes and rotation. */
export function useSpaceTier(): SpaceTier {
  const [tier, setTier] = useState<SpaceTier>(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const queries = [SPACE_TIER1_QUERY, SPACE_TIER2_QUERY].map(q => window.matchMedia(q));
    const change = () => setTier(read());
    change();
    queries.forEach(q => q.addEventListener('change', change));
    return () => queries.forEach(q => q.removeEventListener('change', change));
  }, []);
  return tier;
}
