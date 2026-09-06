/**
 * Parsing and bounds for viewport snapshot uploads.
 *
 * Kept out of the route so it can be tested: this project's runner
 * (`node --test scripts/tests/*.mjs`) cannot exercise a Next.js route handler.
 *
 * The route this serves used to accept a data URL from anyone, with a content
 * type matched by `[\w/+-]+` and no size limit. Everything written to R2 is
 * served back to browsers, so a caller-chosen `text/html` was stored XSS on our
 * own origin, and the missing cap was an unmetered write into the bucket.
 */

/** Snapshots are viewport captures. These are the only two types the client produces. */
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png' } as const;

type AllowedType = keyof typeof ALLOWED;

/**
 * 8 MB decoded. A 4K viewport JPEG lands well under 2 MB, so this is generous
 * enough not to reject legitimate captures and small enough to bound the write.
 */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export type SnapshotParse =
  | { ok: true; contentType: AllowedType; buffer: Buffer; extension: 'jpg' | 'png' }
  | { ok: false; reason: 'malformed' | 'unsupported_type' | 'too_large' };

/** Shape check only — the type is validated separately so we can say which failed. */
const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

export function parseSnapshotDataUrl(dataUrl: unknown): SnapshotParse {
  if (typeof dataUrl !== 'string') return { ok: false, reason: 'malformed' };

  const match = dataUrl.match(DATA_URL);
  if (!match) return { ok: false, reason: 'malformed' };

  const contentType = match[1];
  const base64 = match[2];

  if (!(contentType in ALLOWED)) return { ok: false, reason: 'unsupported_type' };

  // Bound the size from the encoded length before decoding. Buffer.from on a
  // 200 MB base64 string allocates 150 MB before there is any chance to reject
  // it, which turns the cap into the very exhaustion it exists to prevent.
  // Four base64 characters carry three bytes.
  if (Math.floor((base64.length * 3) / 4) > MAX_SNAPSHOT_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_SNAPSHOT_BYTES) return { ok: false, reason: 'too_large' };

  const type = contentType as AllowedType;
  return { ok: true, contentType: type, buffer, extension: ALLOWED[type] };
}
