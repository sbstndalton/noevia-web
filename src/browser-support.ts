/**
 * Is this hostname an IP address (v4 or v6)? WebAuthn's RP ID must be a
 * valid domain string — browsers refuse the ceremony outright on an
 * IP-address origin, public or private, regardless of server config. Used
 * to give a real explanation instead of a generic "cancelled or failed".
 */
export function isIpAddressHost(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
}

export type OriginClass = 'public-https' | 'loopback' | 'private-lan-http' | 'invalid';

/**
 * Categorize a candidate PUBLIC_ORIGIN the way the wizard's setup step (and
 * the server's matching check in auth.cjs's setup()) will treat it:
 * - public-https: any https:// origin — recommended, passkeys work.
 * - loopback: http://localhost, http://127.0.0.1, http://[::1] — fine for
 *   single-machine use, not reachable from other devices.
 * - private-lan-http: a private-network http:// origin (RFC1918 IPv4
 *   literal, or a bare no-dot LAN hostname like `http://myserver:8021`) —
 *   allowed, but passkeys and other secure-context browser APIs won't work
 *   here, and it's not reachable outside the LAN.
 * - invalid: anything else, notably a public-looking http://domain.tld —
 *   must use https:// instead.
 *
 * IMPORTANT: keep this in sync with isAcceptablePublicOrigin() in
 * apps/web/server/auth.cjs — same categories, same private-IPv4 ranges.
 * They can't literally share code (this is a Vite/ESM TS module, that's a
 * Node CJS module) but they must agree, or the wizard could show a green
 * light for an origin the server then rejects.
 */
export function classifyOrigin(originStr: string): OriginClass {
  let u: URL;
  try {
    u = new URL(originStr);
  } catch {
    return 'invalid';
  }
  const host = u.hostname;
  if (u.protocol === 'https:') return 'public-https';
  if (u.protocol !== 'http:') return 'invalid';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'loopback';
  const isPrivateIPv4 =
    /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const isBareLanHost = host !== '' && !host.includes('.') && !host.includes(':');
  if (isPrivateIPv4 || isBareLanHost) return 'private-lan-http';
  return 'invalid';
}
