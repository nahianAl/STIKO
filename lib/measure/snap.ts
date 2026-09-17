/**
 * What "hold Shift while measuring" means.
 *
 * Deliberately NOT in lib/markup/draft.ts, which owns the 45 degree rule the line and arrow
 * tools use. Two different Shift rules in one module is how they get accidentally unified
 * later, and they are different on purpose: an annotation arrow usually just wants to be
 * straight, while a dimension often has to follow a real edge at an odd angle — a 30 degree
 * pitch, a 60 degree chamfer — where eighths of a turn are too coarse.
 *
 * 2D only. The 3D surface ignores Shift: its points are raycast hits that lie ON the geometry,
 * which is the whole reason a 3D reading can be trusted, and snapping the direction would push
 * the endpoint off the surface.
 */

/** Twenty-fourths of a turn: 15 degrees. */
export const MEASURE_SNAP_STEP = Math.PI / 12;

/**
 * The far end of a segment, snapped to the nearest 15 degrees about its anchor, length kept.
 *
 * The snap is ABSOLUTE, not a quantised delta — a segment at 7 degrees goes to 0, not to 97 —
 * which is what makes Shift always produce a clean angle rather than preserving whatever
 * crookedness it started with. Same contract as `snapToRightAngle` in lib/markup/rotationSnap.ts.
 */
export function snapMeasureSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  // No direction to snap, and atan2(0, 0) would feed a meaningless angle into a zero length.
  // Returning the point untouched leaves the caller's first click exactly where they put it.
  if (length === 0) return { x: x1, y: y1 };

  const angle = Math.round(Math.atan2(dy, dx) / MEASURE_SNAP_STEP) * MEASURE_SNAP_STEP;
  return { x: x0 + Math.cos(angle) * length, y: y0 + Math.sin(angle) * length };
}

/**
 * Apply Shift to one gesture point, given the point it is being measured from.
 *
 * Both 2D surfaces need exactly this, at two call sites each — the committed point and the
 * hover preview, which must snap identically or the point jumps when you click. Taking the
 * anchor as an argument is what lets one function serve all four: the surfaces differ only in
 * where they read the pending gesture from.
 *
 * `anchor` is the previous point of the gesture, so for an angular measurement each leg snaps
 * about the vertex and the resulting angle always lands on a multiple of 15 degrees. Undefined
 * on the first click, where there is nothing to snap about and Shift must be inert.
 */
export function snapMeasurePoint(
  anchor: number[] | undefined,
  point: number[],
  shiftKey: boolean,
): number[] {
  if (!shiftKey || !anchor) return point;
  const snapped = snapMeasureSegment(anchor[0], anchor[1], point[0], point[1]);
  return [snapped.x, snapped.y];
}
