/**
 * Decision arithmetic for the 3D viewer's camera navigation.
 *
 * Kept free of THREE and of the scene graph so it can be tested under node. The component
 * that uses it (components/viewers/ViewerNavigation.tsx) does the raycasting and owns the
 * event listeners; everything here is a pure rule.
 *
 * The rules exist because the viewer's pivot used to be the model's bounding-sphere centre,
 * set once at load. Dolly and pan steps are a percentage of the pivot distance, so inspecting
 * detail meant travelling deep inside the bounding sphere until every gesture moved almost
 * nothing — worse the larger the model, because the geometry you wanted stayed hundreds of
 * units away while the steps shrank. Anchoring the pivot to the surface under the cursor when
 * a rotate drag starts makes rotation and the pan steps that follow it scale-free.
 *
 * Zoom is deliberately not covered here: camera-controls' own dollyToCursor migrates the target
 * as the radius shrinks, which fixes the same crawl natively, and re-anchoring on top of it
 * actively drags the cursor point off the cursor. ViewerNavigation's docblock has the mechanism.
 */

export type Vec3 = readonly [number, number, number];

/**
 * Which point a rotate drag should pivot about.
 *
 * The sole caller is the pointerdown handler, and the fallback is the whole of the product
 * behaviour: with nothing under the cursor it passes the model's centre, so a drag started over
 * empty background swings the camera around the object and keeps it in the field of view rather
 * than orbiting whatever point the previous gesture happened to leave behind.
 */
export function pivotForPointer(hit: Vec3 | null, fallback: Vec3): Vec3 {
  return hit ?? fallback;
}

/**
 * Hold the anchor distance inside the dolly range.
 *
 * A raycast can legitimately report a hit a hair in front of the camera — a grazing angle, or
 * geometry the camera has already pushed into. Anchoring there would put the pivot at the eye
 * and collapse every later dolly step to nothing, which is the exact defect this work removes.
 * Anything unusable falls back to the floor rather than propagating: a NaN reaching
 * setOrbitPoint yields a NaN camera matrix and a blank viewport with no error to explain it.
 */
export function clampAnchorDistance(
  hitDistance: number,
  minDistance: number,
  maxDistance: number,
): number {
  if (!Number.isFinite(hitDistance) || hitDistance <= 0) return minDistance;
  return Math.min(maxDistance, Math.max(minDistance, hitDistance));
}

/**
 * Whether a wheel event dollies in.
 *
 * camera-controls turns the event into `delta = deltaY / (deltaYFactor * 10)` with
 * `deltaYFactor` negative, then dollies by `0.95 ** -delta` — so a negative deltaY (wheel up)
 * shrinks the radius. The caller needs this because `infinityDolly` has to be enabled in one
 * direction only; see ViewerNavigation for why.
 */
export function isZoomingIn(deltaY: number): boolean {
  return deltaY < 0;
}
