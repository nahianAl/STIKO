import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_SIZE_PRESETS,
  MIN_WRAP_WIDTH,
  MIN_FONT_SIZE,
  wrapWidthForContent,
  isBlank,
} from '../../lib/markup/text.ts';

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
  assert.ok(MIN_FONT_SIZE <= FONT_SIZE_PRESETS[0]);
});
