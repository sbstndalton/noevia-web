/** Produce an operator-applied setting, not a per-user override of the diary clock. */
export function timezoneEnvSetting(value: string): string | null {
  const zone = value.trim();
  // IANA names only: exclude offsets and .env metacharacters before rendering a setting.
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(zone)) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return `TZ=${zone}`;
  } catch {
    return null;
  }
}
