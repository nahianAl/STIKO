import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONT_SIZE_PRESETS, MIN_FONT_SIZE, TEXT_FONT_FAMILY, isBlank } from '../../lib/markup/text.ts';

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

test('markup text is pinned to a family Konva and the DOM both resolve', () => {
  // The editor and the Konva node only measure alike when both are told the same family.
  assert.equal(TEXT_FONT_FAMILY, 'Arial');
});
