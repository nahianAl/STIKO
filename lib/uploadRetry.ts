/**
 * Retry policy for direct-to-R2 uploads.
 *
 * Deliberately pure and dependency-free, so it can be unit tested under plain
 * `node --test` — lib/useUpload.ts is a React hook and this repo has no React
 * test harness. Same reason lib/storageKeys.ts lives apart from lib/s3.ts.
 *
 * Why this exists: the browser PUTs files straight to R2, and that connection can
 * be reset by anything between the two — flaky wifi, a VPN, a corporate proxy
 * doing TLS inspection, a laptop suspending. Before this, `xhr.onerror` rejected
 * immediately, so a single blip permanently failed an upload that would have
 * succeeded on the very next try. Observed 2026-09-08: a 23MB GLB failed three
 * times with ERR_CONNECTION_RESET for one user, while the identical file uploaded
 * from another network in 14 seconds.
 */

/**
 * Total attempts, not retries — 4 means one try and three more.
 *
 * Bounded on both sides on purpose. Fewer than three barely covers a transient
 * reset; more keeps a doomed upload spinning long past the point the user should
 * be told it failed and offered the manual retry.
 */
export const MAX_UPLOAD_ATTEMPTS = 4;

/** First backoff, doubling each attempt. */
const BASE_DELAY_MS = 1000;

/**
 * Ceiling on a single wait. The presigned URL is reused across attempts, so the
 * backoff spends its lifetime — an unbounded wait would eventually retry against
 * a URL that has already expired, turning a retriable reset into a certain 403.
 */
const MAX_DELAY_MS = 8000;

/**
 * Should a failed attempt be tried again?
 *
 * `status` is the HTTP status, or null/0 when the request never produced one —
 * which is exactly what `xhr.onerror` reports for a connection reset, and the case
 * this policy exists to absorb.
 *
 * Client-caused rejections are deliberately NOT retried. A 403 is an expired or
 * malformed signature and will never pass; a 400 means the request itself is
 * wrong. Retrying either just burns the URL's remaining lifetime to arrive at the
 * same answer more slowly.
 */
export function isRetriableUploadFailure(status: number | null | undefined): boolean {
  // No status at all: a network-level failure, which is the retriable case.
  if (status === null || status === undefined || status === 0) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

/**
 * How long to wait before attempt `attempt` (0-based: 0 is the wait after the
 * first failure).
 *
 * Deterministic, with no random jitter. Jitter exists to spread a thundering herd
 * of independent clients; here the contenders are at most a handful of files in
 * one user's own upload pool, so it would buy nothing and would make the growth
 * curve untestable.
 */
export function retryDelayMs(attempt: number): number {
  const exponential = BASE_DELAY_MS * 2 ** Math.max(0, attempt);
  return Math.min(exponential, MAX_DELAY_MS);
}
