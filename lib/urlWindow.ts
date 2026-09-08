/**
 * Quantized signing windows for presigned viewer URLs.
 *
 * Deliberately NOT in lib/s3.ts: that module throws at import time when the R2 env
 * vars are absent, so nothing declared there can be unit tested. lib/storageKeys.ts
 * exists apart from it for exactly the same reason.
 */

/** One hour. A key yields a byte-identical viewer URL for the whole window. */
export const URL_WINDOW_MS = 60 * 60 * 1000;

/**
 * Floor a timestamp to the start of its signing window.
 *
 * Presigning against this instead of the current instant is the whole trick.
 * X-Amz-Date is the only per-call input to the signature that varies, so quantizing
 * it makes every call within a window produce an identical URL — and that URL string
 * is the cache key for both the browser's HTTP cache and useLoader's parsed-model
 * cache. A URL that changes per call silently defeats both.
 */
export function signingWindowStart(
  nowMs: number,
  windowMs: number = URL_WINDOW_MS
): Date {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}
