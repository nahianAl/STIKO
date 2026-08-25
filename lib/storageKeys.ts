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
