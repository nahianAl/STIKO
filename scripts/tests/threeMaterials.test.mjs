import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setClippingPlanes } from '../../lib/threeMaterials.ts';

// A group shaped like a real loaded model: one mesh with a single material, one mesh with a
// material ARRAY (multi-material meshes are routine on imported CAD/glTF geometry), and a
// non-mesh child (a Line, plus a bare Object3D) that has no `.material` at all.
function buildScene() {
  const root = new THREE.Group();

  const single = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  root.add(single);

  const multi = new THREE.Mesh(new THREE.BoxGeometry(), [
    new THREE.MeshStandardMaterial(),
    new THREE.MeshStandardMaterial(),
  ]);
  root.add(multi);

  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial(),
  );
  root.add(line);

  root.add(new THREE.Object3D());

  return { root, single, multi, line };
}

test('applies the planes array to every material, including each entry of an array-material mesh', () => {
  const { root, single, multi } = buildScene();
  const planes = [new THREE.Plane()];

  setClippingPlanes(root, planes);

  assert.equal(single.material.clippingPlanes, planes);
  assert.equal(multi.material[0].clippingPlanes, planes);
  assert.equal(multi.material[1].clippingPlanes, planes);
});

test('passing null clears the planes on every material, not just the first', () => {
  const { root, single, multi } = buildScene();
  const planes = [new THREE.Plane()];

  setClippingPlanes(root, planes);
  setClippingPlanes(root, null);

  assert.equal(single.material.clippingPlanes, null);
  assert.equal(multi.material[0].clippingPlanes, null);
  assert.equal(multi.material[1].clippingPlanes, null);
});

test('a non-mesh child is skipped without throwing', () => {
  // A Line has a `.material`, but not the array-or-single shape a Mesh has; a bare Object3D has
  // none at all. traverse() visits both, so the function has to survive whatever it finds.
  const { root, line } = buildScene();
  const planes = [new THREE.Plane()];

  assert.doesNotThrow(() => setClippingPlanes(root, planes));
  assert.equal(line.material.clippingPlanes, planes);
});

test('stores the SAME array instance, not a copy', () => {
  // Identity matters here, not just content: ApplyCrossSection mutates the plane in place every
  // frame and relies on the array reference never changing. Changing the NUMBER of clipping
  // planes on a material recompiles its shader, so a copy-on-set would silently defeat that —
  // every frame would look like a different plane count to three even though nothing changed.
  const { root, single } = buildScene();
  const planes = [new THREE.Plane()];

  setClippingPlanes(root, planes);

  assert.equal(single.material.clippingPlanes, planes);
});

test('returns root', () => {
  const { root } = buildScene();
  assert.equal(setClippingPlanes(root, null), root);
});
