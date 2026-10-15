import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isZUpExtension, Z_UP_TO_Y_UP_X_ROTATION } from '../../lib/model/upAxis.ts';

test('3MF and Rhino 3DM are Z-up, whatever the case of the extension', () => {
  for (const ext of ['.3mf', '.3dm', '.3MF']) {
    assert.equal(isZUpExtension(ext), true, ext);
  }
});

test('every other format keeps its own axes', () => {
  for (const ext of [
    '.step', '.stp', '.igs', '.iges', '.brep', '.glb', '.gltf',
    '.obj', '.stl', '.fbx', '.ply', '.dae', '.3ds', '',
  ]) {
    assert.equal(isZUpExtension(ext), false, JSON.stringify(ext));
  }
});

test('turning the root about X maps a Z-up point onto Y-up', () => {
  const root = new THREE.Object3D();
  const child = new THREE.Object3D();
  child.position.set(0, 0, 1);
  root.add(child);
  root.rotation.x = Z_UP_TO_Y_UP_X_ROTATION;
  root.updateMatrixWorld(true);

  const world = child.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(world.x - 0) < 1e-9, `x was ${world.x}`);
  assert.ok(Math.abs(world.y - 1) < 1e-9, `y was ${world.y}`);
  assert.ok(Math.abs(world.z - 0) < 1e-9, `z was ${world.z}`);
});
