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
  /** Dolly limits for OrbitControls, so the user cannot zoom through a clipping plane. */
  minDistance: number;
  maxDistance: number;
}

/** Headroom around the model so it does not touch the viewport edges. */
const MARGIN = 1.3;

/** How far out the user may dolly, as a multiple of the framing distance. */
const MAX_ZOOM_OUT = 10;

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
  // constant across scales; minDistance then keeps the camera in front of it.
  const near = far / 1e5;

  return { distance, near, far, minDistance: near * 10, maxDistance };
}
