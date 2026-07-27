import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIZMO_MARGIN_PX,
  GIZMO_RADIUS_PX,
  CUBE_SIZE_PX,
  TRIAD_ORIGIN_PX,
  TRIAD_AXIS_PX,
  isPointerOverGizmo,
} from '../../lib/gizmoLayout.ts';

const W = 1000;
const H = 800;
const cx = W - GIZMO_MARGIN_PX; // 920
const cy = H - GIZMO_MARGIN_PX; // 720

test('the centre of the gizmo is a hit', () => {
  assert.equal(isPointerOverGizmo(cx, cy, W, H), true);
});

test('the other three corners are misses', () => {
  assert.equal(isPointerOverGizmo(0, 0, W, H), false);
  assert.equal(isPointerOverGizmo(W, 0, W, H), false);
  assert.equal(isPointerOverGizmo(0, H, W, H), false);
});

test('the middle of the viewport is a miss', () => {
  assert.equal(isPointerOverGizmo(W / 2, H / 2, W, H), false);
});

test('boundaries are inclusive and one pixel beyond is a miss', () => {
  assert.equal(isPointerOverGizmo(cx - GIZMO_RADIUS_PX, cy, W, H), true);
  assert.equal(isPointerOverGizmo(cx - GIZMO_RADIUS_PX - 1, cy, W, H), false);
  assert.equal(isPointerOverGizmo(cx + GIZMO_RADIUS_PX, cy, W, H), true);
  assert.equal(isPointerOverGizmo(cx + GIZMO_RADIUS_PX + 1, cy, W, H), false);
  assert.equal(isPointerOverGizmo(cx, cy - GIZMO_RADIUS_PX, W, H), true);
  assert.equal(isPointerOverGizmo(cx, cy - GIZMO_RADIUS_PX - 1, W, H), false);
  assert.equal(isPointerOverGizmo(cx, cy + GIZMO_RADIUS_PX, W, H), true);
  assert.equal(isPointerOverGizmo(cx, cy + GIZMO_RADIUS_PX + 1, W, H), false);
});

test('the rect tracks a different canvas size', () => {
  const w2 = 400;
  const h2 = 300;
  assert.equal(isPointerOverGizmo(w2 - GIZMO_MARGIN_PX, h2 - GIZMO_MARGIN_PX, w2, h2), true);
  assert.equal(isPointerOverGizmo(cx, cy, w2, h2), false);
});

test('the derived radius has its documented value', () => {
  // Pinned so any geometry change surfaces as a deliberate diff rather than silent drift.
  assert.equal(GIZMO_RADIUS_PX, 105);
});

test('the guard covers the cube viewed corner-on', () => {
  const cubeReach = 0.50625 * CUBE_SIZE_PX * Math.sqrt(3);
  assert.ok(
    GIZMO_RADIUS_PX >= cubeReach,
    `radius ${GIZMO_RADIUS_PX} does not cover cube reach ${cubeReach}`,
  );
});

test('the guard covers the triad including its axis-head sprites', () => {
  // Sprite reaches half its diagonal past its centre; drei grows a hovered head to 1.2x.
  const triadReach =
    Math.hypot(...TRIAD_ORIGIN_PX) + TRIAD_AXIS_PX + ((TRIAD_AXIS_PX * Math.SQRT2) / 2) * 1.2;
  assert.ok(
    GIZMO_RADIUS_PX >= triadReach,
    `radius ${GIZMO_RADIUS_PX} does not cover triad reach ${triadReach}`,
  );
});

test('the guard is a disc, not a square: diagonal corners are misses', () => {
  const W = 1000;
  const H = 800;
  const cx = W - GIZMO_MARGIN_PX;
  const cy = H - GIZMO_MARGIN_PX;
  // 80px along each axis is inside a square of half-width 105, but 113px from the centre.
  assert.equal(isPointerOverGizmo(cx - 80, cy - 80, W, H), false);
  assert.equal(isPointerOverGizmo(cx + 80, cy - 80, W, H), false);
  // The same distance measured along one axis is still a hit.
  assert.equal(isPointerOverGizmo(cx - 80, cy, W, H), true);
});
