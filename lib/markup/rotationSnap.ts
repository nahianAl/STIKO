// lib/markup/rotationSnap.ts
// What "hold Shift while rotating" means, shared by the two rotate affordances that have
// nothing else in common: the Konva Transformer on a markup object, and the drei
// TransformControls gizmo on the 3D model or a cross-section plane.
//
// Snapping is ABSOLUTE. An object at 7 deg goes to 0, not to 97. Shift therefore always
// produces an axis-aligned result, which is the whole point of the gesture — three.js's own
// rotationSnap quantises the drag DELTA instead and would never straighten a crooked object.

export const RIGHT_ANGLE = Math.PI / 2;

/** Konva's Transformer takes absolute snap angles in degrees. */
export const ROTATION_SNAPS_DEG = [0, 90, 180, 270];

/**
 * Konva's default rotationSnapTolerance is 5 deg, which would snap only rotations that are
 * already nearly aligned. 45 deg puts every angle within reach of the nearest of the four.
 */
export const ROTATION_SNAP_TOLERANCE_DEG = 45;

export function snapToRightAngle(radians: number): number {
  const snapped = Math.round(radians / RIGHT_ANGLE) * RIGHT_ANGLE;
  // Math.round(-0.001 / RIGHT_ANGLE) is -0, and -0 * RIGHT_ANGLE is -0. That would flow into
  // the persisted object transform and compare unequal to 0 under Object.is.
  return snapped === 0 ? 0 : snapped;
}

/**
 * All three components, not just the axis being dragged. Rounding every axis means an object
 * already sitting at 7 deg on X also straightens on X when you Shift-rotate about Y — which
 * is the intended reading of "snap the object to the nearest 90": a statement about the
 * object's final orientation, not about one drag's delta.
 */
export function snapEulerToRightAngles(euler: [number, number, number]): [number, number, number] {
  return [snapToRightAngle(euler[0]), snapToRightAngle(euler[1]), snapToRightAngle(euler[2])];
}
