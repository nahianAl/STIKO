import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { placeCameraRelativeLight, KEY_OFFSET, FILL_OFFSET } from '../../lib/sceneLights.ts';

const cameraAt = (x, y, z) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
};
const place = (offset, camera, target = new THREE.Vector3()) => {
  const light = new THREE.DirectionalLight();
  placeCameraRelativeLight(light, offset, camera, target, new THREE.Vector3());
  return light;
};

test('key light comes from above, left and in front of the viewer', () => {
  const light = place(KEY_OFFSET, cameraAt(0, 0, 10));
  assert.ok(light.position.x < 0, 'left');
  assert.ok(light.position.y > 0, 'above');
  assert.ok(light.position.z > 0, 'viewer side');
});

test('fill light comes from the opposite side, slightly low', () => {
  const light = place(FILL_OFFSET, cameraAt(0, 0, 10));
  assert.ok(light.position.x > 0, 'right');
  assert.ok(light.position.y < 0, 'below');
});

test('the rig turns with the camera: from +x, "left" is +z', () => {
  // Looking down -x with y up, the camera's right is -z, so its left is +z.
  const light = place(KEY_OFFSET, cameraAt(10, 0, 0));
  assert.ok(light.position.z > 0, 'left of a camera on +x');
  assert.ok(light.position.y > 0, 'still above');
  assert.ok(light.position.x > 0, 'still on the viewer side');
});

test('the light aims at the orbit target and refreshes its matrix', () => {
  const target = new THREE.Vector3(5, 2, -3);
  const light = place(KEY_OFFSET, cameraAt(5, 2, 7), target);
  assert.deepEqual(light.target.position.toArray(), [5, 2, -3]);
  const world = new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld);
  assert.deepEqual(world.toArray(), [5, 2, -3]);
  // Direction (position - target) equals the rotated offset regardless of target.
  const direction = light.position.clone().sub(target).normalize();
  assert.ok(direction.y > 0 && direction.z > 0);
});
