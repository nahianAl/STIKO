import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SECTION_PLANE_IDS,
  MAX_SECTION_PLANES,
  emptySlots,
  defaultPoseFor,
  togglePlane,
  setPlaneFlipped,
  cuttingPlaneIds,
  writePlaneFromMatrix,
  isClipped,
} from '../../lib/crossSection.ts';

// A unit cube centred on the origin, so a centred plane sits at 0 and the arithmetic stays
// readable. An off-centre box is used where the distinction actually matters.
const BOX = { min: [-1, -1, -1], max: [1, 1, 1] };

/** The world plane a widget at `pose` would produce, with no parent transform. */
function planeForPose(pose, flipped = false) {
  const object = new THREE.Object3D();
  object.position.set(...pose.position);
  object.rotation.set(...pose.rotation);
  object.updateWorldMatrix(true, false);
  return writePlaneFromMatrix(new THREE.Plane(), object.matrixWorld, flipped);
}

const kept = (plane, p) => plane.distanceToPoint(new THREE.Vector3(...p)) >= 0;

test('there are exactly three slots, named 1 2 3', () => {
  assert.deepEqual([...SECTION_PLANE_IDS], [1, 2, 3]);
  assert.equal(MAX_SECTION_PLANES, 3);
});

test('a fresh slot set cuts nothing and shows nothing', () => {
  const slots = emptySlots();
  for (const id of SECTION_PLANE_IDS) {
    assert.deepEqual(slots[id], { visible: false, cutting: false, flipped: false });
  }
  assert.deepEqual(cuttingPlaneIds(slots), []);
});

test('emptySlots returns independent objects, not three references to one', () => {
  // A shared frozen-by-convention literal would let a careless mutation of slot 1 silently
  // change slots 2 and 3 as well.
  const slots = emptySlots();
  assert.notEqual(slots[1], slots[2]);
  assert.notEqual(slots[2], slots[3]);
  assert.notEqual(emptySlots(), slots);
});

test('the three default poses face three different directions, all centred on the box', () => {
  const centre = [0, 0, 0];
  const normals = [];
  for (const id of SECTION_PLANE_IDS) {
    const pose = defaultPoseFor(id, BOX);
    assert.deepEqual(pose.position, centre, `plane ${id} was not centred`);
    normals.push(planeForPose(pose).normal.clone());
  }
  // Mutually perpendicular: every pair dots to zero.
  for (let a = 0; a < normals.length; a++) {
    for (let b = a + 1; b < normals.length; b++) {
      assert.ok(
        Math.abs(normals[a].dot(normals[b])) < 1e-9,
        `planes ${a + 1} and ${b + 1} start facing the same way`,
      );
    }
  }
});

test('each default pose is perpendicular to its own axis', () => {
  // Plane 1 constrains x, plane 2 constrains y, plane 3 constrains z — a mix-up here looks
  // plausible on a symmetric model, which is exactly why it is asserted rather than eyeballed.
  const axisOf = { 1: 0, 2: 1, 3: 2 };
  for (const id of SECTION_PLANE_IDS) {
    const plane = planeForPose(defaultPoseFor(id, BOX));
    const inside = [0, 0, 0];
    const outside = [0, 0, 0];
    inside[axisOf[id]] = -0.5;
    outside[axisOf[id]] = 0.5;
    assert.equal(kept(plane, inside), true, `plane ${id} hid its own negative side`);
    assert.equal(kept(plane, outside), false, `plane ${id} kept its own positive side`);
    // And it must not care about the other two axes at all.
    const skew = [0.9, 0.9, 0.9];
    skew[axisOf[id]] = -0.5;
    assert.equal(kept(plane, skew), true, `plane ${id} leaked into another axis`);
  }
});

test('the default pose sits at the centre of an off-centre box, not at the world origin', () => {
  // A model 200 units wide and 100 from the origin must still start cut through its middle.
  const big = { min: [100, 0, 0], max: [300, 4, 6] };
  assert.deepEqual(defaultPoseFor(1, big).position, [200, 2, 3]);
});

