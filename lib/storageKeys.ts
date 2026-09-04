import { extensionOf } from './fileFormats.ts';

/**
 * S3 key derivation, kept pure and free of environment access.
 *
 * Deliberately NOT in lib/s3.ts: that module throws at import time when the R2 env vars
 * are absent, so nothing there can be unit tested. fileFormats.ts has the same property, so
 * it's safe to import extensionOf from there instead of re-deriving it here.
 *
 * The variant key is always DERIVED, never accepted from a caller. An earlier draft let
 * the client name it, which hands out a presigned PUT for an arbitrary key — and that
 * object is exactly what the 3D viewer loads.
 */

/**
 * Only 'glb', not 'gltf': optimizeGlb uses WebIO.readBinary, which parses binary GLB only.
 * A JSON .gltf throws "Invalid glTF 2.0 binary." there every time, so advertising it as
 * optimizable just wastes a presign, a full read and a worker spawn before falling back.
 */
export const OPTIMIZABLE_EXTENSIONS: ReadonlySet<string> = new Set(['glb']);

const OPTIMIZED_SUFFIX = '.optimized.glb';

export function isOptimizableFilename(filename: string): boolean {
  return OPTIMIZABLE_EXTENSIONS.has(extensionOf(filename));
}

/**
 * STEP is tessellated by OCCT, not by the gltf-transform chain, so it is a SEPARATE
 * predicate from isOptimizableFilename rather than another member of that set. Both
 * produce the same `.optimized.glb` variant key, because both produce the object the
 * viewer should load instead of the original.
 */
export const TESSELLATABLE_EXTENSIONS: ReadonlySet<string> = new Set(['stp', 'step']);

export function isTessellatableFilename(filename: string): boolean {
  return TESSELLATABLE_EXTENSIONS.has(extensionOf(filename));
}

/** True when uploading this file should also produce a viewer variant. */
export function producesViewerVariant(filename: string): boolean {
  return isOptimizableFilename(filename) || isTessellatableFilename(filename);
}

export function optimizedVariantKey(originalStorageKey: string): string {
  if (originalStorageKey.endsWith(OPTIMIZED_SUFFIX)) return originalStorageKey;

  const slash = originalStorageKey.lastIndexOf('/');
  const directory = originalStorageKey.slice(0, slash + 1);
  const base = originalStorageKey.slice(slash + 1);

  // Only the last segment is examined, so a dot in a project or portal name is safe.
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;

  return `${directory}${stem}${OPTIMIZED_SUFFIX}`;
}

export const SNAPSHOT_PREFIX = 'snapshots/';
export const COMMENT_ATTACHMENT_PREFIX = 'comment-attachments/';

/**
 * The one key an upload may claim.
 *
 * Derived identically to app/api/files/upload/route.ts, and compared against
 * rather than trusted: /api/files/complete used to insert whatever key it was
 * handed, and a forged one now names bytes that deletion destroys.
 */
export function uploadStorageKey(parts: {
  projectId: string;
  portalId: string;
  versionId: string;
  fileId: string;
  filename: string;
}): string {
  const { projectId, portalId, versionId, fileId, filename } = parts;
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  return `uploads/${projectId}/${portalId}/${versionId}/${fileId}${ext}`;
}

/**
 * A key a comment may name.
 *
 * Snapshots and attachments live in their own prefixes, so a key pointing into
 * uploads/ is always forged — no legitimate comment ever references a file
 * object directly. An http(s) URL or an inline data URI is not a stored object
 * at all and is left alone, matching how app/api/comments/route.ts decides
 * whether to presign snapshot_url.
 */
export function isAllowedCommentKey(value: string): boolean {
  if (value.startsWith('http') || value.startsWith('data:')) return true;
  return (
    value.startsWith(SNAPSHOT_PREFIX) ||
    value.startsWith(COMMENT_ATTACHMENT_PREFIX)
  );
}
