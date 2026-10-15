// #1761: since noevia-core #1758 a chat model that llama.cpp put to sleep after its idle time
// (#1747) reports `loaded: true` with `status: 'sleeping'`: it is still available (the next request
// wakes it in a few seconds) but its weights are no longer in memory. Every place that says
// "Loaded" asks here, so a sleeping model never reads as loaded.
export const isSleeping = (m: { status?: string } | null | undefined): boolean => m?.status === 'sleeping';
/** Loaded and holding its weights now. */
export const isResident = (m: { loaded?: boolean; status?: string } | null | undefined): boolean => !!m?.loaded && !isSleeping(m);
