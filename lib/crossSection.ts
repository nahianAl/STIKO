import * as THREE from 'three';

/**
 * Cross-section of a 3D model: up to three planes you can see, move and rotate.
 *
 * Only the FLAGS live here and in React state. A plane's position and rotation live solely on
 * its Object3D in the scene — `TransformControls` mutates that object directly during a drag
 * without going through React, and R3F's prop diffing compares against the previous prop
 * rather than the object's real state, so a React-held pose would need a hand-written re-apply
 * effect per plane (see the one ModelViewerInner already carries for the object transform).
 * Since poses are session-only and never displayed as numbers, React does not need them at
 * all: the frame loop reads world matrices straight off the widgets.
 */

/** The three fixed slots, as shown on the panel. There is no fourth. */
export type PlaneId = 1 | 2 | 3;

export const SECTION_PLANE_IDS: readonly PlaneId[] = [1, 2, 3];

export const MAX_SECTION_PLANES = SECTION_PLANE_IDS.length;

export interface PlaneSlot {
  /** The numbered button: whether the plane and its gizmo are drawn. */
  visible: boolean;
  /**
   * True from the first time this slot is switched on, and cleared only when the whole tool
   * is switched off. A hidden slot that is still cutting is the point of the design: the
   * numbered buttons hide the WIDGET so the cut can be seen unobstructed.
   */
  cutting: boolean;
  /** Which half of the model survives. */
  flipped: boolean;
}

export type SectionSlots = Record<PlaneId, PlaneSlot>;

/** Axis-aligned bounds in the model's own frame, before the placement transform. */
export interface ModelBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** A plane's starting placement, applied once on mount and owned by the scene thereafter. */
export interface PlanePose {
  position: [number, number, number];
  rotation: [number, number, number];
}

/**
 * Three independent idle slots.
 *
 * A function rather than a shared constant on purpose: three references to one frozen-by-
 * convention literal would let a careless mutation of slot 1 silently change 2 and 3 too.
 */
export function emptySlots(): SectionSlots {
  return {
    1: { visible: false, cutting: false, flipped: false },
    2: { visible: false, cutting: false, flipped: false },
    3: { visible: false, cutting: false, flipped: false },
  };
}

/**
 * Where a slot's plane starts: centred on the model, facing X, Y or Z by slot number.
 *
 * Centred and not at an edge for the same reason the old slider defaulted to the middle — a
 * plane placed at the model's extreme clips nothing, so the tool would look broken the first
 * time anyone switched it on.
 *
 * The widget's geometry is a `PlaneGeometry`, which lies in local XY with its normal down
 * local +Z, so these rotations swing +Z onto each world axis in turn. The axis is a starting
 * pose only and carries no lasting identity: rotate the plane and it is still slot 1.
 */
export function defaultPoseFor(id: PlaneId, box: ModelBox): PlanePose {
  const position: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];

  // +Z onto +X, +Z onto +Y, +Z left alone.
  const rotation: [number, number, number] =
    id === 1 ? [0, Math.PI / 2, 0] : id === 2 ? [-Math.PI / 2, 0, 0] : [0, 0, 0];

  return { position, rotation };
}

/** Show or hide a slot's plane. Switching one on for the first time starts it cutting. */
export function togglePlane(slots: SectionSlots, id: PlaneId): SectionSlots {
  const slot = slots[id];
  const visible = !slot.visible;
  return { ...slots, [id]: { ...slot, visible, cutting: slot.cutting || visible } };
}

export function setPlaneFlipped(slots: SectionSlots, id: PlaneId, flipped: boolean): SectionSlots {
  return { ...slots, [id]: { ...slots[id], flipped } };
}

/**
 * The slots currently clipping the model, in slot order.
 *
 * Order is fixed rather than insertion-ordered because the caller rebuilds its `THREE.Plane`
 * array from this list, and changing the NUMBER of clipping planes on a material recompiles
 * its shader. A list that reordered itself would churn that for nothing.
 */
export function cuttingPlaneIds(slots: SectionSlots): PlaneId[] {
  return SECTION_PLANE_IDS.filter((id) => slots[id].cutting);
}

/**
 * Rewrites `target` as the world-space clipping plane for a widget's world matrix.
 *
 * three keeps whatever lies on a plane's positive side, so an unflipped plane points its
 * normal down local -Z: keep everything behind the quad's facing direction.
 *
 * Mutates and returns `target` rather than allocating, because this runs once per plane per
 * frame and because the array handed to the materials has to keep its instances — see
 * `setClippingPlanes` on why that array must not be rebuilt.
 *
 * Pass `normalMatrix` to reuse a scratch Matrix3; `Plane.applyMatrix4` allocates one per call
 * otherwise.
 */
export function writePlaneFromMatrix(
  target: THREE.Plane,
  matrix: THREE.Matrix4,
  flipped: boolean,
  normalMatrix?: THREE.Matrix3,
): THREE.Plane {
  target.normal.set(0, 0, flipped ? 1 : -1);
  target.constant = 0;
  if (normalMatrix) {
    normalMatrix.getNormalMatrix(matrix);
    return target.applyMatrix4(matrix, normalMatrix);
  }
  return target.applyMatrix4(matrix);
}

/**
 * Whether `point` is on the hidden side of ANY plane — i.e. whether the renderer clipped it.
 *
 * three's raycaster ignores clipping entirely, so the hidden geometry stays fully hittable.
 * Both raycasts in the viewer (comment-pin drops, orbit-pivot anchoring) reject hits with
 * this, and both must agree with the renderer: several planes clip by intersection, so
 * surviving geometry is on the kept side of all of them.
 */
export function isClipped(planes: readonly THREE.Plane[], point: THREE.Vector3): boolean {
  for (const plane of planes) {
    if (plane.distanceToPoint(point) < 0) return true;
  }
  return false;
}
