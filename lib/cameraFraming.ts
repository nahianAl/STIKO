/**
 * Camera framing for an arbitrarily-sized model.
 *
 * Uploaded geometry carries no unit convention — a chair authored in metres and a building
 * authored in millimetres both arrive as raw numbers, so bounding radii here span at least
 * 1 to 10,000. A fixed camera position and fixed clipping planes only ever suit one of
 * those scales; everything else either starts inside the geometry or gets cut by the far
 * plane. Every value below is therefore derived from the model's bounding radius.
 *
 * The fit is computed against the bounding SPHERE rather than the box on purpose: the view
 * gizmo can snap the camera to any of six axis views, and a sphere fit is orientation
 * independent, so no snap can ever clip the model.
 */

export interface CameraFraming {
  /** Distance from the model's centre to place the camera. */
  distance: number;
  near: number;
  far: number;
  /**
   * The dolly range. FitCameraToModel assigns both onto the CameraControls instance, where
   * camera-controls clamps its orbit radius to them and ViewerNavigation reads them back as
   * the bounds it clamps a pointer-anchored orbit pivot into.
   *
   * `maxDistance` is a hard stop — it is what keeps the model from being dollied out past
   * the far plane, and ViewerNavigation only ever enables `infinityDolly` for a wheel event
   * that zooms IN, so nothing lifts it. `minDistance` is deliberately not a wall: that same
   * `infinityDolly` holds the radius here and pushes the pivot ahead of the camera rather
   * than stopping, so the camera can fly through geometry and this doubles as the step it
   * travels by (see MIN_DISTANCE_FACTOR).
   */
  minDistance: number;
  maxDistance: number;
}

/** Headroom around the model so it does not touch the viewport edges. */
const MARGIN = 1.3;

/** How far out the user may dolly, as a multiple of the framing distance. */
const MAX_ZOOM_OUT = 10;

/**
 * Closest the orbit pivot may sit to the camera, as a fraction of the model's radius.
 *
 * Dolly steps are a percentage of the pivot distance in every orbit library, so a pivot free
 * to collapse toward zero takes pan and zoom down with it — the reported "everything goes
 * slow when I get close" defect. This was previously derived from `near`, which worked out to
 * ~0.4% of the radius: technically non-zero, practically a black hole.
 *
 * Under camera-controls' `infinityDolly` this doubles as the distance held in front of the
 * camera while pushing through geometry, so it is also the fly-through step size. At 1% that
 * is 50 units on a 5,000-unit building and 0.01 on a 1-unit part — proportionate at both ends.
 */
const MIN_DISTANCE_FACTOR = 0.01;

export function framingForRadius(
  radius: number,
  fovDegrees: number,
  aspect: number,
  margin: number = MARGIN,
): CameraFraming {
  // An empty or degenerate model still needs a usable camera rather than NaN.
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;

  const vFov = (fovDegrees * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * safeAspect);

  // Distance at which a sphere of radius r exactly spans the frustum, on each axis.
  const fitVertical = r / Math.sin(vFov / 2);
  const fitHorizontal = r / Math.sin(hFov / 2);
  const distance = margin * Math.max(fitVertical, fitHorizontal);

  const maxDistance = distance * MAX_ZOOM_OUT;

  // far must still clear the model's far side when fully zoomed out.
  const far = maxDistance + r * 2;

  // near is pinned to the depth-buffer ratio rather than to the model, so precision stays
  // constant across scales. minDistance is independent of it (see MIN_DISTANCE_FACTOR) but
  // stays clear of it: at the app's default 35mm lens — 37.849 degrees vertical — near lands
  // at 4.21e-4 * radius against minDistance's 1e-2, a 23.8x margin. That ratio is a function
  // of the field of view, so it is quoted for that lens alone and no other: the unit tests'
  // 50 degrees gives 3.28e-4 and a 30.5x margin, and the margin closes as the lens lengthens,
  // down to 3.1x at the 300mm ceiling — narrow, but never crossed.
  const near = far / 1e5;

  return { distance, near, far, minDistance: r * MIN_DISTANCE_FACTOR, maxDistance };
}

/**
 * How much of the empty gap between the camera and the scene's bounding sphere the near plane
 * may claim. Not the whole gap: the transform gizmo is drawn at a constant SCREEN size, so its
 * handles reach further toward the camera the further out you are, and the sphere is a
 * conservative but not exact bound on everything else.
 */
const NEAR_GAP_FRACTION = 0.5;

/**
 * Clipping planes for the camera's CURRENT position, not the opening one.
 *
 * `framingForRadius` sizes near/far once, for the whole dolly range, which pins near at
 * far / 1e5. Perspective depth precision falls off with the square of distance over near, so at
 * full zoom-out (~40 radii away) a 24-bit depth buffer can only separate surfaces about a
 * fifth of the model's radius apart: close faces, overlapping parts and the ground stack all
 * lose the depth test frame by frame and flicker. Nothing lies closer to the camera than the
 * surface of the scene's bounding sphere, so once the camera is outside it the near plane can
 * move out into that empty gap, and the far/near ratio collapses from 1e5 to single digits.
 *
 * The opening values are floors, so wherever they were already right — at or inside the scene,
 * and at the opening view — nothing changes. `far` also grows past its floor when the camera
 * ends up further than `framingForRadius` planned for, which dolly-to-cursor can do because it
 * moves the orbit target as well as the camera.
 */
export function clipPlanesForView(
  distanceToSceneCenter: number,
  sceneRadius: number,
  baseNear: number,
  baseFar: number,
): { near: number; far: number } {
  if (!Number.isFinite(distanceToSceneCenter) || !Number.isFinite(sceneRadius) || sceneRadius <= 0) {
    return { near: baseNear, far: baseFar };
  }
  const gap = distanceToSceneCenter - sceneRadius;
  const near = Math.max(baseNear, gap * NEAR_GAP_FRACTION);
  const far = Math.max(baseFar, distanceToSceneCenter + sceneRadius);
  return { near, far };
}
