import * as THREE from 'three';

/**
 * The viewer's light rig, as data, plus the one bit of maths it needs.
 *
 * Every light is placed in CAMERA space and re-placed each frame. That is what keeps the old
 * headlight's best property (no side of the model ever goes dark while orbiting) while dropping
 * its worst: a light aimed straight down the view lights every face turned towards you equally,
 * so a chamfer, a fillet and a flat face all came out the same tone. A key light offset up and
 * to the side shades them differently. That gives the Onshape look, and it is what the
 * 2026-11-20 shading spec is for.
 *
 * Offsets use camera axes: +x right, +y up, +z towards the viewer (the camera looks down -z).
 */

/** About 35° above and 30° left of the view direction. */
export const KEY_OFFSET = new THREE.Vector3(-0.58, 0.7, 1).normalize();
export const KEY_INTENSITY = 1.4;

/** Opposite side and slightly low, so the key's shadow side is lifted, not flattened. */
export const FILL_OFFSET = new THREE.Vector3(0.7, -0.15, 1).normalize();
export const FILL_INTENSITY = 0.45;

/** World-up sky/ground tint: tops of parts read a touch lighter than undersides. */
export const HEMISPHERE_SKY = '#ffffff';
export const HEMISPHERE_GROUND = '#b8bcc4';
export const HEMISPHERE_INTENSITY = 0.5;

/**
 * Studio reflections. Raised from 0.15: the semi-gloss CAD finish (lib/model/cadFinish.ts)
 * needs something to reflect, or curved faces get no gradient. Too high washes pale parts out.
 */
export const ENVIRONMENT_INTENSITY = 0.7;

/**
 * Places a directional light so it shines from `offset` (camera space) onto `target`.
 *
 * A directional light only cares about direction, so the distance is arbitrary (unit length);
 * this behaves identically at model radius 1 and 10,000.
 *
 * The light's target is a bare Object3D outside the scene graph, so nothing else refreshes its
 * world matrix, and the light reads its direction from that matrix.
 */
export function placeCameraRelativeLight(
  light: THREE.DirectionalLight,
  offset: THREE.Vector3,
  camera: THREE.Camera,
  target: THREE.Vector3,
  scratch: THREE.Vector3,
): void {
  scratch.copy(offset).applyQuaternion(camera.quaternion);
  light.position.copy(target).add(scratch);
  light.target.position.copy(target);
  light.target.updateMatrixWorld();
}
