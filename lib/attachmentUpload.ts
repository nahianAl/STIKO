/**
 * Validation and bounds for comment attachment uploads.
 *
 * The route this serves used to mint a presigned R2 PUT URL from a filename and
 * content type supplied by anyone at all — no auth() call, no size limit, no
 * type restriction. It is exempt from middleware because '/api/comments' in
 * PUBLIC_PATHS is a prefix match that also covers '/api/comments/attachments'.
 * That made it an unauthenticated, unmetered write into the bucket.
 *
 * Kept out of the route so it can be tested: this project's runner
 * (`node --test scripts/tests/*.mjs`) cannot exercise a Next.js route handler.
 */

/**
 * Types refused because a browser RENDERS them, which would make a stored file
 * an XSS payload on whatever origin serves it.
 *
 * Deliberately a narrow deny-list rather than an allow-list. The comment
 * attachment input (components/portal/CommentsPanel.tsx) has no `accept`
 * attribute — arbitrary documents are the feature — so an allow-list here would
 * break it. lib/snapshotUpload.ts can afford a strict allow-list because it
 * stores only viewport captures.
 */
export const BLOCKED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/xml',
  'text/xml',
]);

/** 25 MB. Comfortably above a large drawing PDF or a phone photo. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentValidation =
  | { ok: true; filename: string; contentType: string; size: number; extension: string }
  | { ok: false; reason: 'malformed' | 'unsupported_type' | 'too_large' };

export function validateAttachmentRequest(input: unknown): AttachmentValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'malformed' };
  }

  const { filename, contentType, size } = input as Record<string, unknown>;

  if (typeof filename !== 'string' || !filename) return { ok: false, reason: 'malformed' };
  if (typeof contentType !== 'string' || !contentType) return { ok: false, reason: 'malformed' };

  // Required, not defaulted: the declared size is what bounds the presigned URL,
  // so accepting a request without one would leave no cap at all.
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    return { ok: false, reason: 'malformed' };
  }

  // Compare on the bare media type: 'text/html; charset=utf-8' is still HTML,
  // and casing is not significant in a media type.
  const bare = contentType.split(';')[0].trim().toLowerCase();
  if (BLOCKED_CONTENT_TYPES.has(bare)) return { ok: false, reason: 'unsupported_type' };

  if (size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'too_large' };

  // The storage key is built from this, so it must not be able to carry a path
  // segment out of the namespace.
  const dot = filename.lastIndexOf('.');
  const raw = dot === -1 ? '' : filename.slice(dot);
  const extension = /[/\\ ]/.test(raw) ? '' : raw;

  return { ok: true, filename, contentType, size, extension };
}
