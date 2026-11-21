import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  intersectRect,
  snapOutward,
  needsDetail,
  detailRenderParams,
  DETAIL_TOLERANCE,
} from '../../lib/pdf/detailTile.ts';
import { MAX_CANVAS_PIXELS } from '../../lib/pdf/viewMode.ts';

test('intersectRect: overlapping rects give their overlap', () => {
  assert.deepEqual(
    intersectRect({ x: 0, y: 0, width: 100, height: 50 }, { x: 60, y: 20, width: 100, height: 100 }),
    { x: 60, y: 20, width: 40, height: 30 },
  );
});

test('intersectRect: disjoint or edge-touching rects give null', () => {
  assert.equal(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }), null);
  assert.equal(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), null);
});

test('intersectRect: a rect inside another is itself', () => {
  const inner = { x: 5, y: 5, width: 2, height: 3 };
  assert.deepEqual(intersectRect({ x: 0, y: 0, width: 100, height: 100 }, inner), inner);
});

test('snapOutward: grows to whole device pixels and never shrinks', () => {
  const r = snapOutward({ x: 10.3, y: 4.74, width: 20.1, height: 5.01 }, 2);
  // device px: x 20.6→20, y 9.48→9, right 60.8→61, bottom 19.5→20
  assert.deepEqual(r, { x: 10, y: 4.5, width: 20.5, height: 5.5 });
});

test('snapOutward: already-aligned rect is unchanged', () => {
  assert.deepEqual(snapOutward({ x: 1, y: 2, width: 3, height: 4 }, 1), { x: 1, y: 2, width: 3, height: 4 });
});

test('needsDetail: base at screen density does not need detail', () => {
  // 1000-px bitmap shown 500 CSS px wide on a 2x screen = exactly 2 device px per CSS px.
  assert.equal(needsDetail(1000, 500, 2), false);
});

test('needsDetail: stretched base needs detail', () => {
  // 1000-px bitmap shown 1000 CSS px wide on a 2x screen = 1 device px per CSS px.
  assert.equal(needsDetail(1000, 1000, 2), true);
});

test('needsDetail: the tolerance absorbs rounding just under density', () => {
  // 0.97 of the needed density: within tolerance, no redraw.
  assert.equal(needsDetail(970, 500, 2), false);
  assert.ok(DETAIL_TOLERANCE > 1);
});

test('needsDetail: unknown sizes never need detail', () => {
  assert.equal(needsDetail(0, 500, 2), false);
  assert.equal(needsDetail(1000, 0, 2), false);
});

test('detailRenderParams: scale and offset map the region to the canvas origin', () => {
  // Page 600 pt wide, displayed 1200 CSS px wide, dpr 2 -> 4 device px per pt.
  const p = detailRenderParams(600, { x: 100, y: 50, width: 300, height: 200 }, 1200, 2);
  assert.equal(p.scale, 4);
  assert.equal(p.offsetX, -200);
  assert.equal(p.offsetY, -100);
  assert.equal(p.canvasWidth, 600);
  assert.equal(p.canvasHeight, 400);
});

test('detailRenderParams: lowers density to stay within the canvas pixel cap', () => {
  const region = { x: 0, y: 0, width: 4000, height: 4000 }; // 16M CSS px; at dpr 2 would be 64M
  const p = detailRenderParams(1000, region, 8000, 2);
  assert.ok(p.canvasWidth * p.canvasHeight <= MAX_CANVAS_PIXELS * 1.001);
  assert.ok(p.scale < (8000 * 2) / 1000);
});

test('detailRenderParams: canvas is at least 1x1', () => {
  const p = detailRenderParams(600, { x: 0, y: 0, width: 0.1, height: 0.1 }, 600, 1);
  assert.equal(p.canvasWidth, 1);
  assert.equal(p.canvasHeight, 1);
});
