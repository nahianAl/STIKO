// lib/markup/colors.ts
// The colours the markup toolbar offers.
//
// Deliberately NOT the same list as the comment palette. PALETTE also drives comment pins
// and avatars through paletteForKey, whose modulus is PALETTE.length — adding a sixth entry
// there would silently reshuffle the colour of every comment ever written, and a black pin
// reads as a rendering bug. Markup stroke colour is independent of all that, so the two
// lists diverge here.
//
// Relative import, not the '@/' alias: this module is unit-tested by `node --test`, which
// does not resolve the alias.
import { PALETTE, type Pastel } from '../commentColors.ts';

/**
 * Grey chip, black stroke. The swatch row's language is "the chip is a pastel hint of the
 * stroke it sets" — a black chip in a row of pastels reads as a hole rather than a colour.
 */
export const BLACK: Pastel = {
  name: 'black',
  swatch: '#9AA1AC',
  dark: '#FFFFFF',
  accent: '#111111',
};

export const MARKUP_COLORS: Pastel[] = [...PALETTE, BLACK];

/**
 * Hex colours agree regardless of case — the picker's hex field and `PALETTE`'s uppercase
 * accents otherwise disagree on identical colours. Every comparison against a swatch accent
 * (here and in the toolbar) must route through this, so a case mismatch can't leave one
 * caller believing a colour is selected while another does not.
 */
export function sameColor(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** True when `color` is one of the fixed swatches — i.e. not something the picker produced. */
export function isPresetColor(color: string): boolean {
  return MARKUP_COLORS.some((entry) => sameColor(entry.accent, color));
}