test('flipping swaps exactly which half survives', () => {
  const pose = defaultPoseFor(1, BOX);
  const plane = planeForPose(pose, false);
  const flipped = planeForPose(pose, true);
  for (const p of [[-0.5, 0, 0], [0.5, 0, 0], [-0.9, 0.3, 0.2], [0.9, -0.3, -0.2]]) {
    assert.notEqual(kept(plane, p), kept(flipped, p), `point ${p} did not swap sides`);
  }
});

test('flipping negates the cut itself, not just the sign of the normal', () => {
  // At the origin the plane constant is 0, and -0 === 0, so a flip that forgot to negate the
  // constant would still pass every centred assertion. Only an off-centre plane catches it.
  const pose = { position: [0.5, 0, 0], rotation: defaultPoseFor(1, BOX).rotation };
  const plane = planeForPose(pose, false);
  assert.equal(kept(plane, [0.4, 0, 0]), true);
  assert.equal(kept(plane, [0.6, 0, 0]), false);

  const flipped = planeForPose(pose, true);
  assert.equal(kept(flipped, [0.4, 0, 0]), false);
  assert.equal(kept(flipped, [0.6, 0, 0]), true);
});

test('a rotated widget cuts at its own angle', () => {
  // The whole point of the redesign: a plane tilted 45 degrees about Y must cut on the
  // diagonal, not snap back to an axis.
  const plane = planeForPose({ position: [0, 0, 0], rotation: [0, Math.PI / 4, 0] });
  assert.ok(Math.abs(plane.normal.y) < 1e-9, 'a Y rotation tilted the plane out of Y');
  assert.ok(Math.abs(Math.abs(plane.normal.x) - Math.abs(plane.normal.z)) < 1e-9);
});

test('the plane follows a parent transform exactly', () => {
  // The property the per-frame world sync rests on: transform the widget and a point by the
  // SAME matrix and the point stays on the same side, at the same distance. If this fails, a
  // model with a saved placement cuts in the wrong place.
  const parent = new THREE.Object3D();
  parent.position.set(17, -4, 9);
  parent.rotation.set(0.3, Math.PI / 3, -0.7);
  const child = new THREE.Object3D();
  child.position.set(0.25, 0, 0);
  child.rotation.set(...defaultPoseFor(1, BOX).rotation);
  parent.add(child);
  parent.updateWorldMatrix(true, true);

  const local = writePlaneFromMatrix(new THREE.Plane(), child.matrix, false);
  const world = writePlaneFromMatrix(new THREE.Plane(), child.matrixWorld, false);

  for (const p of [[-0.5, 0, 0], [0.5, 0, 0], [-0.2, 0.7, -0.3]]) {
    const point = new THREE.Vector3(...p);
    const moved = point.clone().applyMatrix4(parent.matrixWorld);
    assert.equal(
      world.distanceToPoint(moved) >= 0,
      local.distanceToPoint(point) >= 0,
      `point ${p} changed sides under the parent transform`,
    );
    assert.ok(
      Math.abs(world.distanceToPoint(moved) - local.distanceToPoint(point)) < 1e-9,
      `point ${p} changed distance under a rigid transform`,
    );
  }
});

test('writePlaneFromMatrix mutates its target rather than allocating', () => {
  // It runs once per plane per frame. Returning a fresh Plane would allocate 180 objects a
  // second, and the array handed to the materials must keep its instances anyway.
  const target = new THREE.Plane();
  const object = new THREE.Object3D();
  object.position.set(3, 0, 0);
  object.updateWorldMatrix(true, false);
  const returned = writePlaneFromMatrix(target, object.matrixWorld, false);
  assert.equal(returned, target);
});

test('writePlaneFromMatrix gives the same answer with and without a scratch normal matrix', () => {
  // The scratch matrix is a per-frame allocation dodge; it must not change the result.
  const object = new THREE.Object3D();
  object.position.set(1, 2, 3);
  object.rotation.set(0.4, -1.1, 0.9);
  object.updateWorldMatrix(true, false);

  const plain = writePlaneFromMatrix(new THREE.Plane(), object.matrixWorld, true);
  const scratch = new THREE.Matrix3();
  const withScratch = writePlaneFromMatrix(new THREE.Plane(), object.matrixWorld, true, scratch);

  assert.ok(plain.normal.distanceTo(withScratch.normal) < 1e-12);
  assert.ok(Math.abs(plain.constant - withScratch.constant) < 1e-12);
});

