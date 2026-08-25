/**
 * S3 key derivation, kept pure and free of environment access.
 *
 * Deliberately NOT in lib/s3.ts: that module throws at import time when the R2 env vars
 * are absent, so nothing there can be unit tested.
 *
 * The variant key is always DERIVED, never accepted from a caller. An earlier draft let
 * the client name it, which hands out a presigned PUT for an arbitrary key — and that
 * object is exactly what the 3D viewer loads.
 */

/** gltf-transform operates on glTF documents; no other format Stiko accepts is one. */
export const OPTIMIZABLE_EXTENSIONS: ReadonlySet<string> = new Set(['glb', 'gltf']);

const OPTIMIZED_SUFFIX = '.optimized.glb';

export function isOptimizableFilename(filename: string): boolean {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  // dot === 0 is a hidden file ('.glb'), which has no extension at all.
  if (dot <= 0) return false;
  return OPTIMIZABLE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
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
