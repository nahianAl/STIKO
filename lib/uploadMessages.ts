/**
 * Copy for the banner both upload screens show when a run left files behind.
 *
 * Pure and dependency-free so it can be unit tested under plain `node --test`
 * (lib/useUpload.ts is a React hook) and shared by the new-package page and the
 * add-submission drawer rather than copied between them.
 *
 * `blocked` is the hook's `wasBlocked()`: a full plan reads differently to a flaky
 * network, and only the former is fixed by upgrading rather than by trying again.
 */
export function notUploadedMessage(blocked: boolean): string {
  return blocked
    ? 'Storage is full, so some files weren’t uploaded. Upgrade or free up space, then retry them.'
    : 'Some files didn’t upload. Retry them — nothing is published until they all land.';
}
