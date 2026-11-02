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
export const MIN_WRAP_WIDTH = 120;

/** A resize handle dragged to nothing must still leave something selectable. */
export const MIN_FONT_SIZE = 6;

/** Fraction of the content width a fresh text box wraps at. */
const WRAP_FRACTION = 0.4;

/**
 * Index of the entry in `ladder` nearest to `value`.
 *
 * Ties resolve to the earlier (smaller) entry, because `<` rather than `<=` means a later
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

/** The selection / editing accent. The same colour as the selection box in AnnotationObjects. */
export const MARKUP_ACCENT = '#5B60FF';

/** Inset between a text box's edge and its glyphs, when the box has a fill or a border. */
export const TEXT_PADDING = 8;

/** A text box's border: this wide, in the text's own colour, centred on the box edge. */
export const TEXT_BORDER_WIDTH = 1.5;

/** The floating bar's size presets, small to large. Also the steps of Cmd/Ctrl+Shift+> and <. */
export const FONT_SIZE_PRESETS: readonly number[] = [12, 14, 16, 20, 24, 32, 48, 64];

export const MAX_FONT_SIZE = 400;

/** A fixed-width box narrower than this would wrap every character onto its own line. */
export const MIN_TEXT_WIDTH = 20;

/** A Text-tool press that travels at most this far, in SCREEN px, is a click: an auto-width box. */
export const TEXT_DRAG_MIN_SCREEN_PX = 4;

/** Gap between the floating bar and the box it styles. */
export const TEXT_BAR_GAP = 8;

/**
 * The gap above a SELECTED text. Konva's Transformer puts its rotate handle 50px above the box
 * (rotateAnchorOffset) with a 10px anchor, so a bar at the plain gap would sit on top of the
 * handle and swallow every attempt to rotate. While editing there is no Transformer, so the bar
 * can come in close.
 */
export const TEXT_BAR_ROTATER_GAP = 64;

/** The bar never comes closer than this to the viewer's edges. */
export const TEXT_BAR_MARGIN = 8;

/**
 * The main markup toolbar floats over the top ~58px of every viewer. A bar that would rise into
 * that band drops below the text instead.
 */
export const TEXT_BAR_TOP_INSET = 64;

export type TextAlign = 'left' | 'center' | 'right';

/** Everything the floating bar edits on a text object. */
export interface TextStyle {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** A CSS colour, or '' for no fill. */
  fill: string;
  border: boolean;
}

export const DEFAULT_TEXT_STYLE: Readonly<TextStyle> = {
  fontSize: 20,
  bold: true,
  italic: false,
  align: 'left',
  fill: '',
  border: false,
};

/** Soft callout fills. 'None' is the empty string and is not listed here. */
export const TEXT_FILL_SWATCHES: readonly { value: string; label: string }[] = [
  { value: '#FFFFFF', label: 'White' },
  { value: '#FFF4B8', label: 'Yellow' },
  { value: '#FFE0E0', label: 'Red' },
  { value: '#DDE8FF', label: 'Blue' },
  { value: '#DDF5E3', label: 'Green' },
  { value: '#EEEEEE', label: 'Grey' },
];

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 8 with a fill or a border; 0 otherwise, so a plain text sits exactly where it was typed. */
export function textPadding(obj: { fill: string; border: boolean }): number {
  return obj.fill || obj.border ? TEXT_PADDING : 0;
}

/** Any number into 6..400. Not-a-number (an emptied size field) means the default size. */
export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TEXT_STYLE.fontSize;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n));
}

/**
 * The next preset above (dir 1) or below (dir -1) `size`. Strictly above/below, so an on-ladder
 * size always moves; past either end there is nothing to move to and the size stays.
 */
export function stepFontSize(size: number, dir: 1 | -1): number {
  if (dir > 0) {
    for (const p of FONT_SIZE_PRESETS) if (p > size) return p;
  } else {
    for (let i = FONT_SIZE_PRESETS.length - 1; i >= 0; i--) {
      if (FONT_SIZE_PRESETS[i] < size) return FONT_SIZE_PRESETS[i];
    }
  }
  return clampFontSize(size);
}

