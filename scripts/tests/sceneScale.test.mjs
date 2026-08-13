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
    const { surfaceOffset } = sceneScaleForRadius(r);
    const ground = 0;
    const shadow = surfaceOffset;
    const axes = surfaceOffset * 2;
    assert.ok(shadow > ground, `r=${r}: shadow would z-fight the ground`);
    assert.ok(axes > shadow, `r=${r}: axes would z-fight the shadow`);
    // Large enough to survive depth-buffer quantisation, small enough not to look detached.
    assert.ok(surfaceOffset > r * 1e-5, `r=${r}: offset ${surfaceOffset} risks z-fighting`);
    assert.ok(surfaceOffset < r * 1e-2, `r=${r}: offset ${surfaceOffset} would float visibly`);
  }
});

test('a degenerate radius still produces a usable scene', () => {
  for (const bad of [0, -5, Number.NaN]) {
    const s = sceneScaleForRadius(bad);
    for (const [key, value] of Object.entries(s)) {
      assert.ok(Number.isFinite(value) && value > 0, `radius ${bad} produced ${key}=${value}`);
    }
  }
});
