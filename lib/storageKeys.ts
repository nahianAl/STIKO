// Pure derivation of the optimized-variant S3 key from an original storage key. No
// environment dependency — unlike lib/s3.ts, which throws at import time when R2 env vars
// are absent, this module is safe to import from a unit test.
//
// The variant is always a sibling object next to the original: same directory prefix, same
// basename (extension stripped), with `.optimized.glb` appended. Deriving it here — rather
// than accepting it from a client — means the client can never name the object the viewer
// will later load.
export function optimizedVariantKey(originalStorageKey: string): string {
  if (originalStorageKey.endsWith('.optimized.glb')) return originalStorageKey;

  const lastSlash = originalStorageKey.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : originalStorageKey.slice(0, lastSlash + 1);
  const lastSegment = lastSlash === -1 ? originalStorageKey : originalStorageKey.slice(lastSlash + 1);

  const lastDot = lastSegment.lastIndexOf('.');
  const basename = lastDot === -1 ? lastSegment : lastSegment.slice(0, lastDot);

  return `${dir}${basename}.optimized.glb`;
}
