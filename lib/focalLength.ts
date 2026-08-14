/**
 * Camera focal length for the 3D viewer, in millimetres.
 *
 * Focal length is the source of truth and field of view is derived from it, because fov
 * alone is meaningless without the frame it is measured against. three models the frame as
 * a 35mm-wide gauge, so the same lens gives a different fov on a differently-shaped
 * viewport — which is why callers must re-apply the focal length when the viewport resizes
 * rather than setting fov once.
 *
 * The formulae below mirror three's own PerspectiveCamera. That duplication is deliberate:
 * the control needs to convert without holding a camera. The tests cross-check every preset
 * against a real THREE.PerspectiveCamera so the two cannot drift apart.
 */

/** three's PerspectiveCamera.filmGauge default: the film's WIDTH, in millimetres. */
const FILM_GAUGE = 35;

/** Standard lens steps, wide to telephoto. Any value between them can still be typed. */
export const FOCAL_LENGTH_PRESETS: readonly number[] = [15, 24, 35, 50, 85, 135];

export const DEFAULT_FOCAL_LENGTH = 35;

/** Below this the projection is fisheye; above it, near enough orthographic to feel broken. */
export const MIN_FOCAL_LENGTH = 8;
export const MAX_FOCAL_LENGTH = 300;

/** The film's height for a given aspect — a wider frame is a shorter one at fixed width. */
function filmHeight(aspect: number): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return FILM_GAUGE / Math.max(safeAspect, 1);
}

/** Vertical field of view in DEGREES, matching three's PerspectiveCamera.setFocalLength. */
export function fovForFocalLength(focalLength: number, aspect: number): number {
  return (2 * Math.atan(filmHeight(aspect) / (2 * focalLength)) * 180) / Math.PI;
}

/** The inverse, matching three's PerspectiveCamera.getFocalLength. */
export function focalLengthForFov(fov: number, aspect: number): number {
  const vExtentSlope = Math.tan(((fov / 2) * Math.PI) / 180);
  return (0.5 * filmHeight(aspect)) / vExtentSlope;
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
