// Rough hemisphere from the browser time zone, so the seasonal logo is right for most people
// without a location prompt and without sending anything anywhere. Unknown, missing or
// equatorial zones (for example Asia/Jakarta, Africa/Nairobi, America/Bogota, Pacific/Galapagos)
// stay "north": near the equator the seasons barely change the light, so either answer is fine.
import type { Hemisphere } from './logo-calendar';

// Whole regions that lie in the southern hemisphere.
const SOUTH_PREFIXES = ['Australia/', 'Antarctica/', 'America/Argentina/', 'Brazil/', 'Chile/'];
// Single zones (IANA ids, plus the common legacy aliases) with a southern main city.
const SOUTH_ZONES = new Set([
  // Oceania
  'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Fiji', 'Pacific/Tongatapu', 'Pacific/Apia', 'Pacific/Noumea',
  'Pacific/Efate', 'Pacific/Norfolk', 'Pacific/Easter', 'Pacific/Tahiti', 'Pacific/Marquesas', 'Pacific/Gambier',
  'Pacific/Pitcairn', 'Pacific/Rarotonga', 'Pacific/Niue', 'Pacific/Pago_Pago', 'Pacific/Fakaofo', 'Pacific/Wallis',
  'NZ', 'NZ-CHAT',
  // South America
  'America/Sao_Paulo', 'America/Bahia', 'America/Recife', 'America/Maceio', 'America/Araguaina', 'America/Cuiaba',
  'America/Campo_Grande', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Eirunepe', 'America/Lima',
  'America/La_Paz', 'America/Santiago', 'America/Punta_Arenas', 'America/Asuncion', 'America/Montevideo',
  'America/Buenos_Aires', 'America/Cordoba', 'America/Mendoza', 'America/Jujuy', 'America/Catamarca', 'America/Rosario',
  // Southern Africa and the Indian Ocean
  'Africa/Johannesburg', 'Africa/Maseru', 'Africa/Mbabane', 'Africa/Windhoek', 'Africa/Gaborone', 'Africa/Harare',
  'Africa/Maputo', 'Africa/Lusaka', 'Africa/Blantyre', 'Africa/Lubumbashi', 'Africa/Luanda',
  'Indian/Antananarivo', 'Indian/Mauritius', 'Indian/Reunion', 'Indian/Mayotte', 'Indian/Comoro', 'Indian/Kerguelen',
  // South Atlantic
  'Atlantic/St_Helena', 'Atlantic/South_Georgia', 'Atlantic/Stanley',
]);

export function hemisphereForTimeZone(timeZone: string | null | undefined): Hemisphere {
  if (typeof timeZone !== 'string') return 'north';
  const zone = timeZone.trim();
  if (SOUTH_ZONES.has(zone) || SOUTH_PREFIXES.some(prefix => zone.startsWith(prefix))) return 'south';
  return 'north';
}

/** The device's hemisphere; "north" if the time zone cannot be read. */
export function detectHemisphere(): Hemisphere {
  try { return hemisphereForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return 'north'; }
}
