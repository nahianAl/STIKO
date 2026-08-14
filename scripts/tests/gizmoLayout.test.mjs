import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIZMO_MARGIN_PX,
  GIZMO_RADIUS_PX,
  CUBE_SIZE_PX,
  TRIAD_ORIGIN_PX,
  TRIAD_AXIS_PX,
  TRIAD_PROUD_PX,
  isPointerOverGizmo,
} from '../../lib/gizmoLayout.ts';

const W = 1000;
const H = 800;
const cx = W - GIZMO_MARGIN_PX; // 920
const cy = GIZMO_MARGIN_PX; //  80 — the gizmo sits top-right

test('the centre of the gizmo is a hit', () => {
  assert.equal(isPointerOverGizmo(cx, cy, W), true);
});

test('the other three corners are misses', () => {
  assert.equal(isPointerOverGizmo(0, 0, W), false);
  assert.equal(isPointerOverGizmo(0, H, W), false);
  assert.equal(isPointerOverGizmo(W, H, W), false);
});

test('the bottom-right corner is a miss', () => {
  // Where the gizmo used to live, and where the transform buttons now are. A guard left on
  // the old corner would silently swallow clicks there while letting them fall through onto
  // the gizmo itself.
  assert.equal(isPointerOverGizmo(cx, H - GIZMO_MARGIN_PX, W), false);
});

test('the middle of the viewport is a miss', () => {
  assert.equal(isPointerOverGizmo(W / 2, H / 2, W), false);
});

test('boundaries are inclusive and one pixel beyond is a miss', () => {
  assert.equal(isPointerOverGizmo(cx - GIZMO_RADIUS_PX, cy, W), true);
  assert.equal(isPointerOverGizmo(cx - GIZMO_RADIUS_PX - 1, cy, W), false);
  assert.equal(isPointerOverGizmo(cx + GIZMO_RADIUS_PX, cy, W), true);
  assert.equal(isPointerOverGizmo(cx + GIZMO_RADIUS_PX + 1, cy, W), false);
  assert.equal(isPointerOverGizmo(cx, cy - GIZMO_RADIUS_PX, W), true);
  assert.equal(isPointerOverGizmo(cx, cy - GIZMO_RADIUS_PX - 1, W), false);
  assert.equal(isPointerOverGizmo(cx, cy + GIZMO_RADIUS_PX, W), true);
  assert.equal(isPointerOverGizmo(cx, cy + GIZMO_RADIUS_PX + 1, W), false);
});

test('the guard tracks a different canvas width', () => {
  const w2 = 400;
  assert.equal(isPointerOverGizmo(w2 - GIZMO_MARGIN_PX, GIZMO_MARGIN_PX, w2), true);
  assert.equal(isPointerOverGizmo(cx, cy, w2), false);
});

test('the derived radius has its documented value', () => {
  // Pinned so any geometry change surfaces as a deliberate diff rather than silent drift.
  assert.equal(GIZMO_RADIUS_PX, 68);
});

test('the guard covers the cube viewed corner-on', () => {
  const cubeReach = 0.50625 * CUBE_SIZE_PX * Math.sqrt(3);
  assert.ok(
    GIZMO_RADIUS_PX >= cubeReach,
    `radius ${GIZMO_RADIUS_PX} does not cover cube reach ${cubeReach}`,
  );
});

test('the guard covers the triad including its axis-head sprites', () => {
  // The triad runs inward along the cube's edges, so its furthest point is the origin corner
  // or an axis head — not origin + axis + head, which only holds for a radially-outward
  // triad. Built here from the exported geometry rather than copied from the module, so a
  // change to one has to be a deliberate change to both.
  const headReach = ((TRIAD_AXIS_PX * Math.SQRT2) / 2) * 1.2;
  const headCentreReach = Math.max(
    ...TRIAD_ORIGIN_PX.map((_, axis) =>
      Math.hypot(...TRIAD_ORIGIN_PX.map((v, i) => (i === axis ? v + TRIAD_AXIS_PX : v))),
    ),
  );
  const triadReach = Math.max(Math.hypot(...TRIAD_ORIGIN_PX), headCentreReach + headReach);
  assert.ok(
    GIZMO_RADIUS_PX >= triadReach,
    `radius ${GIZMO_RADIUS_PX} does not cover triad reach ${triadReach}`,
  );
});

test('the triad is contained by the cube rather than protruding from it', () => {
  // The bug this replaced: an origin proud of the FRONT FACE sent +Z straight at the camera,
  // a full axis length clear of the cube at every orientation. Every axis must now stay
  // within the cube, give or take the deliberate proud offset that stops it z-fighting.
  const limit = CUBE_SIZE_PX / 2 + TRIAD_PROUD_PX;
  for (let axis = 0; axis < 3; axis++) {
    const head = TRIAD_ORIGIN_PX.map((v, i) => (i === axis ? v + TRIAD_AXIS_PX : v));
    assert.ok(
      head.every((v) => Math.abs(v) <= limit),
      `axis ${axis} head at ${head} escapes the cube's ±${limit}`,
    );
  }
  // And the offset really is only a hair, not a way to smuggle the old protrusion back in.
  assert.ok(TRIAD_PROUD_PX <= 2, `proud offset ${TRIAD_PROUD_PX} is too generous to mean much`);
});

test('the guard is a disc, not a square: diagonal corners are misses', () => {
  // 55px along each axis is inside a square of half-width 68, but 77.8px from the centre.
  assert.equal(isPointerOverGizmo(cx - 55, cy + 55, W), false);
  assert.equal(isPointerOverGizmo(cx + 55, cy + 55, W), false);
  // The same distance measured along one axis is still a hit.
  assert.equal(isPointerOverGizmo(cx - 55, cy, W), true);
});
