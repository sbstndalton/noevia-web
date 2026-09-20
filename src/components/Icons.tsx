import type { JSX } from 'react';
import { Icon } from './icons/Icon';

export function Logo(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="3.5" fill="color-mix(in srgb, var(--accent) 45%, var(--bg-app))" />
      <rect x="9" y="9" width="12" height="12" rx="3.5" fill="var(--accent)" />
    </svg>
  );
}

// Named wrappers kept for existing call sites; all draw from the same Lucide set.
export const PinIcon = (): JSX.Element => <Icon name="pin" size={16} />;
export const CircleIcon = (): JSX.Element => <Icon name="circle" size={15} />;
export const PlusIcon = (): JSX.Element => <Icon name="plus" size={15} strokeWidth={2} />;
export const SlidersIcon = ({ size = 15 }: { size?: number }): JSX.Element => <Icon name="sliders-horizontal" size={size} />;
export const ChevronDown = (): JSX.Element => <Icon name="chevron-down" size={12} strokeWidth={2.25} />;
export const ChevronLeft = (): JSX.Element => <Icon name="chevron-left" size={14} strokeWidth={2.25} />;
export const ChevronRight = (): JSX.Element => <Icon name="chevron-right" size={14} strokeWidth={2.25} />;
export const ArrowRight = (): JSX.Element => <Icon name="arrow-right" size={13} strokeWidth={2.25} />;
export const LockIcon = (): JSX.Element => <Icon name="lock" size={13} strokeWidth={2} />;
export const SendIcon = (): JSX.Element => <Icon name="arrow-up" size={18} strokeWidth={2} />;
export const BookIcon = (): JSX.Element => <Icon name="book-open" size={15} />;
export const SunIcon = (): JSX.Element => <Icon name="sun" size={15} />;
export const MoonIcon = (): JSX.Element => <Icon name="moon" size={15} />;
