/**
 * Screen-space layout of the 3D view gizmo.
 *
 * drei's GizmoHelper renders through a Hud whose OrthographicCamera is pixel-matched
 * (left: -width/2 … right: width/2) and positions the gizmo group at
 * (width/2 - margin, height/2 - margin) for top-right, origin at the canvas centre with
 * +y up. In top-left-origin coordinates that puts the gizmo's centre at (width - margin,
 * margin).
 *
 * Every value here is CSS pixels — matching React Three Fiber's `state.size` and
 * getBoundingClientRect() — NOT drawing-buffer pixels, which devicePixelRatio scales.
 */

export const GIZMO_MARGIN_PX = 80;

/** Cube edge length. drei's GizmoViewcube hardcodes a 60-unit group scale on a unit box. */
export const CUBE_SIZE_PX = 60;

/** How far the triad is held clear of the cube's surface so the two do not z-fight. */
export const TRIAD_PROUD_PX = 1;

/**
 * Triad origin relative to the gizmo centre: the cube's -X-Y-Z corner, held slightly proud.
 *
 * The axes run from here along +X, +Y and +Z, which are the three cube edges meeting at that
 * corner — so the triad is contained by the cube's silhouette instead of protruding from it.
 * An origin on the *front* face instead would put +Z on a collision course with the camera,
 * sticking a full axis length clear of the cube at every orientation.
 */
export const TRIAD_ORIGIN_PX: readonly [number, number, number] = [
  -(CUBE_SIZE_PX / 2 + TRIAD_PROUD_PX),
  -(CUBE_SIZE_PX / 2 + TRIAD_PROUD_PX),
  -(CUBE_SIZE_PX / 2 + TRIAD_PROUD_PX),
];

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

// The triad runs INWARD from the corner along the cube's edges, so its furthest point is
// either the origin corner itself or one of the axis heads — NOT origin + axis + head, which
// is only correct for a triad pointing radially away from the centre. Summing them here would
// inflate the guard by ~50% and start swallowing clicks on model geometry the gizmo never
// covers.
const HEAD_CENTRE_REACH_PX = Math.max(
  ...TRIAD_ORIGIN_PX.map((_, axis) =>
    Math.hypot(...TRIAD_ORIGIN_PX.map((v, i) => (i === axis ? v + TRIAD_AXIS_PX : v))),
  ),
);
const TRIAD_REACH_PX = Math.max(
  Math.hypot(...TRIAD_ORIGIN_PX),
  HEAD_CENTRE_REACH_PX + HEAD_REACH_PX,
);

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

/**
 * True when a pointer at (x, y) is over the gizmo and should not reach the scene.
 *
 * Takes the canvas width but not its height: the gizmo is pinned to the top-right, so its
 * centre is (width - margin, margin) and the canvas height cannot move it.
 */
export function isPointerOverGizmo(x: number, y: number, canvasWidth: number): boolean {
  const centerX = canvasWidth - GIZMO_MARGIN_PX;
  const centerY = GIZMO_MARGIN_PX;
  return Math.hypot(x - centerX, y - centerY) <= GIZMO_RADIUS_PX;
}
