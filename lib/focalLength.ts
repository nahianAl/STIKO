/**
 * Camera focal length for the 3D viewer, in millimetres.
 *
 * Focal length is the source of truth and field of view is derived from it, because fov
 * alone is meaningless without the frame it is measured against. Unlike three's own
 * PerspectiveCamera, which derives the frame height from a fixed film WIDTH divided by the
 * viewport aspect, this module fixes the frame HEIGHT instead: one lens, one angle of view,
 * whatever shape the viewport is. See the note on `FRAME_HEIGHT` for why.
 *
 * The tests cross-check every preset against a real THREE.PerspectiveCamera (with its film
 * gauge pinned so its own aspect-dependence cancels out) so the arithmetic cannot drift.
 */

/**
 * The 35mm-format frame HEIGHT, in millimetres.
 *
 * three's PerspectiveCamera derives fov from a fixed film WIDTH divided by the viewport
 * aspect, which means the same lens gives a different angle of view on a differently-shaped
 * viewport — so merely collapsing a side panel would zoom the model. We fix the frame height
 * instead: one lens, one angle of view, whatever shape the viewport is. Resizing then reveals
 * or hides scene, as it did before this control existed, and the number on the control still
 * describes what is on screen.
 */
const FRAME_HEIGHT = 24;

/** Standard lens steps, wide to telephoto. Any value between them can still be typed. */
export const FOCAL_LENGTH_PRESETS: readonly number[] = [15, 24, 35, 50, 85, 135];

export const DEFAULT_FOCAL_LENGTH = 35;

/** Below this the projection is fisheye; above it, near enough orthographic to feel broken. */
export const MIN_FOCAL_LENGTH = 8;
export const MAX_FOCAL_LENGTH = 300;

/** Vertical field of view in DEGREES. Depends on the lens alone, never on the viewport. */
export function fovForFocalLength(focalLength: number): number {
  return (2 * Math.atan(FRAME_HEIGHT / (2 * focalLength)) * 180) / Math.PI;
}

export function clampFocalLength(value: number): number {
  return Math.min(MAX_FOCAL_LENGTH, Math.max(MIN_FOCAL_LENGTH, value));
}

/**
 * Turn what someone typed into a usable focal length, or give back what they had.
 *
 * Anything unusable returns `fallback` rather than a bad number: a NaN reaching
 * setFocalLength produces a NaN projection matrix and a blank viewport, with no error
 * raised anywhere to explain it.
 */
export function parseFocalLength(input: string, fallback: number): number {
  const cleaned = input.trim().replace(/\s*mm$/i, '').trim();
  if (cleaned === '') return fallback;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return fallback;

  return clampFocalLength(value);
}
