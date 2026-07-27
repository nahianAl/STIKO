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
 * Half-width of the square the cube and triad can occupy, in any camera orientation.
 *
 * The cube is 60px on a side, so a corner-on view reaches 60 * sqrt(3) / 2 ≈ 52px from
 * centre. The triad reaches further: its origin sits at (-30, -30, 32) — about 53px out —
 * and its axes extend 28px beyond that, so 81px is the worst case. Measured against a
 * running viewport the visible footprint peaked near 70px; 85 keeps margin for orientations
 * that were not sampled.
 *
 * Erring large is the safe direction. Too small lets a click land on visible gizmo chrome
 * and drop a comment pin behind it — the bug the guard exists to prevent. Too large only
 * suppresses pin placement in a corner the gizmo already occupies, and never blocks orbiting.
 */
export const GIZMO_HALF_EXTENT_PX = 85;

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
