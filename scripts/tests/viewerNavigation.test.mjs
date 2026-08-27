import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pivotForPointer, clampAnchorDistance, isZoomingIn } from '../../lib/viewerNavigation.ts';

const CENTRE = [10, 20, 30];
const HIT = [1, 2, 3];

test('a hit under the pointer becomes the pivot', () => {
  assert.deepEqual(pivotForPointer(HIT, CENTRE), HIT);
});

test('orbiting from empty background falls back to the model centre', () => {
  // This is what keeps the model in frame: a drag started over background swings the camera
  // around the object rather than around wherever panning happened to leave the pivot.
  assert.deepEqual(pivotForPointer(null, CENTRE), CENTRE);
});

test('dollying over empty background leaves the pivot alone', () => {
  // The wheel passes no fallback. Re-anchoring to the model centre on every background
  // scroll would drag the pivot back off whatever the user had just zoomed toward.
  assert.equal(pivotForPointer(null, null), null);
});

test('an anchor distance inside the dolly range is used as-is', () => {
  assert.equal(clampAnchorDistance(50, 5, 500), 50);
});

test('a grazing hit close to the eye is held at the floor', () => {
  // Without this the pivot lands almost at the camera, every subsequent dolly step (a
  // percentage of that distance) rounds to nothing, and the original defect comes back at
  // a new location.
  assert.equal(clampAnchorDistance(0.0001, 5, 500), 5);
});

test('a distant hit is held at the ceiling', () => {
  assert.equal(clampAnchorDistance(9000, 5, 500), 500);
});

test('a degenerate anchor distance falls back to the floor', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(clampAnchorDistance(bad, 5, 500), 5, `${bad} did not fall back`);
  }
});

test('wheel-up zooms in', () => {
  // Verified against camera-controls 2.10.1: the wheel handler computes
  // delta = deltaY / (deltaYFactor * 10) with deltaYFactor negative, then calls
  // _dollyInternal(-delta), whose scale is 0.95^(-delta). A negative deltaY therefore
  // shrinks the radius. Pinned by a test because an inverted sign is invisible in review
  // and infuriating in use.
  assert.equal(isZoomingIn(-100), true);
  assert.equal(isZoomingIn(-0.5), true);
});

test('wheel-down zooms out', () => {
  assert.equal(isZoomingIn(100), false);
  assert.equal(isZoomingIn(0), false);
});
