import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOX_TOOLS,
  SEGMENT_TOOLS,
  isBoxTool,
  isSegmentTool,
  startGeometry,
  updateGeometry,
  constrainBox,
  constrainSegment,
  normalizedBox,
} from '../../lib/markup/draft.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('the tool families are the documented ones', () => {
  assert.deepEqual([...BOX_TOOLS], ['rect', 'ellipse', 'cloud']);
  assert.deepEqual([...SEGMENT_TOOLS], ['line', 'arrow']);
  for (const t of BOX_TOOLS) assert.ok(isBoxTool(t));
  for (const t of SEGMENT_TOOLS) assert.ok(isSegmentTool(t));
  assert.ok(!isBoxTool('freehand'));
  assert.ok(!isBoxTool('text'));
  assert.ok(!isSegmentTool('rect'));
});

test('a box gesture anchors at the press point with no extent yet', () => {
  for (const tool of BOX_TOOLS) {
    const g = startGeometry(tool, { x: 10, y: 20 });
    assert.deepEqual(g, { points: [], x: 10, y: 20, width: 0, height: 0 });
  }
});

test('a segment gesture starts as a zero-length segment, freehand as one vertex', () => {
  assert.deepEqual(startGeometry('line', { x: 3, y: 4 }).points, [3, 4, 3, 4]);
  assert.deepEqual(startGeometry('arrow', { x: 3, y: 4 }).points, [3, 4, 3, 4]);
  assert.deepEqual(startGeometry('freehand', { x: 3, y: 4 }).points, [3, 4]);
});

test('freehand accumulates points and ignores the constraint', () => {
  let g = startGeometry('freehand', { x: 0, y: 0 });
  g = updateGeometry('freehand', g, { x: 1, y: 2 }, false);
  g = updateGeometry('freehand', g, { x: 3, y: 4 }, true);
  assert.deepEqual(g.points, [0, 0, 1, 2, 3, 4]);
});

test('an unconstrained box tracks the pointer in every direction', () => {
  const g = startGeometry('rect', { x: 100, y: 100 });
  assert.deepEqual(updateGeometry('rect', g, { x: 130, y: 110 }, false), { ...g, width: 30, height: 10 });
  assert.deepEqual(updateGeometry('rect', g, { x: 70, y: 60 }, false), { ...g, width: -30, height: -40 });
});

test('a constrained box squares off on the LARGER extent, keeping each sign', () => {
  // The larger extent, not the width: a mostly-vertical drag must not collapse to whatever
  // width it happens to have.
  assert.deepEqual(constrainBox(30, 10), { width: 30, height: 30 });
  assert.deepEqual(constrainBox(10, 30), { width: 30, height: 30 });
  assert.deepEqual(constrainBox(-30, 10), { width: -30, height: 30 });
  assert.deepEqual(constrainBox(10, -30), { width: 30, height: -30 });
  assert.deepEqual(constrainBox(-10, -30), { width: -30, height: -30 });
  assert.deepEqual(constrainBox(0, 0), { width: 0, height: 0 });
});

test('shift makes an ellipse a circle and a cloud square, on every box tool', () => {
  for (const tool of BOX_TOOLS) {
    const g = startGeometry(tool, { x: 0, y: 0 });
    const out = updateGeometry(tool, g, { x: 40, y: 12 }, true);
    assert.equal(Math.abs(out.width), Math.abs(out.height), `${tool} was not squared`);
    assert.equal(out.width, 40);
  }
});

test('a constrained segment snaps to 45 degrees and keeps its length', () => {
  const len = (p) => Math.hypot(p.x, p.y);
  const flat = constrainSegment(0, 0, 10, 1);
  close(flat.y, 0, 'a near-horizontal drag flattens');
  close(flat.x, Math.hypot(10, 1), 'length is preserved along the snapped direction');

  const diag = constrainSegment(0, 0, 10, 9);
  close(diag.x, diag.y, 'a near-diagonal drag becomes exactly diagonal');
  close(len(diag), Math.hypot(10, 9), 'length is preserved');

  const up = constrainSegment(0, 0, 1, -10);
  close(up.x, 0, 'a near-vertical drag straightens');
  close(up.y, -Math.hypot(1, 10), 'and keeps its sign');

  const still = constrainSegment(5, 5, 5, 5);
  assert.deepEqual(still, { x: 5, y: 5 }, 'a zero-length segment must not divide by zero');
});

test('an unconstrained segment moves only its far end', () => {
  const g = startGeometry('arrow', { x: 2, y: 3 });
  const out = updateGeometry('arrow', g, { x: 50, y: 4 }, false);
  assert.deepEqual(out.points, [2, 3, 50, 4]);
});

test('a constrained segment snaps relative to its own anchor, not the origin', () => {
  const g = startGeometry('line', { x: 100, y: 100 });
  const out = updateGeometry('line', g, { x: 110, y: 101 }, true);
  assert.equal(out.points[0], 100);
  assert.equal(out.points[1], 100);
  close(out.points[3], 100, 'snapped flat about the anchor');
});

test('normalizedBox describes the box a negative-extent draft occupies', () => {
  assert.deepEqual(normalizedBox(30, 20), { left: 0, top: 0, width: 30, height: 20 });
  assert.deepEqual(normalizedBox(-30, 20), { left: -30, top: 0, width: 30, height: 20 });
  assert.deepEqual(normalizedBox(-30, -20), { left: -30, top: -20, width: 30, height: 20 });
});
