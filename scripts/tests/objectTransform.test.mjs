import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  IDENTITY_TRANSFORM,
  isValidTransform,
  modelToWorld,
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

test('an Euler rotation survives the quaternion round-trip the gizmo performs', () => {
  // The gizmo reads back a quaternion and converts it to Euler XYZ before saving; the
  // viewer converts those stored angles back to a rotation. If writer and reader ever
  // disagree on the order, orientation is silently corrupted — it looks like a bad
  // model rather than a bug. Emulating that round-trip here makes it fail loudly.
  const rotation = [0.4, -0.9, 1.3];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, 'XYZ'));
  const back = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  close([back.x, back.y, back.z], rotation, 'euler round trip');
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
