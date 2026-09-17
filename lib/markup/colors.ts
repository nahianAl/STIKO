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
import { hexToRgb } from './color.ts';

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

/** The repo's near-black ink, used wherever pure black would be harsher than the design wants. */
const INK = '#1C2030';

/** sRGB channel (0-255) to linear, per the WCAG relative-luminance formula's own threshold. */
function srgbChannelToLinear(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a hex colour. Throws if `hex` cannot be parsed — callers guard. */
function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`relativeLuminance: unparseable hex "${hex}"`);
  return (
    0.2126 * srgbChannelToLinear(rgb.r) +
    0.7152 * srgbChannelToLinear(rgb.g) +
    0.0722 * srgbChannelToLinear(rgb.b)
  );
}

/** WCAG contrast ratio between two relative luminances, always >= 1. */
function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE_LUMINANCE = relativeLuminance('#FFFFFF');
const INK_LUMINANCE = relativeLuminance(INK);

/**
 * Black or white, whichever is readable on `background`.
 *
 * The markup palette spans #FFCF2E to #111111, so a fixed text colour is illegible at one end
 * or the other: white on the yellow swatch is 1.48:1, black on the black swatch is 1.11:1.
 * Picking by relative luminance clears 4.5:1 on every swatch in the row.
 */
export function readableTextOn(background: string): string {
  // An unparseable colour has no correct answer; fall back to the repo's ink rather than
  // throw, matching hexToRgb's own null-is-safe convention for bad input.
  const rgb = hexToRgb(background);
  if (!rgb) return INK;

  const luminance = relativeLuminance(background);
  const withWhite = contrastRatio(luminance, WHITE_LUMINANCE);
  const withInk = contrastRatio(luminance, INK_LUMINANCE);
  return withWhite >= withInk ? '#FFFFFF' : INK;
}
