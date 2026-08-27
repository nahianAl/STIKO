// lib/markup/text.ts
// Arithmetic behind markup text. Deliberately free of React, Konva and three so the
// node --test suite can import it directly.

/**
 * Pinned rather than inherited. Konva measures text with canvas `measureText`, and the
 * overlaid editor measures it with the DOM — the two only agree if both are told the same
 * family. `next/font` exposes Manrope under a hashed name via a CSS variable, which Konva
 * cannot resolve, so markup text stays on the websafe family Konva already defaulted to.
 */
export const TEXT_FONT_FAMILY = 'Arial';

/** Toolbar stroke presets, thin to thick. Index-aligned with FONT_SIZES. */
export const STROKE_PRESETS: readonly number[] = [2, 4, 6];

/** What each stroke preset means for a text object. Index-aligned with STROKE_PRESETS. */
export const FONT_SIZES: readonly number[] = [16, 24, 34];

/** A text box narrower than this is not worth typing in, whatever the content width says. */
export const MIN_WRAP_WIDTH = 80;

/** A resize handle dragged to nothing must still leave something selectable. */
export const MIN_FONT_SIZE = 6;

/** Fraction of the content width a fresh text box wraps at. */
const WRAP_FRACTION = 0.4;

/**
 * Index of the entry in `ladder` nearest to `value`.
 *
 * Ties resolve to the earlier (smaller) entry, because `>` rather than `>=` means a later
 * entry has to be strictly closer to win. That determinism matters: `strokeWidthForFontSize`
 * is fed continuous sizes from a manual resize, and a toolbar chip that flickered between two
 * presets for the same object would look like a bug.
 */
function nearestIndex(ladder: readonly number[], value: number): number {
  let best = 0;
  for (let i = 1; i < ladder.length; i++) {
    if (Math.abs(ladder[i] - value) < Math.abs(ladder[best] - value)) best = i;
  }
  return best;
}

/** Toolbar stroke width -> text font size. Off-ladder widths clamp to the nearest preset. */
export function fontSizeForStrokeWidth(strokeWidth: number): number {
  return FONT_SIZES[nearestIndex(STROKE_PRESETS, strokeWidth)];
}

/** Text font size -> the toolbar stroke preset that should read as active. */
export function strokeWidthForFontSize(fontSize: number): number {
  return STROKE_PRESETS[nearestIndex(FONT_SIZES, fontSize)];
}

/**
 * Wrap width for a fresh text box, in the content's own coordinate space.
 *
 * The caller passes the *content* width — the fitted background region on AnnotationCanvas,
 * the page width on PDFKonvaViewer — never the stage width. On a zoomable surface the stage
 * width changes with the zoom, and deriving the wrap from it would reflow already-committed
 * text on every zoom step.
 */
export function wrapWidthForContent(contentWidth: number): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return MIN_WRAP_WIDTH;
  return Math.min(contentWidth, Math.max(Math.round(contentWidth * WRAP_FRACTION), MIN_WRAP_WIDTH));
}

/** True when committing this text should discard the object instead of keeping it. */
export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}
