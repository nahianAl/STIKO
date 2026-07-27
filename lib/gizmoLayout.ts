/**
 * Screen-space layout of the 3D view gizmo.
 *
 * drei's GizmoHelper renders through a Hud whose OrthographicCamera is pixel-matched
 * (left: -width/2 … right: width/2) and positions the gizmo group at
 * (width/2 - margin, -height/2 + margin), origin at the canvas centre with +y up.
 * In top-left-origin coordinates that puts the gizmo's centre at (width - margin,
 * height - margin).
 *
 * Every value here is CSS pixels — matching React Three Fiber's `state.size` and
 * getBoundingClientRect() — NOT drawing-buffer pixels, which devicePixelRatio scales.
 */

export const GIZMO_MARGIN_PX = 80;

/** Cube edge length. drei's GizmoViewcube hardcodes a 60-unit group scale on a unit box. */
export const CUBE_SIZE_PX = 60;

/** Triad origin relative to the gizmo centre — just off the cube's front-lower-left corner. */
export const TRIAD_ORIGIN_PX: readonly [number, number, number] = [-30, -30, 32];

/** Axis length, and the world scale drei applies to each axis-head sprite. */
export const TRIAD_AXIS_PX = 28;

// A sprite's on-screen size is its world scale times a unit quad, so it reaches half its
// scale beyond its centre. drei grows a hovered head to 1.2x.
const HEAD_HALF_WIDTH_PX = TRIAD_AXIS_PX * 0.5 * 1.2;

const CUBE_REACH_PX = (CUBE_SIZE_PX / 2) * Math.sqrt(3);
const TRIAD_REACH_PX = Math.hypot(...TRIAD_ORIGIN_PX) + TRIAD_AXIS_PX + HEAD_HALF_WIDTH_PX;

/**
 * Half-width of the square the gizmo can occupy in any camera orientation.
 *
 * Derived rather than hand-tuned: the guard has to cover whatever the component actually
 * draws, and a literal here would silently drift the first time the triad is resized. The
 * gizmo rotates freely, so each reach is a 3D distance from the centre — an orthographic
 * projection can only shorten it, never lengthen it.
 *
 * Too small lets a click land on visible gizmo chrome and drop a comment pin behind it,
 * which is the bug this guard exists to prevent. Too large only suppresses pin placement in
 * a corner the gizmo already occupies, and never blocks orbiting.
 */
export const GIZMO_HALF_EXTENT_PX = Math.ceil(Math.max(CUBE_REACH_PX, TRIAD_REACH_PX));

/** True when a pointer at (x, y) is over the gizmo and should not reach the scene. */
export function isPointerOverGizmo(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const centerX = canvasWidth - GIZMO_MARGIN_PX;
  const centerY = canvasHeight - GIZMO_MARGIN_PX;
  return (
    Math.abs(x - centerX) <= GIZMO_HALF_EXTENT_PX &&
    Math.abs(y - centerY) <= GIZMO_HALF_EXTENT_PX
  );
}
