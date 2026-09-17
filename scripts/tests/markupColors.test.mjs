import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKUP_COLORS, BLACK, isPresetColor, sameColor, readableTextOn } from '../../lib/markup/colors.ts';
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

test('sameColor is case-insensitive, both directions', () => {
  // The bug this guards: PALETTE accents are uppercase (#FFCF2E) but a hex typed into the
  // picker comes out lowercase. Both a swatch-ring check and isPresetColor route through
  // this, so they can never disagree on a mixed-case match.
  assert.ok(sameColor('#ffcf2e', '#FFCF2E'));
  assert.ok(sameColor('#FFCF2E', '#ffcf2e'));
  assert.ok(sameColor('#abc123', '#abc123'));
  assert.ok(!sameColor('#ffcf2e', '#111111'));
});

// WCAG relative luminance / contrast ratio, reimplemented here independently of
// lib/markup/colors.ts's own arithmetic — so this test cannot pass merely because it shares
// a bug with the code under test. sRGB channels, 0.03928 linearisation threshold, the
// 0.2126/0.7152/0.0722 luminance weights, per the WCAG 2.x formula.
function srgbChannelToLinear(channel255) {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const n = hex.replace(/^#/, '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

test('readableTextOn picks the dark ink for yellow and white for black', () => {
  // White on #FFCF2E is 1.48:1 (illegible); black-ish ink on #111111 is 1.11:1 — the two ends
  // of the palette that a fixed text colour cannot serve at once.
  assert.equal(readableTextOn('#FFCF2E'), '#1C2030');
  assert.equal(readableTextOn('#111111'), '#FFFFFF');
});

test('readableTextOn clears 4.5:1 on every swatch in MARKUP_COLORS', () => {
  // Property test, not a table of expectations: computes the ratio for whatever
  // readableTextOn picks against whatever MARKUP_COLORS currently contains, so a swatch added
  // later is checked automatically instead of silently skipped.
  for (const entry of MARKUP_COLORS) {
    const text = readableTextOn(entry.accent);
    const ratio = contrastRatio(entry.accent, text);
    assert.ok(
      ratio >= 4.5,
      `${entry.name} (${entry.accent}) paired with ${text} only reaches ${ratio.toFixed(2)}:1`,
    );
  }
});

test('readableTextOn is case-insensitive on its hex input', () => {
  // Same bug class sameColor guards against: the picker and MARKUP_COLORS disagree on case.
  assert.equal(readableTextOn('#ffcf2e'), readableTextOn('#FFCF2E'));
  assert.equal(readableTextOn('#111111'), readableTextOn(('#111111').toLowerCase()));
  assert.equal(readableTextOn('#AbCdEf'), readableTextOn('#abcdef'));
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
