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

test('minDistance scales with the model, so close inspection works at any size', () => {
  // The defect: minDistance derived from `near` (far/1e5) worked out to ~0.004 * radius,
  // effectively zero. Dolly steps are a percentage of the pivot distance, so a pivot free
  // to collapse to zero made pan and zoom crawl to a halt near large models.
  for (const radius of [1.73, 100, 1385.64, 8660.25]) {
    const f = framingForRadius(radius, FOV, LANDSCAPE);
    assert.ok(
      Math.abs(f.minDistance / radius - 0.01) < 1e-9,
      `radius ${radius}: minDistance ${f.minDistance} is not 1% of the radius`,
    );
  }
});

test('minDistance leaves room to inspect detail without hitting the far stop', () => {
  for (const radius of [1.73, 100, 1385.64, 8660.25]) {
    const f = framingForRadius(radius, FOV, LANDSCAPE);
    assert.ok(f.minDistance < f.distance, `radius ${radius}: cannot zoom in past the framing distance`);
    assert.ok(f.minDistance < f.maxDistance, `radius ${radius}: dolly range is inverted`);
  }
});

test('a degenerate model still gets a usable minDistance', () => {
  for (const bad of [0, -5, Number.NaN]) {
    const f = framingForRadius(bad, FOV, LANDSCAPE);
    assert.ok(Number.isFinite(f.minDistance) && f.minDistance > 0, `radius ${bad} produced ${f.minDistance}`);
    assert.ok(f.near < f.minDistance, `radius ${bad}: near ${f.near} would clip at min zoom-in`);
  }
});

// ---- clipPlanesForView: the zoom-out flicker ----
import { clipPlanesForView } from '../../lib/cameraFraming.ts';

// Perspective depth step at distance z for a 24-bit buffer, ~ z^2 / (near * 2^24).
const depthStep = (z, near) => (z * z) / (near * 2 ** 24);

test('clip planes: at the opening view the opening near/far stand', () => {
  const r = 10;
  const f = framingForRadius(r, 37.849, LANDSCAPE);
  // Scene sphere 6r (ground stack + headroom) contains the camera at the opening distance.
  const p = clipPlanesForView(f.distance, r * 6, f.near, f.far);
  assert.equal(p.near, f.near);
  assert.equal(p.far, f.far);
});

test('clip planes: fully zoomed out, depth precision is fine enough to stop z-fighting', () => {
  const r = 10;
  const f = framingForRadius(r, 37.849, LANDSCAPE);
  const d = f.maxDistance;
  // The flicker: with the opening near, the depth step at the model is a large share of r.
  assert.ok(depthStep(d, f.near) > r * 0.05, 'precondition: the old planes really are coarse');
  const p = clipPlanesForView(d, r * 6, f.near, f.far);
  assert.ok(depthStep(d, p.near) < r * 1e-4, `step ${depthStep(d, p.near)} still coarse`);
  // And nothing in the scene sphere is clipped.
  assert.ok(p.near < d - r * 6, 'near must stay in front of the scene');
  assert.ok(p.far >= d + r * 6, 'far must reach past the scene');
});

test('clip planes: far grows when the camera ends up past the planned maximum', () => {
  const p = clipPlanesForView(1000, 10, 0.01, 500);
  assert.ok(p.far >= 1010);
});

test('clip planes: inside the scene sphere near never drops below its floor', () => {
  const p = clipPlanesForView(3, 10, 0.01, 500);
  assert.equal(p.near, 0.01);
  assert.equal(p.far, 500);
});

test('clip planes: degenerate input falls back to the opening planes', () => {
  assert.deepEqual(clipPlanesForView(NaN, 10, 0.01, 500), { near: 0.01, far: 500 });
  assert.deepEqual(clipPlanesForView(10, 0, 0.01, 500), { near: 0.01, far: 500 });
});
