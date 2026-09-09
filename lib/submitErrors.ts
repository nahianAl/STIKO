/**
 * Plain-language messages for a failed submit.
 *
 * Pure and dependency-free so it can be unit tested under `node --test`, and
 * shared by both comment composers rather than duplicated.
 *
 * Exists because both submit paths used to ignore `res.ok` entirely: `fetch` only
 * rejects on a network failure, so a 401, 403 or 500 resolved normally and the
 * callers cleared the user's text, attachments and pending pin as though the post
 * had succeeded. The comment never reached the database and there was nothing left
 * to resend. Naming the cause is what makes the retry actionable.
 */
export function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      // The likeliest cause by far. /api/comments is in PUBLIC_PATHS, so an
      // expired session is not redirected to login — it returns a JSON 401.
      return 'Your session has expired. Sign in again, then send this once more.';
    case 403:
      return 'You do not have permission to comment on this package.';
    case 404:
      return 'This file is no longer available. It may have been deleted.';
    case 413:
      return 'That attachment is too large to upload.';
    case 429:
      return 'Too many requests just now. Wait a moment and send again.';
    default:
      if (status >= 500) {
        return 'Stiko could not save this just now. Your text has been kept — try again.';
      }
      if (status >= 400) {
        return 'Stiko could not accept this comment. Your text has been kept.';
      }
      // status 0 / no response: the request never reached the server.
      return 'Could not reach Stiko. Check your connection — your text has been kept.';
  }
}
