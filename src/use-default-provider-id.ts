import { useEffect, useState } from 'react';
import { fetchProviders } from './api';

/** The id the server treats as the built-in local provider (DEFAULT_PROVIDER_ID, 'default' unless
 *  an operator changed it). modelChoiceLabel needs it to tell a local choice from another provider
 *  (#876). It is fixed per server run, so one successful read serves the whole page. */
let known: string | null = null;
let inflight: Promise<string> | null = null;

export function loadDefaultProviderId(load: typeof fetchProviders = fetchProviders): Promise<string> {
  if (known) return Promise.resolve(known);
  inflight ||= load().then((r) => {
    known = r.providers.find((p) => p.isDefault)?.id || 'default';
    return known;
  }).finally(() => { inflight = null; });
  return inflight;
}

/** 'default' until the registry has been read (or if it cannot be read), then the real id. */
export function useDefaultProviderId(): string {
  const [id, setId] = useState(known || 'default');
  useEffect(() => {
    let live = true;
    loadDefaultProviderId().then((v) => { if (live) setId(v); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return id;
}
