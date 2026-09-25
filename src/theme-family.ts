// Theme families (#249): a complete visual language — palette treatment for light and dark,
// a typeface pairing, and a radius / elevation / motion profile. Accent (data-palette) and
// light/dark (data-theme) stay independent and still sync through the profile; the family is
// a per-device presentation preference like chat font and density (preferences.ts).
//
// Families subsume the retired "materials": a saved `noevia:material` still resolves, so a
// browser that chose Soft, Material 3 or Liquid glass lands on its successor without a flash.
// public/theme.js repeats FAMILY_MIGRATION before paint; tests/theme-family.test.cjs checks
// that both copies agree.

export const FAMILIES = ['editorial', 'contemporary', 'glass'] as const;
export type Family = typeof FAMILIES[number];

export const FAMILY_KEY = 'noevia:theme-family';
export const LEGACY_MATERIAL_KEY = 'noevia:material';
export const DEFAULT_FAMILY: Family = 'editorial';

/** Retired material → the family that replaced it. */
export const FAMILY_MIGRATION: Readonly<Record<string, Family>> = {
  soft: 'editorial',
  material: 'contemporary',
  liquid: 'glass',
};

export interface FamilySpec {
  label: string;
  description: string;
  /** Display face (greeting, page titles) and interface face, as shown in Settings. */
  display: string;
  ui: string;
}

export const FAMILY_SPECS: Readonly<Record<Family, FamilySpec>> = {
  editorial: {
    label: 'Editorial',
    description: 'Paper tones, a serif display face and hairline rules instead of shadows.',
    display: 'Fraunces',
    ui: 'Inter',
  },
  contemporary: {
    label: 'Contemporary',
    description: 'Material 3: tonal surfaces, rounder cards and sheets, and pill buttons.',
    display: 'Geist',
    ui: 'Geist',
  },
  glass: {
    label: 'Glass',
    description: 'Frosted, translucent panes with a bright edge over a soft colour field.',
    display: 'Sora',
    ui: 'Manrope',
  },
};

export function isFamily(value: unknown): value is Family {
  return typeof value === 'string' && (FAMILIES as readonly string[]).includes(value);
}

/** The family to show: a saved family wins, then a migrated material, then the default. */
export function resolveFamily(saved: unknown, legacyMaterial?: unknown): Family {
  if (isFamily(saved)) return saved;
  if (typeof legacyMaterial === 'string' && Object.prototype.hasOwnProperty.call(FAMILY_MIGRATION, legacyMaterial)) return FAMILY_MIGRATION[legacyMaterial];
  return DEFAULT_FAMILY;
}

/** Reads storage defensively (blocked storage resolves to the default). */
export function storedFamily(storage: Pick<Storage, 'getItem'> | null | undefined): Family {
  try { return resolveFamily(storage?.getItem(FAMILY_KEY), storage?.getItem(LEGACY_MATERIAL_KEY)); } catch { return DEFAULT_FAMILY; }
}
