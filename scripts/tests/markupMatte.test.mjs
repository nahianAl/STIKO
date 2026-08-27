import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matteRectForStage } from '../../lib/markup/matte.ts';

const CONTAINER = { width: 800, height: 600 };

/**
 * Project a page-space rect back to screen space the way Konva does: the Stage carries the
 * scale and the translation, and every layer inherits them. This is the oracle — the matte is
 * correct exactly when its projection covers the container.
 */
const project = (rect, stagePos, stageScale) => ({
  x: rect.x * stageScale + stagePos.x,
  y: rect.y * stageScale + stagePos.y,
  width: rect.width * stageScale,
  height: rect.height * stageScale,
});

const cases = [
  { name: 'unscaled and unpanned', stagePos: { x: 0, y: 0 }, stageScale: 1 },
  { name: 'fitted small, centred', stagePos: { x: 120, y: 40 }, stageScale: 0.5 },
  { name: 'zoomed in past the edges', stagePos: { x: -300, y: -220 }, stageScale: 3 },
  { name: 'zoomed out', stagePos: { x: 260, y: 190 }, stageScale: 0.25 },
  { name: 'panned so the page origin is off-screen left', stagePos: { x: -900, y: 30 }, stageScale: 1.4 },
];

for (const c of cases) {
  test(`the matte covers the container exactly when ${c.name}`, () => {
    const rect = matteRectForStage({ stagePos: c.stagePos, stageScale: c.stageScale, containerSize: CONTAINER });
    const onScreen = project(rect, c.stagePos, c.stageScale);
    // Exactly, not merely "contains": any overshoot is wasted fill, any shortfall is a
    // transparent strip that JPEG encodes as the black border this whole change removes.
    assert.ok(Math.abs(onScreen.x) < 1e-9, `left edge at ${onScreen.x}`);
    assert.ok(Math.abs(onScreen.y) < 1e-9, `top edge at ${onScreen.y}`);
    assert.ok(Math.abs(onScreen.width - CONTAINER.width) < 1e-9, `width ${onScreen.width}`);
    assert.ok(Math.abs(onScreen.height - CONTAINER.height) < 1e-9, `height ${onScreen.height}`);
  });
}

test('a degenerate scale yields an empty rect rather than NaN or Infinity', () => {
  // Both surfaces render at least once before their fit effect has run, when stageScale is
  // still its initial value. An Infinity here would poison the whole layer.
  for (const stageScale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const rect = matteRectForStage({ stagePos: { x: 0, y: 0 }, stageScale, containerSize: CONTAINER });
    for (const v of [rect.x, rect.y, rect.width, rect.height]) {
      assert.ok(Number.isFinite(v), `stageScale ${stageScale} produced ${v}`);
    }
    assert.equal(rect.width, 0);
    assert.equal(rect.height, 0);
  }
});

test('an unmeasured container yields an empty rect', () => {
  const rect = matteRectForStage({ stagePos: { x: 0, y: 0 }, stageScale: 1, containerSize: { width: 0, height: 0 } });
  assert.equal(rect.width, 0);
  assert.equal(rect.height, 0);
});
