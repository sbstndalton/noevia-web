import { createElement, useId, type JSX } from 'react';
import { Icon } from './icons/Icon';
import { LEAF_LOGO, type LeafLogoNode } from './leafLogoGeometry';

// The noevia mark: three leaves emerging at the tip of a bare twig. Geometry
// and shading come from the generated element list in leafLogoGeometry.ts
// (same source as public/icon.svg and icon-maskable.svg, built by
// scripts/logo-geometry.cjs).
//
// '@ID' in attribute values is replaced with a per-instance prefix so
// gradient/clip ids never collide when several logos share a page.
function renderLeafNodes(nodes: LeafLogoNode[], prefix: string): JSX.Element[] {
  return nodes.map((n, i) => {
    const attrs: Record<string, string | number> = { key: i };
    for (const [k, v] of Object.entries(n.attrs)) attrs[k] = typeof v === 'string' ? v.replace(/@ID/g, prefix) : v;
    return createElement(n.tag, attrs, n.children ? renderLeafNodes(n.children, prefix) : undefined);
  });
}

export function Logo(): JSX.Element {
  const prefix = `noevia-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      {renderLeafNodes(LEAF_LOGO, prefix)}
    </svg>
  );
}

// Named wrappers kept for existing call sites; all draw from the same Lucide set.
export const PlusIcon = (): JSX.Element => <Icon name="plus" size={15} strokeWidth={2} />;
export const SlidersIcon = ({ size = 15 }: { size?: number }): JSX.Element => <Icon name="sliders-horizontal" size={size} />;
export const ChevronDown = (): JSX.Element => <Icon name="chevron-down" size={12} strokeWidth={2.25} />;
export const ChevronLeft = (): JSX.Element => <Icon name="chevron-left" size={14} strokeWidth={2.25} />;
export const ArrowRight = (): JSX.Element => <Icon name="arrow-right" size={13} strokeWidth={2.25} />;
export const SendIcon = (): JSX.Element => <Icon name="arrow-up" size={18} strokeWidth={2} />;
