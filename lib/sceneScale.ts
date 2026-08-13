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
  /** Y position of the ground plane: two steps below the model's base, which rests at y=0. */
  groundY: number;
  /** Y position of the contact shadow: between the ground and the model's base. */
  shadowY: number;
  /** Y position of the axis lines: one step above the model's base, so they read on top. */
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

  return {
    groundRadius: r * GROUND_RADIUS_FACTOR,
    axisHalfLength: r * AXIS_HALF_LENGTH_FACTOR,
    surfaceOffset: r * SURFACE_OFFSET_FACTOR,
    shadowScale: r * SHADOW_SCALE_FACTOR,
    // The stack lives here rather than in the components so the ordering is one tested fact
    // instead of a convention each consumer has to remember.
    //
    // The whole stack sits BELOW the model's base, which <Center top> puts at y=0. That is
    // not cosmetic: drei's ContactShadows aims an orthographic camera straight UP from its
    // own position, so it only captures geometry above it. Place the shadow above the base
    // and the model's underside falls behind that camera, and no shadow renders at all —
    // verified in the viewport, where moving it above y=0 made the shadow vanish entirely.
    groundY: r * SURFACE_OFFSET_FACTOR * -2,
    shadowY: r * SURFACE_OFFSET_FACTOR * -1,
    // Axes go above the base instead, or the ground would draw over them.
    axesY: r * SURFACE_OFFSET_FACTOR,
  };
}
