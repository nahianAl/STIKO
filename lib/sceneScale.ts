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
  /** Y offset of the ground plane, relative to the model's base: two steps below it. */
  groundY: number;
  /** Y offset of the contact shadow, relative to the model's base: between the ground and the base. */
  shadowY: number;
  /** Y offset of the axis lines, relative to the model's base: one step above it, so they read on top. */
  axesY: number;
}

const GROUND_RADIUS_FACTOR = 4;
const AXIS_HALF_LENGTH_FACTOR = 2;
const SHADOW_SCALE_FACTOR = 2.5;

// Proportional, not fixed: a constant offset disappears into z-fighting on a 5,000-unit
// model and becomes a visible floating gap on a 1-unit one.
//
// 5e-3 rather than 1e-3, measured in the viewport: the camera's far/near ratio is 1e5, which
// at a radius-8660 model puts depth-buffer precision around 15 world units at viewing
// distance. A 1e-3 factor separated the stack by only ~26 units there and the axis lines
// rendered visibly dashed where they lost the depth test against the ground.
const SURFACE_OFFSET_FACTOR = 5e-3;

export function sceneScaleForRadius(radius: number): SceneScale {
  // An empty or degenerate model still needs a usable scene rather than NaN.
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;

  const offset = r * SURFACE_OFFSET_FACTOR;

  return {
    groundRadius: r * GROUND_RADIUS_FACTOR,
    axisHalfLength: r * AXIS_HALF_LENGTH_FACTOR,
    surfaceOffset: offset,
    shadowScale: r * SHADOW_SCALE_FACTOR,
    // The stack lives here rather than in the components so the ordering is one tested fact
    // instead of a convention each consumer has to remember.
    //
    // All three values are offsets RELATIVE TO THE MODEL'S BASE — the caller positions a group
    // at the model's base and renders the furniture inside it. The whole stack sits BELOW that
    // base. That is not cosmetic: drei's ContactShadows aims an orthographic camera straight UP
    // from its own position, so it only captures geometry above it. Place the shadow above the
    // base and the model's underside falls behind that camera, and no shadow renders at all —
    // verified in the viewport, where moving it above the base made the shadow vanish entirely.
    groundY: offset * -2,
    shadowY: offset * -1,
    // Axes go above the base instead, or the ground would draw over them.
    axesY: offset,
  };
}
