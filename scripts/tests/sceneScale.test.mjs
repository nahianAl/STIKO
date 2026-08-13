import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneScaleForRadius } from '../../lib/sceneScale.ts';

// The viewer sees radii spanning four orders of magnitude; every property must hold across all.
const RADII = [1, 100, 1385.64, 8660.25];

test('every dimension scales linearly with the model radius', () => {
  const a = sceneScaleForRadius(10);
  const b = sceneScaleForRadius(1000);
  for (const key of ['groundRadius', 'axisHalfLength', 'surfaceOffset', 'shadowScale']) {
    assert.ok(
      Math.abs(b[key] / a[key] - 100) < 1e-9,
      `${key} is not proportional: ${a[key]} -> ${b[key]}`,
    );
  }
});

test('the ground extends beyond both the axes and the shadow', () => {
  for (const r of RADII) {
    const s = sceneScaleForRadius(r);
    assert.ok(s.groundRadius > s.axisHalfLength, `r=${r}: axes reach past the ground`);
    assert.ok(s.groundRadius > s.shadowScale, `r=${r}: shadow reaches past the ground`);
  }
});

test('the axes extend beyond the model itself', () => {
  for (const r of RADII) {
    assert.ok(sceneScaleForRadius(r).axisHalfLength > r, `r=${r}: axes would be hidden inside the model`);
  }
});

test('the stacking offsets separate ground, shadow and axes at every scale', () => {
  for (const r of RADII) {
    const { groundY, shadowY, axesY, surfaceOffset } = sceneScaleForRadius(r);
    assert.ok(shadowY > groundY, `r=${r}: shadow would z-fight the ground`);
    assert.ok(axesY > shadowY, `r=${r}: axes would z-fight the shadow`);
    // Large enough to survive depth-buffer quantisation, small enough not to look detached.
    assert.ok(surfaceOffset > r * 1e-5, `r=${r}: offset ${surfaceOffset} risks z-fighting`);
    assert.ok(surfaceOffset < r * 1e-2, `r=${r}: offset ${surfaceOffset} would float visibly`);
  }
});

test('the shadow sits below the model base, or ContactShadows captures nothing', () => {
  // drei aims the shadow's orthographic camera straight UP from its own position, so it only
  // sees geometry above it. These are offsets relative to the model's base, so a shadow at or
  // above that base leaves the model's underside behind the camera and renders no shadow at
  // all. Verified in the viewport: moving it above the base made the shadow vanish.
  for (const r of RADII) {
    const { groundY, shadowY, axesY } = sceneScaleForRadius(r);
    assert.ok(shadowY < 0, `r=${r}: shadow at ${shadowY} would see nothing`);
    assert.ok(groundY < shadowY, `r=${r}: ground must stay under the shadow`);
    assert.ok(axesY > 0, `r=${r}: axes at ${axesY} would be buried by the ground`);
  }
});

test('each dimension uses its own documented factor', () => {
  // Pinned exactly: proportionality alone cannot tell factor 2 from factor 20, and cannot
  // catch one field being derived from another field's factor.
  for (const r of RADII) {
    const s = sceneScaleForRadius(r);
    assert.equal(s.groundRadius, r * 4, `groundRadius factor drifted at r=${r}`);
    assert.equal(s.axisHalfLength, r * 2, `axisHalfLength factor drifted at r=${r}`);
    assert.equal(s.shadowScale, r * 2.5, `shadowScale factor drifted at r=${r}`);
    assert.equal(s.surfaceOffset, r * 5e-3, `surfaceOffset factor drifted at r=${r}`);
    assert.equal(s.groundY, s.surfaceOffset * -2, `groundY must be two steps down at r=${r}`);
    assert.equal(s.shadowY, s.surfaceOffset * -1, `shadowY must be one step down at r=${r}`);
    assert.equal(s.axesY, s.surfaceOffset, `axesY must be one step up at r=${r}`);
  }
});

test('the degenerate fallback also produces exact factors', () => {
  // Guarded radius is 1, so every factor should appear at face value.
  const s = sceneScaleForRadius(0);
  assert.equal(s.groundRadius, 4);
  assert.equal(s.axisHalfLength, 2);
  assert.equal(s.shadowScale, 2.5);
  assert.equal(s.surfaceOffset, 5e-3);
  assert.equal(s.groundY, -10e-3);
  assert.equal(s.shadowY, -5e-3);
  assert.equal(s.axesY, 5e-3);
});

// Sizes must be positive; stack positions are signed by design, so they are checked
// separately rather than being lumped into a blanket "> 0" sweep that would miss a sign flip.
const SIZE_FIELDS = ['groundRadius', 'axisHalfLength', 'surfaceOffset', 'shadowScale'];
const STACK_FIELDS = ['groundY', 'shadowY', 'axesY'];

test('a degenerate radius still produces a usable scene', () => {
  for (const bad of [0, -5, Number.NaN]) {
    const s = sceneScaleForRadius(bad);
    for (const key of SIZE_FIELDS) {
      assert.ok(Number.isFinite(s[key]) && s[key] > 0, `radius ${bad} produced ${key}=${s[key]}`);
    }
    for (const key of STACK_FIELDS) {
      assert.ok(Number.isFinite(s[key]), `radius ${bad} produced ${key}=${s[key]}`);
    }
    assert.ok(s.groundY < s.shadowY && s.shadowY < 0 && s.axesY > 0, `radius ${bad} broke the stack order`);
    assert.equal(
      Object.keys(s).length,
      SIZE_FIELDS.length + STACK_FIELDS.length,
      'a field was added to SceneScale without being covered here',
    );
  }
});
