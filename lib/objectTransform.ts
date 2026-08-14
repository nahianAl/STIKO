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
