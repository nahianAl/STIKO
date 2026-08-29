import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKUP_COLORS, BLACK, isPresetColor } from '../../lib/markup/colors.ts';
import { PALETTE } from '../../lib/commentColors.ts';

test('the markup row is the five comment pastels plus black, in that order', () => {
  assert.equal(MARKUP_COLORS.length, 6);
  assert.deepEqual(MARKUP_COLORS.slice(0, 5), PALETTE);
  assert.equal(MARKUP_COLORS[5], BLACK);
});

test('the comment palette itself is untouched at five entries', () => {
  // paletteForKey takes PALETTE.length as its modulus. A sixth entry there would
  // recolour the pin and avatar of every comment ever written.
  assert.equal(PALETTE.length, 5);
  assert.ok(!PALETTE.some((p) => p.name === 'black'));
});

test('black strokes black but shows a grey chip', () => {
  assert.equal(BLACK.name, 'black');
  assert.equal(BLACK.accent, '#111111');
  assert.notEqual(BLACK.swatch.toLowerCase(), '#111111');
  assert.match(BLACK.swatch, /^#[0-9A-Fa-f]{6}$/);
});

test('isPresetColor recognises every swatch and nothing else', () => {
  for (const c of MARKUP_COLORS) assert.ok(isPresetColor(c.accent), `${c.name} not recognised`);
  assert.ok(isPresetColor('#111111'.toUpperCase()), 'case must not matter');
  assert.ok(!isPresetColor('#123456'));
});
