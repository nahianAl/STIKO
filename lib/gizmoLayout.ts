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

/**
 * Half-width of the square the cube and triad can occupy. The cube is 60px on a side, so a
 * corner-on view reaches 60 * sqrt(3) / 2 ≈ 52px from centre; the triad accounts for the rest.
 */
export const GIZMO_HALF_EXTENT_PX = 60;

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
