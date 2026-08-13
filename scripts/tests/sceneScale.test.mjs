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

test('each dimension uses its own documented factor', () => {
  // Pinned exactly: proportionality alone cannot tell factor 2 from factor 20, and cannot
  // catch one field being derived from another field's factor.
  for (const r of RADII) {
    const s = sceneScaleForRadius(r);
    assert.equal(s.groundRadius, r * 4, `groundRadius factor drifted at r=${r}`);
    assert.equal(s.axisHalfLength, r * 2, `axisHalfLength factor drifted at r=${r}`);
    assert.equal(s.shadowScale, r * 2.5, `shadowScale factor drifted at r=${r}`);
    assert.equal(s.surfaceOffset, r * 1e-3, `surfaceOffset factor drifted at r=${r}`);
    assert.equal(s.shadowY, s.surfaceOffset, `shadowY must be one step up at r=${r}`);
    assert.equal(s.axesY, s.surfaceOffset * 2, `axesY must be two steps up at r=${r}`);
  }
});

test('the degenerate fallback also produces exact factors', () => {
  // Guarded radius is 1, so every factor should appear at face value.
  const s = sceneScaleForRadius(0);
  assert.equal(s.groundRadius, 4);
  assert.equal(s.axisHalfLength, 2);
  assert.equal(s.shadowScale, 2.5);
  assert.equal(s.surfaceOffset, 1e-3);
  assert.equal(s.groundY, 0);
});

test('a degenerate radius still produces a usable scene', () => {
  for (const bad of [0, -5, Number.NaN]) {
    const s = sceneScaleForRadius(bad);
    for (const [key, value] of Object.entries(s)) {
      if (key === 'groundY') {
        assert.equal(value, 0, `radius ${bad} moved the ground off zero`);
        continue;
      }
      assert.ok(Number.isFinite(value) && value > 0, `radius ${bad} produced ${key}=${value}`);
    }
  }
});
