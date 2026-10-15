/**
 * Formats whose coordinate system is Z-up by definition. three.js is Y-up, and these two
 * loaders do not convert, so the loaded root is turned -90° about X once, before anything
 * (centring, pins, measurement) reads its transforms. Every other format keeps its file's
 * own axes — STEP in particular already has stored comment pins in those coordinates.
 */
const Z_UP_EXTENSIONS: ReadonlySet<string> = new Set(['.3mf', '.3dm']);

export function isZUpExtension(dottedExt: string): boolean {
  return Z_UP_EXTENSIONS.has(dottedExt.toLowerCase());
}

/** Rotation about X that maps Z-up to Y-up. Assignment, not increment, so re-running is harmless. */
export const Z_UP_TO_Y_UP_X_ROTATION = -Math.PI / 2;
