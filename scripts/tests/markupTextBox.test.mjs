import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKUP_ACCENT,
  TEXT_PADDING,
  TEXT_BORDER_WIDTH,
  FONT_SIZE_PRESETS,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_TEXT_WIDTH,
  TEXT_DRAG_MIN_SCREEN_PX,
  DEFAULT_TEXT_STYLE,
  TEXT_FILL_SWATCHES,
  TEXT_BAR_GAP,
  TEXT_BAR_ROTATER_GAP,
  TEXT_BAR_MARGIN,
  TEXT_BAR_TOP_INSET,
  textPadding,
  clampFontSize,
  stepFontSize,
  isTextDrag,
  scaledTextOnCorner,
  widthOnSideDrag,
  konvaFontStyle,
  fontStepFromKey,
  textBoxFromGesture,
  placeTextBar,
} from '../../lib/markup/text.ts';

test('the values the spec fixes', () => {
  assert.equal(MARKUP_ACCENT, '#5B60FF');
  assert.equal(TEXT_PADDING, 8);
  assert.equal(TEXT_BORDER_WIDTH, 1.5);
  assert.deepEqual([...FONT_SIZE_PRESETS], [12, 14, 16, 20, 24, 32, 48, 64]);
  assert.equal(MIN_FONT_SIZE, 6);
  assert.equal(MAX_FONT_SIZE, 400);
  assert.equal(TEXT_DRAG_MIN_SCREEN_PX, 4);
  assert.deepEqual(
    { ...DEFAULT_TEXT_STYLE },
    { fontSize: 20, bold: true, italic: false, align: 'left', fill: '', border: false },
  );
  assert.deepEqual(
    TEXT_FILL_SWATCHES.map((s) => s.value),
    ['#FFFFFF', '#FFF4B8', '#FFE0E0', '#DDE8FF', '#DDF5E3', '#EEEEEE'],
  );
  assert.deepEqual(TEXT_FILL_SWATCHES.map((s) => s.label), ['White', 'Yellow', 'Red', 'Blue', 'Green', 'Grey']);
});

test('padding only appears with a fill or a border, so plain text sits where it was typed', () => {
  assert.equal(textPadding({ fill: '', border: false }), 0);
  assert.equal(textPadding({ fill: '#FFF4B8', border: false }), 8);
  assert.equal(textPadding({ fill: '', border: true }), 8);
  assert.equal(textPadding({ fill: '#FFFFFF', border: true }), 8);
});

test('clampFontSize keeps 6..400 and turns garbage into the default', () => {
  assert.equal(clampFontSize(3), 6);
  assert.equal(clampFontSize(500), 400);
  assert.equal(clampFontSize(18), 18);
  assert.equal(clampFontSize(Number.NaN), 20);
  assert.equal(clampFontSize(Number.POSITIVE_INFINITY), 20);
});

test('stepFontSize moves to the next or previous preset, from on or off the ladder', () => {
  assert.equal(stepFontSize(20, 1), 24);
  assert.equal(stepFontSize(20, -1), 16);
  assert.equal(stepFontSize(18, 1), 20);
  assert.equal(stepFontSize(18, -1), 16);
  assert.equal(stepFontSize(8, 1), 12);
  // Past either end there is no preset to move to: stay put (clamped).
  assert.equal(stepFontSize(64, 1), 64);
  assert.equal(stepFontSize(100, 1), 100);
  assert.equal(stepFontSize(100, -1), 64);
  assert.equal(stepFontSize(12, -1), 12);
  assert.equal(stepFontSize(6, -1), 6);
});

test('isTextDrag measures the HORIZONTAL travel in screen pixels', () => {
  assert.equal(isTextDrag({ width: 4 }, 4), false);
  assert.equal(isTextDrag({ width: 5 }, 4), true);
  assert.equal(isTextDrag({ width: -5 }, 4), true);
  // 3 page px at 2x zoom is 6 screen px: a drag. At 1x it is a click.
  assert.equal(isTextDrag({ width: 3 }, 4, 2), true);
  assert.equal(isTextDrag({ width: 3 }, 4, 1), false);
});

test('a corner scales font and width together, and a clamped font drags the width back with it', () => {
  assert.deepEqual(scaledTextOnCorner(20, 200, 2), { fontSize: 40, width: 400 });
  assert.deepEqual(scaledTextOnCorner(20, 100, -1.5), { fontSize: 30, width: 150 });
  // 20 * 0.1 = 2, clamped to 6: the width follows the 0.3 the font really got.
  const shrunk = scaledTextOnCorner(20, 200, 0.1);
  assert.equal(shrunk.fontSize, 6);
  assert.ok(Math.abs(shrunk.width - 60) < 1e-9);
  const grown = scaledTextOnCorner(300, 100, 2);
  assert.equal(grown.fontSize, 400);
  assert.ok(Math.abs(grown.width - (100 * 400) / 300) < 1e-9);
  assert.equal(scaledTextOnCorner(20, 10, 1).width, MIN_TEXT_WIDTH);
});

test('a side drag scales only the width, never below the floor', () => {
  assert.equal(widthOnSideDrag(200, 1.5), 300);
  assert.equal(widthOnSideDrag(200, -0.5), 100);
  assert.equal(widthOnSideDrag(200, 0.01), MIN_TEXT_WIDTH);
});

