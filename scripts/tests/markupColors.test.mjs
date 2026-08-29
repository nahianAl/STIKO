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

import { normalizeHex, hexToRgb, rgbToHex, hsvToHex, hexToHsv } from '../../lib/markup/color.ts';

test('normalizeHex accepts the forms a person types and rejects the rest', () => {
  assert.equal(normalizeHex('#AABBCC'), '#aabbcc');
  assert.equal(normalizeHex('aabbcc'), '#aabbcc');
  assert.equal(normalizeHex('  #Abc '), '#aabbcc');
  assert.equal(normalizeHex('abc'), '#aabbcc');
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(normalizeHex('#gggggg'), null);
  assert.equal(normalizeHex('rebeccapurple'), null);
});

test('rgb round-trips through hex', () => {
  assert.deepEqual(hexToRgb('#ff8000'), { r: 255, g: 128, b: 0 });
  assert.equal(rgbToHex(255, 128, 0), '#ff8000');
  assert.equal(hexToRgb('nonsense'), null);
});

test('rgbToHex clamps and rounds rather than emitting garbage', () => {
  assert.equal(rgbToHex(-10, 300, 127.6), '#00ff80');
});

test('the primaries land where they should on the hue wheel', () => {
  assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), '#ff0000');
  assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), '#00ff00');
  assert.equal(hsvToHex({ h: 240, s: 1, v: 1 }), '#0000ff');
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), '#ff0000', 'hue must wrap');
  assert.equal(hsvToHex({ h: 200, s: 0, v: 1 }), '#ffffff', 'no saturation is white');
  assert.equal(hsvToHex({ h: 200, s: 1, v: 0 }), '#000000', 'no value is black');
});

test('hex survives a round trip through HSV', () => {
  // The picker holds HSV state and writes hex out. Dragging nothing must not drift the colour.
  for (const hex of ['#ff6b6b', '#4a9fe0', '#7bc24a', '#9a82f0', '#ffcf2e', '#111111', '#ffffff', '#3d7a5c']) {
    const hsv = hexToHsv(hex);
    assert.ok(hsv, `${hex} did not parse`);
    const back = hexToRgb(hsvToHex(hsv));
    const src = hexToRgb(hex);
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(Math.abs(back[ch] - src[ch]) <= 1, `${hex} drifted on ${ch}: ${back[ch]} vs ${src[ch]}`);
    }
  }
});

test('hexToHsv reports the components the picker positions its handles from', () => {
  assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 });
  assert.deepEqual(hexToHsv('#ffffff'), { h: 0, s: 0, v: 1 });
  const red = hexToHsv('#ff0000');
  assert.equal(red.h, 0);
  assert.equal(red.s, 1);
  assert.equal(red.v, 1);
  assert.equal(hexToHsv('#00ffff').h, 180);
  assert.equal(hexToHsv('zzz'), null);
});
