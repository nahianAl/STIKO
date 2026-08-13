import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framingForRadius } from '../../lib/cameraFraming.ts';

const FOV = 50;
const LANDSCAPE = 1000 / 700;

// A sphere of radius r fits vertically when distance = r / sin(vFov/2).
const fitsVertically = (radius, distance, fovDeg) =>
  distance >= radius / Math.sin(((fovDeg / 2) * Math.PI) / 180);

test('frames a small model far enough to see all of it', () => {
  const f = framingForRadius(1.73, FOV, LANDSCAPE);
  assert.ok(fitsVertically(1.73, f.distance, FOV), `distance ${f.distance} too close`);
});

test('frames a large model far enough to see all of it', () => {
  // The reported bug: radius 1385 was viewed from 5.2 units, i.e. inside the geometry.
  const f = framingForRadius(1385.64, FOV, LANDSCAPE);
  assert.ok(f.distance > 1385.64, `distance ${f.distance} is still inside the model`);
  assert.ok(fitsVertically(1385.64, f.distance, FOV), `distance ${f.distance} too close`);
});

test('distance scales linearly with model radius', () => {
  const a = framingForRadius(10, FOV, LANDSCAPE);
  const b = framingForRadius(1000, FOV, LANDSCAPE);
  assert.ok(Math.abs(b.distance / a.distance - 100) < 1e-9, 'framing must be scale-invariant');
});

test('a portrait viewport needs more distance than a landscape one', () => {
  // Narrower horizontal FOV means the sphere has to sit further back to fit across.
  const landscape = framingForRadius(100, FOV, 16 / 9);
  const portrait = framingForRadius(100, FOV, 9 / 16);
  assert.ok(portrait.distance > landscape.distance);
});

test('the far plane clears the whole model even when fully zoomed out', () => {
  for (const radius of [1.73, 100, 1385.64, 8660.25]) {
    const f = framingForRadius(radius, FOV, LANDSCAPE);
    // Worst case: camera pushed to maxDistance, model extending a further `radius` beyond centre.
    assert.ok(
      f.far >= f.maxDistance + radius,
      `radius ${radius}: far ${f.far} clips at max zoom-out ${f.maxDistance + radius}`,
    );
  }
});

test('the near plane stays in front of the camera and allows close inspection', () => {
  for (const radius of [1.73, 100, 1385.64, 8660.25]) {
    const f = framingForRadius(radius, FOV, LANDSCAPE);
    assert.ok(f.near > 0, `radius ${radius}: near must be positive`);
    assert.ok(f.near < f.minDistance, `radius ${radius}: near ${f.near} would clip at min zoom-in`);
  }
});

test('keeps the depth-buffer ratio within a precision-safe bound', () => {
  // far/near beyond ~1e5 produces visible z-fighting on a 24-bit depth buffer.
  for (const radius of [1.73, 100, 1385.64, 8660.25]) {
    const f = framingForRadius(radius, FOV, LANDSCAPE);
    assert.ok(f.far / f.near <= 1e5, `radius ${radius}: depth ratio ${f.far / f.near} too wide`);
  }
});

test('a degenerate zero-size model does not produce NaN or zero distance', () => {
  for (const bad of [0, -5, Number.NaN]) {
    const f = framingForRadius(bad, FOV, LANDSCAPE);
    assert.ok(Number.isFinite(f.distance) && f.distance > 0, `radius ${bad} produced ${f.distance}`);
    assert.ok(Number.isFinite(f.near) && f.near > 0);
    assert.ok(Number.isFinite(f.far) && f.far > f.near);
  }
});
