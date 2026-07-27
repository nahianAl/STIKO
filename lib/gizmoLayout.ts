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

/**
 * Triad origin relative to the gizmo centre. x and y sit on the cube's front-lower-left
 * corner (the cube spans ±30); z is pulled 2px proud of the front face so the axes do not
 * z-fight with it.
 */
export const TRIAD_ORIGIN_PX: readonly [number, number, number] = [-30, -30, 32];

/**
 * Distance from the triad origin to each axis-head centre, and the world scale drei applies
 * to the triad group. Not the drawn bar length — drei's axis bar spans 0.8 of this.
 */
export const TRIAD_AXIS_PX = 28;

// An axis head is a sprite: a unit quad scaled by the group's world scale, so its corners sit
// half its diagonal from its centre. drei grows a hovered head to 1.2x. The heads are
// non-interactive today, so they never grow, but bounding the hovered size keeps this correct
// if `disabled` is ever lifted from GizmoViewport.
const HEAD_REACH_PX = ((TRIAD_AXIS_PX * Math.SQRT2) / 2) * 1.2;

// The cube's outermost geometry is not its faces but the corner hover boxes, which drei
// places at ±0.38 with dimensions 0.25 and scale 1.01 — 0.50625 of the cube per axis.
const CUBE_REACH_PX = 0.50625 * CUBE_SIZE_PX * Math.sqrt(3);
const TRIAD_REACH_PX = Math.hypot(...TRIAD_ORIGIN_PX) + TRIAD_AXIS_PX + HEAD_REACH_PX;

/**
 * Radius of the disc the gizmo can occupy in any camera orientation.
 *
 * Derived rather than hand-tuned: the guard has to cover whatever the component actually
 * draws, and a literal here would silently drift the first time the triad is resized. The
 * gizmo rotates freely, so each reach is a 3D distance from the centre — an orthographic
 * projection can only shorten it, never lengthen it.
 *
 * A disc rather than a square, because every term above is a radius. A square of the same
 * half-width would reach 1.41x further at its corners and silently swallow clicks on model
 * geometry the gizmo never covers.
 */
export const GIZMO_RADIUS_PX = Math.ceil(Math.max(CUBE_REACH_PX, TRIAD_REACH_PX));

/** True when a pointer at (x, y) is over the gizmo and should not reach the scene. */
export function isPointerOverGizmo(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const centerX = canvasWidth - GIZMO_MARGIN_PX;
  const centerY = canvasHeight - GIZMO_MARGIN_PX;
  return Math.hypot(x - centerX, y - centerY) <= GIZMO_RADIUS_PX;
}
