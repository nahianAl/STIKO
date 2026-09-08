import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { URL_WINDOW_MS, signingWindowStart } from './urlWindow.ts';

if (!process.env.R2_ACCESS_KEY_ID) throw new Error('R2_ACCESS_KEY_ID is not set');
if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error('R2_SECRET_ACCESS_KEY is not set');
if (!process.env.R2_ENDPOINT_URL) throw new Error('R2_ENDPOINT_URL is not set');
if (!process.env.R2_BUCKET_NAME) throw new Error('R2_BUCKET_NAME is not set');

export const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export const BUCKET = process.env.R2_BUCKET_NAME;

// Generate a presigned URL for a direct client → R2 PUT upload.
//
// When contentLength is given it is signed into the URL, so the client cannot
// PUT a body of a different size than the one the server approved. Without it
// the size check is advisory only: the caller declares a size, gets a URL, and
// could then upload anything.
export async function getUploadPresignedUrl(
  storageKey: string,
  contentType: string,
  expiresIn = 300, // 5 minutes
  contentLength?: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: contentType,
    ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
  });
  return getSignedUrl(s3, command, { expiresIn });
}

// Generate a presigned URL for the VIEWER's render path.
//
// Differs from getDownloadPresignedUrl in one way, and it is the whole point: the
// signing date is quantized to the start of the current window, so the same key
// produces a byte-identical URL for an hour. A URL string is the cache key for BOTH
// the browser's HTTP cache and useLoader's parsed-model cache, so the old behaviour —
// a fresh signature per call — meant a model the user merely returned to was
// re-downloaded and re-parsed every single time, while the previous parse was never
// freed. See docs/superpowers/specs/2026-09-08-model-load-caching-design.md.
//
// expiresIn is deliberately TWICE the window. A URL minted at the last second of a
// window is still being handed out then, so anything shorter would 403 while in use.
// The floor on remaining life is therefore exactly URL_WINDOW_MS — the same one hour
// the unquantized version guaranteed, so availability does not get worse.
//
// Revocation is a different property, and it DOES get weaker: it is governed by the
// ceiling, not the floor, and the ceiling doubles. A URL minted at the start of a
// window is valid for the full 2h, where the unquantized version capped every URL at
// 1h. This app has per-version invites and download authorization, so pulling
// someone's access now can leave a working URL for up to twice as long — and because
// the URL is byte-identical for every authorized caller within the window, a leaked
// link is effectively a shared capability for that long. Accepted deliberately, for
// the caching win described above; not a free property.
//
// Deliberately NOT folded into getDownloadPresignedUrl: that function also serves
// comment snapshots, comment attachments, conversion retries and the download route.
// None of them wants a stable URL, and the download route varies
// ResponseContentDisposition per request, which would defeat stability anyway.
export async function getViewerPresignedUrl(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    // Signed into the URL, so this needs no re-upload of the objects already in the
    // bucket — none of which carries a Cache-Control of its own. `private` because
    // these URLs are authorized per user and no shared cache should ever hold one.
    // `immutable` is honest: an upload key carries a fresh fileId per upload and is
    // never overwritten in place. This route (`/api/files/url`) also hands out
    // signed URLs for annotation-snapshot and comment-attachment keys, which are
    // equally safe to call immutable — both are UUID-derived and never overwritten
    // in place either. Anyone adding a caller for a key that CAN be overwritten in
    // place must not reuse `immutable` unmodified.
    ResponseCacheControl: `private, max-age=${URL_WINDOW_MS / 1000}, immutable`,
  });
  return getSignedUrl(s3, command, {
    expiresIn: (2 * URL_WINDOW_MS) / 1000,
    signingDate: signingWindowStart(Date.now()),
  });
}

// Generate a presigned URL for a direct client ← R2 GET download
export async function getDownloadPresignedUrl(
  storageKey: string,
  expiresIn = 3600, // 1 hour
  downloadFilename?: string
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    // Without this the browser navigates to the object and renders it in place;
    // a PDF or image would open rather than save. Only set when a filename is
    // given, so the viewer's own presigned URLs are unaffected.
    // A quote would end the header value early; a CR or LF would split it; a
    // backslash escapes the closing quote of the RFC 6266 quoted-string and
    // corrupts the header the same way a bare quote would. filename comes
    // from the upload request body, so none of this is hypothetical.
    ...(downloadFilename
      ? {
          ResponseContentDisposition: `attachment; filename="${downloadFilename.replace(/["\\\x00-\x1F\x7F]/g, '')}"`,
        }
      : {}),
  });
  return getSignedUrl(s3, command, { expiresIn });
}

// Construct the public URL for a stored object
export function getPublicUrl(storageKey: string): string {
  return `${process.env.R2_ENDPOINT_URL}/${BUCKET}/${storageKey}`;
}

export async function deleteObject(storageKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}

// Download a file from a remote URL and upload it to R2
export async function uploadFromUrl(
  remoteUrl: string,
  storageKey: string,
  contentType: string
): Promise<void> {
  const response = await fetch(remoteUrl);
  if (!response.ok) throw new Error(`Failed to fetch ${remoteUrl}`);
  const body = await response.arrayBuffer();

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: Buffer.from(body),
      ContentType: contentType,
    })
  );
}

/**
 * Remove several stored objects, best effort.
 *
 * Deliberately never throws. Callers run this *after* the database rows are
 * gone, so by the time it fails the user's intent is already satisfied; turning
 * a storage hiccup into a failed request would tell them the delete did not
 * happen when it did. A failure here leaves an orphaned object: invisible,
 * slightly costly, harmless.
 *
 * The reverse order — storage first — would risk a file gone from R2 but still
 * listed in the UI, which reads to the user as corruption.
 */
export async function deleteObjects(
  keys: (string | null | undefined)[]
): Promise<void> {
  const present = keys.filter(
    (k): k is string => typeof k === 'string' && k.length > 0
  );
  await Promise.all(
    present.map(async (key) => {
      try {
        await deleteObject(key);
      } catch (err) {
        console.error(`[s3] orphaned object, delete failed: ${key}`, err);
      }
    })
  );
}
