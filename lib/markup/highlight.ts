// lib/markup/highlight.ts
// The Highlighter markup tool's look and its one colour rule (spec:
// docs/superpowers/specs/2026-11-20-pdf-zoom-jump-highlight-design.md §3).
// Relative `.ts` imports only: unit-tested by `node --test`.
import { sameColor } from './colors.ts';

/** A highlight is this many times the chosen stroke width. */
export const HIGHLIGHT_WIDTH_FACTOR = 6;
/**
 * Node opacity. Translucent rather than multiplied: markup sits on its own Konva layer above the
 * page, so a multiply blend would have nothing beneath it to multiply with.
 */
export const HIGHLIGHT_OPACITY = 0.4;
/** PALETTE's yellow accent — the swatch row then shows it as selected. */
export const HIGHLIGHT_COLOR = '#FFCF2E';
/** The portal's starting markup colour (PALETTE's red accent). */
export const DEFAULT_MARKUP_COLOR = '#FF6B6B';

export function highlightStrokeWidth(strokeWidth: number): number {
  return strokeWidth * HIGHLIGHT_WIDTH_FACTOR;
}

/** The colour to use when the Highlighter is armed: yellow if the picker is still on the default, else unchanged. */
export function colorOnArmHighlight(current: string): string {
  return sameColor(current, DEFAULT_MARKUP_COLOR) ? HIGHLIGHT_COLOR : current;
}
