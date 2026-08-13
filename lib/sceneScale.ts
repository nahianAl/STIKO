/**
 * Sizes for the viewer's scene furniture — ground plane, contact shadow, axis lines.
 *
 * The viewer loads geometry with no unit convention, so bounding radii span at least 1 to
 * 10,000. Anything authored at a fixed size is either invisible or overwhelming at most of
 * that range: the grid this replaces was 10 units wide, which vanished on any real model.
 * Every value here is therefore a multiple of the model's bounding radius.
 */

export interface SceneScale {
  /** Radius of the ground disc, including its faded rim. */
  groundRadius: number;
  /** Half-length of the X and Z lines, which span -axisHalfLength to +axisHalfLength. */
  axisHalfLength: number;
  /** Vertical step used to stack coplanar surfaces without z-fighting. */
  surfaceOffset: number;
  /** Half-extent of the contact shadow's footprint. */
  shadowScale: number;
}

const GROUND_RADIUS_FACTOR = 4;
const AXIS_HALF_LENGTH_FACTOR = 2;
const SHADOW_SCALE_FACTOR = 2.5;

// Proportional, not fixed: a constant offset disappears into z-fighting on a 5,000-unit
// model and becomes a visible floating gap on a 1-unit one.
const SURFACE_OFFSET_FACTOR = 1e-3;

export function sceneScaleForRadius(radius: number): SceneScale {
  // An empty or degenerate model still needs a usable scene rather than NaN.
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;

  return {
    groundRadius: r * GROUND_RADIUS_FACTOR,
    axisHalfLength: r * AXIS_HALF_LENGTH_FACTOR,
    surfaceOffset: r * SURFACE_OFFSET_FACTOR,
    shadowScale: r * SHADOW_SCALE_FACTOR,
  };
}