/**
 * Whether a Text-tool press became a drag. Horizontal travel only: the box's width is the one
 * thing a drag sets (its height always fits the text), so a vertical-only drag means nothing
 * and stays a click. `box` is in drawing units and `scale` is screen px per drawing unit.
 */
export function isTextDrag(box: { width: number }, minScreenPx: number, scale = 1): boolean {
  return Math.abs(box.width) * scale > minScreenPx;
}

/**
 * A corner drag: the font scales and is baked in, and the wrap width scales by what the font
 * ACTUALLY got. Using the raw factor would let a clamped font leave the width racing ahead of it.
 */
export function scaledTextOnCorner(fontSize: number, width: number, scale: number): { fontSize: number; width: number } {
  const s = Math.abs(scale);
  const next = clampFontSize(fontSize * s);
  const k = fontSize > 0 ? next / fontSize : s;
  return { fontSize: next, width: Math.max(MIN_TEXT_WIDTH, width * k) };
}

/** A side drag: only the width changes. */
export function widthOnSideDrag(width: number, scaleX: number): number {
  return Math.max(MIN_TEXT_WIDTH, width * Math.abs(scaleX));
}

/** Konva's `fontStyle` attribute. Konva puts it first in the canvas font shorthand, where style and weight may come in either order. */
export function konvaFontStyle(s: { bold: boolean; italic: boolean }): string {
  if (s.bold && s.italic) return 'italic bold';
  if (s.bold) return 'bold';
  if (s.italic) return 'italic';
  return 'normal';
}

/**
 * Cmd/Ctrl+Shift+> is +1 and Cmd/Ctrl+Shift+< is -1; anything else is 0. `code` covers layouts
 * whose `key` reports the unshifted '.' / ','.
 */
export function fontStepFromKey(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}): 1 | -1 | 0 {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return 0;
  if (e.key === '>' || e.key === '.' || e.code === 'Period') return 1;
  if (e.key === '<' || e.key === ',' || e.code === 'Comma') return -1;
  return 0;
}

/**
 * Where a Text-tool press puts its box, in drawing units. A click is an auto-width box at the
 * press, kept on the surface; a drag is a fixed box as wide as the drag (either direction),
 * clipped to the surface. `scale` is screen px per drawing unit (the threshold is in screen px).
 */
export function textBoxFromGesture(
  start: { x: number; y: number },
  end: { x: number; y: number },
  scale: number,
  bounds: RectLike,
): { x: number; y: number; width: number; autoWidth: boolean } {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const maxX = bounds.x + bounds.width;
  if (!isTextDrag({ width: right - left }, TEXT_DRAG_MIN_SCREEN_PX, scale)) {
    // The box grows rightwards as you type, so all that can be kept on the surface is its origin.
    return { x: Math.max(bounds.x, Math.min(start.x, maxX - MIN_TEXT_WIDTH)), y: start.y, width: 0, autoWidth: true };
  }
  const l = Math.max(bounds.x, left);
  const width = Math.max(MIN_TEXT_WIDTH, Math.min(maxX, right) - l);
  return { x: Math.max(bounds.x, Math.min(l, maxX - width)), y: Math.min(start.y, end.y), width, autoWidth: false };
}

/**
 * The floating bar's top-left, in the viewer's own pixels. It is centred over the selection,
 * `gapAbove` above it, and drops below (at TEXT_BAR_GAP) when above would rise into the top
 * toolbar band. It is then clamped inside the view.
 */
export function placeTextBar(
  sel: RectLike,
  bar: { width: number; height: number },
  view: { width: number; height: number },
  gapAbove: number,
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  const left = clamp(sel.x + sel.width / 2 - bar.width / 2, TEXT_BAR_MARGIN, view.width - bar.width - TEXT_BAR_MARGIN);
  const above = sel.y - gapAbove - bar.height;
  const top = above >= TEXT_BAR_TOP_INSET ? above : sel.y + sel.height + TEXT_BAR_GAP;
  return { left, top: clamp(top, TEXT_BAR_MARGIN, view.height - bar.height - TEXT_BAR_MARGIN) };
}
