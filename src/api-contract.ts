// Browser/core protocol major. A breaking change introduces a new major; additive
// fields keep the current one. This marker is separate from the release/build SHA.
export const API_MAJOR = '1';

export type ApiCompatibility = 'compatible' | 'mismatch' | 'unavailable';

function isDifferentMajor(servedMajor: string | null): boolean {
  // The pre-contract core already serves v1 routes. Accept a missing marker
  // during rollout and rollback; only an explicit different major is unsafe.
  return servedMajor !== null && servedMajor !== API_MAJOR;
}

export async function checkApiCompatibility(fetcher: typeof fetch = fetch, timeoutMs = 5000): Promise<ApiCompatibility> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('/api/ready', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return 'unavailable';
    return isDifferentMajor(response.headers.get('X-Noevia-API')) ? 'mismatch' : 'compatible';
  } catch {
    // An offline or starting server is handled by the existing connection error path.
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

export function hasApiMajorMismatch(response: Response): boolean {
  // A gateway error without the core's header is a reachability failure, not
  // evidence that a different API major is serving the request.
  return hasApiMajorMismatchHeader(response.headers?.get?.('X-Noevia-API') ?? null, response.status);
}

export function hasApiMajorMismatchHeader(major: string | null, status: number): boolean {
  return status < 500 && isDifferentMajor(major);
}
