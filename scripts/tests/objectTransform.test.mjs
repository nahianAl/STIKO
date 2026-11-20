import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  IDENTITY_TRANSFORM,
  isValidTransform,
  modelToWorld,
  samePlacement,
  worldToModel,
} from '../../lib/objectTransform.ts';

const close = (a, b, msg) =>
  assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-9), `${msg}: ${a} !== ${b}`);

test('the identity transform leaves a point exactly where it was', () => {
  // This is the guarantee that every comment pin already in the database stays
  // correct when its coordinates are reinterpreted from world space to model space.
  for (const p of [[0, 0, 0], [1, 2, 3], [-8660.25, 0.5, 1385.64]]) {
    close(modelToWorld(p, IDENTITY_TRANSFORM), p, 'modelToWorld moved a point');
    close(worldToModel(p, IDENTITY_TRANSFORM), p, 'worldToModel moved a point');
  }
});

test('translation moves a point by the offset', () => {
  const t = { position: [10, -5, 2], rotation: [0, 0, 0] };
  close(modelToWorld([1, 1, 1], t), [11, -4, 3], 'translate');
  close(worldToModel([11, -4, 3], t), [1, 1, 1], 'untranslate');
});

test('a quarter turn about Y maps +X onto -Z', () => {
  // Pins live on geometry, so getting the rotation sense wrong puts every pin on
  // the opposite side of the object — visually plausible and completely wrong.
  const t = { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] };
  close(modelToWorld([1, 0, 0], t), [0, 0, -1], 'rotate +X');
  close(modelToWorld([0, 0, 1], t), [1, 0, 0], 'rotate +Z');
});

test('rotation is applied before translation, not after', () => {
  // Composition order is silent when it is wrong: the object still moves, just to
  // the wrong place once it is also rotated.
  const t = { position: [10, 0, 0], rotation: [0, Math.PI / 2, 0] };
  close(modelToWorld([1, 0, 0], t), [10, 0, -1], 'compose order');
});

test('world and model conversions round-trip under a combined transform', () => {
  const t = { position: [3, -7, 11], rotation: [0.3, -1.1, 2.4] };
  for (const p of [[0, 0, 0], [5, 5, 5], [-100, 2, 40]]) {
    close(worldToModel(modelToWorld(p, t), t), p, 'round trip');
  }
});

test('the module composes Euler angles in XYZ order, not some other order', () => {
  // The reference is built from explicit per-axis matrices, NOT from a THREE.Euler, so this
  // is an independent oracle rather than a restatement of the implementation. Angles about
  // all three axes are required: a single-axis rotation is identical under every ordering
  // and cannot discriminate.
  const rotation = [Math.PI / 2, Math.PI / 2, 0.7];
  const [rx, ry, rz] = rotation;
  const reference = new THREE.Matrix4()
    .makeRotationX(rx)
    .multiply(new THREE.Matrix4().makeRotationY(ry))
    .multiply(new THREE.Matrix4().makeRotationZ(rz));

  const point = [0.3, -0.7, 1.1];
  const expected = new THREE.Vector3(...point).applyMatrix4(reference);

  close(
    modelToWorld(point, { position: [0, 0, 0], rotation }),
    [expected.x, expected.y, expected.z],
    'euler order drifted from XYZ',
  );
});

test('validation accepts a well-formed transform', () => {
  assert.equal(isValidTransform({ position: [0, 0, 0], rotation: [0, 0, 0] }), true);
  assert.equal(isValidTransform({ position: [1.5, -2, 3], rotation: [0.1, 0.2, 0.3] }), true);
});

test('validation rejects anything that would poison the column', () => {
  // A NaN reaching the database makes the object vanish from the viewport with no
  // error raised anywhere, which is the worst possible failure mode.
  const bad = [
    null,
    undefined,
    'nope',
    {},
    { position: [0, 0, 0] },
    { rotation: [0, 0, 0] },
    { position: [0, 0], rotation: [0, 0, 0] },
    { position: [0, 0, 0, 0], rotation: [0, 0, 0] },
    { position: [0, 0, Number.NaN], rotation: [0, 0, 0] },
    { position: [0, 0, 0], rotation: [Number.POSITIVE_INFINITY, 0, 0] },
    { position: [0, 0, '1'], rotation: [0, 0, 0] },
  ];
  for (const value of bad) {
    assert.equal(isValidTransform(value), false, `accepted ${JSON.stringify(value)}`);
  }
});

test('samePlacement: an identical placement is the same', () => {
  const t = { position: [1, -2, 3], rotation: [0.3, 0.4, 0.5] };
  assert.equal(samePlacement(t, { position: [1, -2, 3], rotation: [0.3, 0.4, 0.5] }), true);
});

test('samePlacement: the gizmo quaternion-to-Euler round trip drift is not a change', () => {
  // TransformGizmo rebuilds `rotation` from the group's quaternion on every mouse-up, even in
  // translate mode, so a stationary click on a rotated model reports ~1e-16 of drift.
  const a = { position: [4, 5, 6], rotation: [0.3, 0.4, 0.5] };
  const b = { position: [4, 5, 6], rotation: [0.2999999999999999, 0.3999999999999999, 0.5] };
  assert.equal(samePlacement(a, b), true);
});

test('samePlacement: an equivalent Euler representation is the same orientation', () => {
  // A half turn about Y comes back from the round trip as [-PI, ~0, -PI]: different numbers,
  // identical rotation.
  const a = { position: [0, 0, 0], rotation: [0, Math.PI, 0] };
  const b = { position: [0, 0, 0], rotation: [-Math.PI, 1.2e-16, -Math.PI] };
  assert.equal(samePlacement(a, b), true);
});

test('samePlacement: a real rotation difference is a change', () => {
  const a = { position: [0, 0, 0], rotation: [0.3, 0.4, 0.5] };
  const b = { position: [0, 0, 0], rotation: [0.3, 0.41, 0.5] };
  assert.equal(samePlacement(a, b), false);
});

test('samePlacement: a real position difference is a change', () => {
  const a = { position: [0, 0, 0], rotation: [0.3, 0.4, 0.5] };
  const b = { position: [0, 0.001, 0], rotation: [0.3, 0.4, 0.5] };
  assert.equal(samePlacement(a, b), false);
});
