// Geometry for the PDF viewer's "detail" render: the on-screen part of a page, redrawn at true
// screen resolution over the base render once zoom/pan settles (spec:
// docs/superpowers/specs/2026-11-20-pdf-zoom-jump-highlight-design.md §1).
// Pure, no React. Relative `.ts` imports only: `node --test` loads this directly.
import { MAX_CANVAS_PIXELS } from './viewMode.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The overlap of two rects, or null when they do not overlap (touching edges do not count). */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Grow `r` (CSS px) outward to whole device pixels at `dpr`, so a tile's edges sit on pixel boundaries. */
export function snapOutward(r: Rect, dpr: number): Rect {
  const x0 = Math.floor(r.x * dpr);
  const y0 = Math.floor(r.y * dpr);
  const x1 = Math.ceil((r.x + r.width) * dpr);
  const y1 = Math.ceil((r.y + r.height) * dpr);
  return { x: x0 / dpr, y: y0 / dpr, width: (x1 - x0) / dpr, height: (y1 - y0) / dpr };
}

/** Slack so a base drawn at (nearly) screen density is not redrawn over a rounding difference. */
export const DETAIL_TOLERANCE = 1.05;

/**
 * True when a base bitmap `baseBitmapWidth` device px wide, shown `displayWidth` CSS px wide,
 * has fewer device pixels per CSS pixel than the screen (`dpr`) — i.e. it is visibly stretched.
 */
export function needsDetail(baseBitmapWidth: number, displayWidth: number, dpr: number): boolean {
  if (baseBitmapWidth <= 0 || displayWidth <= 0) return false;
  return (baseBitmapWidth / displayWidth) * DETAIL_TOLERANCE < dpr;
}

export interface DetailParams {
  /** pdf.js viewport scale (device px per PDF point). */
  scale: number;
  /** pdf.js viewport offsets: shift the page so the region's top-left lands on the canvas origin. */
  offsetX: number;
  offsetY: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * pdf.js parameters to draw only `region` of a page.
 * - `pageWidthPt`: the page's width at viewport scale 1 (PDF points, rotation applied).
 * - `region`: CSS px relative to the page's top-left, with the page displayed `displayWidth` CSS px wide.
 * - `dpr`: device pixel ratio; lowered when the tile would exceed MAX_CANVAS_PIXELS.
 */
export function detailRenderParams(pageWidthPt: number, region: Rect, displayWidth: number, dpr: number): DetailParams {
  const area = region.width * region.height;
  const d = area > 0 ? Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / area)) : dpr;
  return {
    scale: (displayWidth * d) / pageWidthPt,
    offsetX: -region.x * d,
    offsetY: -region.y * d,
    canvasWidth: Math.max(1, Math.ceil(region.width * d)),
    canvasHeight: Math.max(1, Math.ceil(region.height * d)),
  };
}