test('toggling a slot on makes it visible and starts it cutting', () => {
  const slots = togglePlane(emptySlots(), 2);
  assert.deepEqual(slots[2], { visible: true, cutting: true, flipped: false });
  assert.deepEqual(cuttingPlaneIds(slots), [2]);
});

test('toggling a slot off hides it but leaves the model cut', () => {
  // The behaviour the whole panel is designed around: the numbered buttons control the
  // WIDGET, not the cut. Only the master toggle restores the geometry.
  let slots = togglePlane(emptySlots(), 1);
  slots = togglePlane(slots, 1);
  assert.equal(slots[1].visible, false);
  assert.equal(slots[1].cutting, true);
  assert.deepEqual(cuttingPlaneIds(slots), [1]);
});

test('toggling a hidden-but-cutting slot back on shows it again without duplicating the cut', () => {
  let slots = togglePlane(emptySlots(), 1);
  slots = togglePlane(slots, 1);
  slots = togglePlane(slots, 1);
  assert.deepEqual(slots[1], { visible: true, cutting: true, flipped: false });
  assert.deepEqual(cuttingPlaneIds(slots), [1]);
});

test('toggling one slot never disturbs the other two', () => {
  const before = togglePlane(togglePlane(emptySlots(), 1), 3);
  const after = togglePlane(before, 2);
  assert.deepEqual(after[1], before[1]);
  assert.deepEqual(after[3], before[3]);
  assert.deepEqual(cuttingPlaneIds(after), [1, 2, 3]);
});

test('cuttingPlaneIds is returned in slot order, whatever order they were switched on', () => {
  // ApplyCrossSection rebuilds its Plane array from this. A wobbling order would rebuild the
  // array — and recompile every material's shader — for no reason.
  let slots = togglePlane(emptySlots(), 3);
  slots = togglePlane(slots, 1);
  slots = togglePlane(slots, 2);
  assert.deepEqual(cuttingPlaneIds(slots), [1, 2, 3]);
});

test('flipping a slot changes only that slot', () => {
  const slots = setPlaneFlipped(togglePlane(emptySlots(), 2), 2, true);
  assert.equal(slots[2].flipped, true);
  assert.equal(slots[1].flipped, false);
  assert.equal(slots[3].flipped, false);
  // and does not disturb visibility or cutting
  assert.equal(slots[2].visible, true);
  assert.equal(slots[2].cutting, true);
});

test('the reducers never mutate the slots they are given', () => {
  // They feed React state. An in-place edit would render stale.
  const original = emptySlots();
  const snapshot = JSON.parse(JSON.stringify(original));
  togglePlane(original, 1);
  setPlaneFlipped(original, 1, true);
  assert.deepEqual(original, snapshot);
});

test('isClipped rejects a point behind any one plane', () => {
  // Three planes clip by intersection: surviving geometry must be on the kept side of ALL of
  // them. The raycast guards must agree with the renderer or pins land on invisible geometry.
  const x = planeForPose(defaultPoseFor(1, BOX)); // keeps x <= 0
  const y = planeForPose(defaultPoseFor(2, BOX)); // keeps y <= 0
  const planes = [x, y];

  assert.equal(isClipped(planes, new THREE.Vector3(-0.5, -0.5, 0)), false);
  assert.equal(isClipped(planes, new THREE.Vector3(0.5, -0.5, 0)), true, 'x half not clipped');
  assert.equal(isClipped(planes, new THREE.Vector3(-0.5, 0.5, 0)), true, 'y half not clipped');
  assert.equal(isClipped(planes, new THREE.Vector3(0.5, 0.5, 0)), true);
});

test('isClipped with no planes clips nothing', () => {
  assert.equal(isClipped([], new THREE.Vector3(9, 9, 9)), false);
});
