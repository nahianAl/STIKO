import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STROKE_PRESETS,
  FONT_SIZES,
  MIN_WRAP_WIDTH,
  MIN_FONT_SIZE,
  fontSizeForStrokeWidth,
  strokeWidthForFontSize,
  wrapWidthForContent,
  isBlank,
} from '../../lib/markup/text.ts';

test('every stroke preset maps to a font size and back again', () => {
  // The toolbar writes a stroke width and later has to show which preset is active for a
  // selected text object. That only works if the map round-trips exactly on the presets.
  for (const w of STROKE_PRESETS) {
    assert.equal(strokeWidthForFontSize(fontSizeForStrokeWidth(w)), w, `stroke ${w} did not round-trip`);
  }
  for (const px of FONT_SIZES) {
    assert.equal(fontSizeForStrokeWidth(strokeWidthForFontSize(px)), px, `size ${px} did not round-trip`);
  }
});

test('the presets are the documented 2/4/6 -> 16/24/34 ladder', () => {
  assert.deepEqual([...STROKE_PRESETS], [2, 4, 6]);
  assert.equal(fontSizeForStrokeWidth(2), 16);
  assert.equal(fontSizeForStrokeWidth(4), 24);
  assert.equal(fontSizeForStrokeWidth(6), 34);
});

test('an unmapped stroke width clamps to the nearest preset', () => {
  assert.equal(fontSizeForStrokeWidth(1), 16);    // below the ladder
  assert.equal(fontSizeForStrokeWidth(99), 34);   // above the ladder
  assert.equal(fontSizeForStrokeWidth(4.6), 24);  // strictly nearer 4 than 6
  assert.equal(fontSizeForStrokeWidth(2.9), 16);  // strictly nearer 2 than 4
});

test('a tie between two presets resolves to the thinner one, deterministically', () => {
  // The presets are evenly spaced, so 3 and 5 are each exactly between two of them. Which way
  // a tie goes matters less than that it never varies, because a scaled text object feeds an
  // arbitrary size back through strokeWidthForFontSize.
  assert.equal(fontSizeForStrokeWidth(3), 16);
  assert.equal(fontSizeForStrokeWidth(5), 24);
  assert.equal(fontSizeForStrokeWidth(3), 16);
});

test('an arbitrary font size from a manual resize clamps to the nearest preset', () => {
  // bakeTextTransform produces continuous sizes; the toolbar still has to highlight one chip.
  assert.equal(strokeWidthForFontSize(17), 2);
  assert.equal(strokeWidthForFontSize(23), 4);
  assert.equal(strokeWidthForFontSize(200), 6);
  assert.equal(strokeWidthForFontSize(1), 2);
});

test('wrap width is 40% of the content', () => {
  assert.equal(wrapWidthForContent(1000), 400);
  assert.equal(wrapWidthForContent(2000), 800);
});

test('wrap width never falls below the floor, so a narrow page is still typable', () => {
  // 40% of 200 is 80, under the floor — but 200 itself is over it, so the floor is what wins.
  // Content must be wider than MIN_WRAP_WIDTH here, or the clamp below takes precedence and
  // this asserts nothing about the floor.
  const content = MIN_WRAP_WIDTH * 2;
  assert.ok(content * 0.4 < MIN_WRAP_WIDTH, 'test setup: 40% must fall under the floor');
  assert.equal(wrapWidthForContent(content), MIN_WRAP_WIDTH);
});

test('the clamp to content beats the floor, so the box never exceeds the page', () => {
  // Content narrower than the floor. The floor must not push the box wider than the page it
  // sits on, so this returns the content width rather than MIN_WRAP_WIDTH.
  const narrow = MIN_WRAP_WIDTH - 20;
  assert.equal(wrapWidthForContent(narrow), narrow);
});

test('an unmeasured container yields the floor rather than a zero-width box', () => {
  // Both surfaces render before their ResizeObserver has fired at least once.
  assert.equal(wrapWidthForContent(0), MIN_WRAP_WIDTH);
  assert.equal(wrapWidthForContent(-5), MIN_WRAP_WIDTH);
});

test('blank text is anything with no visible glyphs', () => {
  assert.equal(isBlank(''), true);
  assert.equal(isBlank('   '), true);
  assert.equal(isBlank('\n\n'), true);
  assert.equal(isBlank(' \t \n '), true);
  assert.equal(isBlank('a'), false);
  assert.equal(isBlank('  hi  '), false);
});

test('MIN_FONT_SIZE keeps a shrunk text object selectable', () => {
  assert.ok(MIN_FONT_SIZE > 0);
  assert.ok(MIN_FONT_SIZE <= FONT_SIZES[0]);
});