test('konvaFontStyle builds the fontStyle string Konva expects', () => {
  assert.equal(konvaFontStyle({ bold: false, italic: false }), 'normal');
  assert.equal(konvaFontStyle({ bold: true, italic: false }), 'bold');
  assert.equal(konvaFontStyle({ bold: false, italic: true }), 'italic');
  assert.equal(konvaFontStyle({ bold: true, italic: true }), 'italic bold');
});

test('fontStepFromKey: Cmd/Ctrl+Shift+> and < only', () => {
  const k = (o) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  assert.equal(fontStepFromKey(k({ key: '>', metaKey: true, shiftKey: true })), 1);
  assert.equal(fontStepFromKey(k({ key: '<', ctrlKey: true, shiftKey: true })), -1);
  // Layouts that report the unshifted key still carry the physical code.
  assert.equal(fontStepFromKey(k({ key: '.', code: 'Period', metaKey: true, shiftKey: true })), 1);
  assert.equal(fontStepFromKey(k({ key: ',', code: 'Comma', ctrlKey: true, shiftKey: true })), -1);
  assert.equal(fontStepFromKey(k({ key: '>', metaKey: true })), 0);
  assert.equal(fontStepFromKey(k({ key: '>', shiftKey: true })), 0);
  assert.equal(fontStepFromKey(k({ key: '>', metaKey: true, shiftKey: true, altKey: true })), 0);
  assert.equal(fontStepFromKey(k({ key: 'a', metaKey: true, shiftKey: true })), 0);
});

test('textBoxFromGesture: a click makes an auto-width box at the press', () => {
  const page = { x: 0, y: 0, width: 1000, height: 800 };
  assert.deepEqual(textBoxFromGesture({ x: 100, y: 50 }, { x: 102, y: 51 }, 1, page), { x: 100, y: 50, width: 0, autoWidth: true });
  // Too close to the right edge: pulled in so at least MIN_TEXT_WIDTH stays on the surface.
  assert.deepEqual(textBoxFromGesture({ x: 995, y: 50 }, { x: 995, y: 50 }, 1, page), { x: 980, y: 50, width: 0, autoWidth: true });
  // Left of an inset surface (AnnotationCanvas's fitted background): pushed onto it.
  assert.deepEqual(
    textBoxFromGesture({ x: 10, y: 10 }, { x: 10, y: 10 }, 1, { x: 50, y: 0, width: 500, height: 500 }),
    { x: 50, y: 10, width: 0, autoWidth: true },
  );
});

test('textBoxFromGesture: a drag makes a fixed box as wide as the drag, in either direction', () => {
  const page = { x: 0, y: 0, width: 1000, height: 800 };
  assert.deepEqual(textBoxFromGesture({ x: 100, y: 50 }, { x: 300, y: 120 }, 1, page), { x: 100, y: 50, width: 200, autoWidth: false });
  assert.deepEqual(textBoxFromGesture({ x: 300, y: 120 }, { x: 100, y: 50 }, 1, page), { x: 100, y: 50, width: 200, autoWidth: false });
  // Off the right edge: clipped to the surface.
  assert.deepEqual(textBoxFromGesture({ x: 900, y: 10 }, { x: 1100, y: 40 }, 1, page), { x: 900, y: 10, width: 100, autoWidth: false });
  // The threshold is in SCREEN px: 3 page px is a click at 1x and a drag at 2x (floored to MIN_TEXT_WIDTH).
  assert.equal(textBoxFromGesture({ x: 100, y: 50 }, { x: 103, y: 50 }, 1, page).autoWidth, true);
  assert.deepEqual(textBoxFromGesture({ x: 100, y: 50 }, { x: 103, y: 50 }, 2, page), { x: 100, y: 50, width: MIN_TEXT_WIDTH, autoWidth: false });
});

test('placeTextBar: centred above, dropping below when there is no room, clamped to the view', () => {
  const view = { width: 800, height: 600 };
  const bar = { width: 300, height: 36 };
  assert.equal(TEXT_BAR_GAP, 8);
  assert.equal(TEXT_BAR_ROTATER_GAP, 64);
  assert.equal(TEXT_BAR_MARGIN, 8);
  assert.equal(TEXT_BAR_TOP_INSET, 64);
  assert.deepEqual(placeTextBar({ x: 300, y: 300, width: 200, height: 50 }, bar, view, TEXT_BAR_GAP), { left: 250, top: 256 });
  // A selection shows the rotate handle above it: the bar clears it.
  assert.deepEqual(placeTextBar({ x: 300, y: 300, width: 200, height: 50 }, bar, view, TEXT_BAR_ROTATER_GAP), { left: 250, top: 200 });
  // Above would land under the main toolbar's band: go below, at the plain gap.
  assert.deepEqual(placeTextBar({ x: 300, y: 80, width: 200, height: 50 }, bar, view, TEXT_BAR_GAP), { left: 250, top: 138 });
  assert.equal(placeTextBar({ x: 0, y: 300, width: 20, height: 20 }, bar, view, TEXT_BAR_GAP).left, 8);
  assert.equal(placeTextBar({ x: 780, y: 300, width: 20, height: 20 }, bar, view, TEXT_BAR_GAP).left, 492);
  assert.equal(placeTextBar({ x: 300, y: 40, width: 200, height: 600 }, bar, view, TEXT_BAR_GAP).top, 556);
  // A view narrower than the bar pins it to the left margin rather than off-screen.
  assert.equal(placeTextBar({ x: 50, y: 300, width: 20, height: 20 }, bar, { width: 200, height: 600 }, TEXT_BAR_GAP).left, 8);
});
