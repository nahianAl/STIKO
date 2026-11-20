import * as THREE from 'three';

/**
 * Where a 3D object has been placed in its package, and the conversions between the
 * model's own frame and the world.
 *
 * Comment pins are stored in the MODEL frame, so that moving an object carries its
 * comments with it. Everything already in the database was stored while the object was
 * at the identity transform, where the two frames coincide — which is why that
 * reinterpretation needs no data migration, and why the identity case is tested first.
 */

export interface ObjectTransform {
  position: [number, number, number];
  /** Euler angles in RADIANS, applied in three.js's default XYZ order. */
  rotation: [number, number, number];
}

export const IDENTITY_TRANSFORM: ObjectTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

function isFiniteTriple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Guards the API boundary: a non-finite value here would silently hide the object. */
export function isValidTransform(value: unknown): value is ObjectTransform {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ObjectTransform>;
  return isFiniteTriple(candidate.position) && isFiniteTriple(candidate.rotation);
}

export function matrixFor(transform: ObjectTransform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation, 'XYZ')),
    new THREE.Vector3(1, 1, 1),
  );
}

export function modelToWorld(
  point: [number, number, number],
  transform: ObjectTransform,
): [number, number, number] {
  const v = new THREE.Vector3(...point).applyMatrix4(matrixFor(transform));
  return [v.x, v.y, v.z];
}

export function worldToModel(
  point: [number, number, number],
  transform: ObjectTransform,
): [number, number, number] {
  // matrixFor returns a fresh matrix, so inverting in place is safe here.
  const v = new THREE.Vector3(...point).applyMatrix4(matrixFor(transform).invert());
  return [v.x, v.y, v.z];
}

function quaternionFor(rotation: ObjectTransform['rotation']): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ'),
  );
}

/**
 * Whether two placements are the same to within floating-point noise.
 *
 * Exact component equality is wrong for rotation: the move/rotate gizmo rebuilds `rotation`
 * from the group's quaternion on every mouse-up, and that quaternion-to-Euler round trip
 * drifts by ~1e-16 and can also land on an equivalent representation ([0, PI, 0] comes back
 * as [-PI, ~0, -PI]). So orientations are compared as quaternions, where `1 - |dot|` is ~0 for
 * the same rotation (|dot| because q and -q are one rotation). That is used rather than
 * `angleTo`, whose acos loses precision near zero.
 *
 * `epsilon` is absolute, in model units, and means two things. For each position component it
 * is the largest difference still counted as the same (1e-9 units, far below anything a drag
 * can produce). For rotation it bounds `1 - |dot|` of the two quaternions, which is
 * ~theta^2 / 8 for a relative rotation of theta radians — so the default accepts differences up
 * to about 9e-5 rad (0.005 degrees) and treats anything larger as a real rotation.
 */
export function samePlacement(a: ObjectTransform, b: ObjectTransform, epsilon = 1e-9): boolean {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.position[i] - b.position[i]) > epsilon) return false;
  }
  return 1 - Math.abs(quaternionFor(a.rotation).dot(quaternionFor(b.rotation))) < epsilon;
}
