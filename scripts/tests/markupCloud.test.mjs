import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudArcs, arcStart, arcEnd, MIN_SCALLOP_RADIUS } from '../../lib/markup/cloud.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('a degenerate box has no cloud', () => {
  assert.deepEqual(cloudArcs(0, 40), []);
  assert.deepEqual(cloudArcs(40, 0), []);
  assert.deepEqual(cloudArcs(0, 0), []);
});

test('the path is closed and continuous, so the arcs form one outline', () => {
  // Each ctx.arc is joined to the previous with an implicit lineTo. If the endpoints did not
  // coincide, the cloud would be drawn with chords cutting across its own scallops.
  for (const [w, h] of [[200, 120], [37, 210], [9, 9], [500, 40]]) {
    const arcs = cloudArcs(w, h);
    assert.ok(arcs.length >= 4, `${w}x${h} produced too few arcs`);
    for (let i = 0; i < arcs.length; i++) {
      const end = arcEnd(arcs[i]);
      const next = arcStart(arcs[(i + 1) % arcs.length]);
      close(end.x, next.x, `${w}x${h} arc ${i} -> ${i + 1} x`);
      close(end.y, next.y, `${w}x${h} arc ${i} -> ${i + 1} y`);
    }
  }
});

test('every arc is centred on the perimeter of the box it was asked for', () => {
  const w = 160;
  const h = 100;
  for (const a of cloudArcs(w, h)) {
    const onVertical = (Math.abs(a.cx - 0) < 1e-9 || Math.abs(a.cx - w) < 1e-9) && a.cy >= 0 && a.cy <= h;
    const onHorizontal = (Math.abs(a.cy - 0) < 1e-9 || Math.abs(a.cy - h) < 1e-9) && a.cx >= 0 && a.cx <= w;
    assert.ok(onVertical || onHorizontal, `arc centre (${a.cx}, ${a.cy}) is not on the perimeter`);
    assert.ok(a.r > 0, 'arc radius must be positive');
  }
});

test('scallops stay legible on a small cloud and do not bloat on a large one', () => {
  const small = cloudArcs(12, 12);
  assert.ok(small.length >= 4, 'a tiny cloud still has a scallop per side');
  for (const a of small) {
    assert.ok(a.r <= 12, 'a scallop never exceeds the box it decorates');
    assert.ok(a.r >= MIN_SCALLOP_RADIUS, 'a small cloud must not round its count above the legibility floor');
  }

  const large = cloudArcs(800, 600);
  for (const a of large) {
    assert.ok(a.r >= MIN_SCALLOP_RADIUS, 'scallops never go below the legibility floor');
    assert.ok(a.r < 200, `a scallop of ${a.r} on an 800x600 box is a bulge, not a cloud`);
  }
  assert.ok(large.length > small.length, 'a bigger cloud has more scallops');
});

test('a box dragged up and left is mirrored, not drawn off into space', () => {
  // A draft mid-drag carries negative extents; only committed objects are normalised.
  const arcs = cloudArcs(-160, -100);
  assert.ok(arcs.length >= 4);
  for (const a of arcs) {
    assert.ok(a.cx >= -160 - 1e-9 && a.cx <= 1e-9, `cx ${a.cx} outside the box`);
    assert.ok(a.cy >= -100 - 1e-9 && a.cy <= 1e-9, `cy ${a.cy} outside the box`);
  }
});

test('every scallop bulges outward, not into the box', () => {
  // The continuity test only checks that consecutive arcs' endpoints coincide. A mirrored
  // construction — every side's start/end swapped and its traversal order reversed — would
  // still satisfy that while drawing every scallop bulging inward. Pin outwardness directly
  // via the sagitta point (the arc's midpoint, at the angle halfway between start and end).
  for (const [w, h] of [[160, 100], [-160, -100]]) {
    const left = Math.min(0, w);
    const top = Math.min(0, h);
    const right = left + Math.abs(w);
    const bottom = top + Math.abs(h);
    const arcs = cloudArcs(w, h);
    assert.ok(arcs.length >= 4);
    for (const a of arcs) {
      const mid = (a.start + a.end) / 2;
      const mx = a.cx + a.r * Math.cos(mid);
      const my = a.cy + a.r * Math.sin(mid);
      if (Math.abs(a.cy - top) < 1e-9) {
        // top edge: canvas y grows downward, so outward means a SMALLER y.
        assert.ok(my < top - 1e-9, `${w}x${h} top scallop sagitta y=${my} is not above the top edge (${top})`);
      } else if (Math.abs(a.cy - bottom) < 1e-9) {
        assert.ok(my > bottom + 1e-9, `${w}x${h} bottom scallop sagitta y=${my} is not below the bottom edge (${bottom})`);
      } else if (Math.abs(a.cx - left) < 1e-9) {
        assert.ok(mx < left - 1e-9, `${w}x${h} left scallop sagitta x=${mx} is not left of the left edge (${left})`);
      } else if (Math.abs(a.cx - right) < 1e-9) {
        assert.ok(mx > right + 1e-9, `${w}x${h} right scallop sagitta x=${mx} is not right of the right edge (${right})`);
      } else {
        assert.fail(`arc centre (${a.cx}, ${a.cy}) is not on a recognised edge`);
      }
    }
  }
});

test('the four sides are all represented', () => {
  const w = 120;
  const h = 80;
  const arcs = cloudArcs(w, h);
  assert.ok(arcs.some((a) => Math.abs(a.cy) < 1e-9), 'no top scallops');
  assert.ok(arcs.some((a) => Math.abs(a.cx - w) < 1e-9), 'no right scallops');
  assert.ok(arcs.some((a) => Math.abs(a.cy - h) < 1e-9), 'no bottom scallops');
  assert.ok(arcs.some((a) => Math.abs(a.cx) < 1e-9), 'no left scallops');
});
