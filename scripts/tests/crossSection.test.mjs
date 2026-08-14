import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SECTION_AXES,
  DEFAULT_CROSS_SECTION,
  planeForSection,
} from '../../lib/crossSection.ts';

// A unit cube centred on the origin: every axis runs -1 … 1, so an offset of 0.5 cuts at 0
// and the arithmetic stays readable.
const BOX = { min: [-1, -1, -1], max: [1, 1, 1] };

const kept = (plane, p) => plane.distanceToPoint(new THREE.Vector3(...p)) >= 0;

test('a centred cut keeps one half and hides the other', () => {
  const plane = planeForSection({ axis: 'x', offset: 0.5, flipped: false }, BOX);
  assert.equal(kept(plane, [-0.5, 0, 0]), true);
  assert.equal(kept(plane, [0.5, 0, 0]), false);
});

test('flipping swaps exactly which half survives', () => {
  const section = { axis: 'x', offset: 0.5, flipped: false };
  const plane = planeForSection(section, BOX);
  const flipped = planeForSection({ ...section, flipped: true }, BOX);
  for (const p of [[-0.5, 0, 0], [0.5, 0, 0], [-0.9, 0.3, 0.2], [0.9, -0.3, -0.2]]) {
    assert.notEqual(kept(plane, p), kept(flipped, p), `point ${p} did not swap sides`);
  }
});

test('an off-centre cut proves the flip negates the cut itself, not just which side is kept', () => {
  // At offset 0.5 the cut coordinate is 0, and -0 === 0, so a flip that forgot to negate the
  // plane's constant would still pass every centred assertion above — +cut and -cut are the
  // same number there. Only an off-centre cut, where the coordinate is nonzero, can catch that.
  const section = { axis: 'x', offset: 0.75, flipped: false };
  const plane = planeForSection(section, BOX); // cuts at x = 0.5, keeps x <= 0.5
  assert.equal(kept(plane, [0.4, 0, 0]), true);
  assert.equal(kept(plane, [0.6, 0, 0]), false);

  const flipped = planeForSection({ ...section, flipped: true }, BOX); // keeps x >= 0.5
  assert.equal(kept(flipped, [0.4, 0, 0]), false);
  assert.equal(kept(flipped, [0.6, 0, 0]), true);
});

test('the offset extremes keep everything and nothing', () => {
  const all = planeForSection({ axis: 'x', offset: 1, flipped: false }, BOX);
  const none = planeForSection({ axis: 'x', offset: 0, flipped: false }, BOX);
  for (const p of [[-1, 0, 0], [0, 0, 0], [0.999, 0, 0]]) {
    assert.equal(kept(all, p), true, `offset 1 hid ${p}`);
  }
  for (const p of [[-0.999, 0, 0], [0, 0, 0], [1, 0, 0]]) {
    assert.equal(kept(none, p), false, `offset 0 kept ${p}`);
  }
});

test('each axis constrains only itself', () => {
  // A y-cut must not care where a point sits in x or z. An axis mix-up would still look
  // plausible on a symmetric model, which is exactly why this is checked rather than eyeballed.
  const plane = planeForSection({ axis: 'y', offset: 0.5, flipped: false }, BOX);
  assert.equal(kept(plane, [-0.9, -0.5, 0.9]), true);
  assert.equal(kept(plane, [0.9, -0.5, -0.9]), true);
  assert.equal(kept(plane, [-0.9, 0.5, 0.9]), false);
  assert.equal(kept(plane, [0.9, 0.5, -0.9]), false);
});

test('every axis is supported and cuts along itself', () => {
  for (const [i, axis] of SECTION_AXES.entries()) {
    const plane = planeForSection({ axis, offset: 0.5, flipped: false }, BOX);
    const inside = [0, 0, 0];
    const outside = [0, 0, 0];
    inside[i] = -0.5;
    outside[i] = 0.5;
    assert.equal(kept(plane, inside), true, `${axis} hid its own negative side`);
    assert.equal(kept(plane, outside), false, `${axis} kept its own positive side`);
  }
});

test('the offset maps onto the box, not onto fixed world units', () => {
  // A model 200 units wide and offset 100 from the origin must still cut through its middle
  // at 0.5 — otherwise the slider does nothing on anything that is not unit-sized.
  const big = { min: [100, 0, 0], max: [300, 1, 1] };
  const plane = planeForSection({ axis: 'x', offset: 0.5, flipped: false }, big);
  assert.equal(kept(plane, [150, 0.5, 0.5]), true);
  assert.equal(kept(plane, [250, 0.5, 0.5]), false);
});

test('the default is a centred, unflipped cut on a supported axis', () => {
  assert.ok(SECTION_AXES.includes(DEFAULT_CROSS_SECTION.axis));
  assert.equal(DEFAULT_CROSS_SECTION.offset, 0.5);
  assert.equal(DEFAULT_CROSS_SECTION.flipped, false);
});

test('the plane survives being pushed into world space by the object matrix', () => {
  // The property the per-frame world sync rests on: build the plane in the model's frame,
  // transform plane and point by the SAME matrix, and the point must stay on the same side
  // at the same distance. If this fails, a rotated object cuts in the wrong place.
  const plane = planeForSection({ axis: 'x', offset: 0.5, flipped: false }, BOX);
  const matrix = new THREE.Matrix4()
    .makeRotationY(Math.PI / 3)
    .multiply(new THREE.Matrix4().makeTranslation(17, -4, 9));
  const world = plane.clone().applyMatrix4(matrix);

  for (const p of [[-0.5, 0, 0], [0.5, 0, 0], [-0.2, 0.7, -0.3]]) {
    const local = new THREE.Vector3(...p);
    const moved = local.clone().applyMatrix4(matrix);
    assert.equal(
      world.distanceToPoint(moved) >= 0,
      plane.distanceToPoint(local) >= 0,
      `point ${p} changed sides under the transform`,
    );
    assert.ok(
      Math.abs(world.distanceToPoint(moved) - plane.distanceToPoint(local)) < 1e-9,
      `point ${p} changed distance under a rigid transform`,
    );
  }
});
