// Pure logic for the PDF viewer's two modes (spec: docs/superpowers/specs/2026-11-01-pdf-sidebar-scroll-design.md).
// No React, no imports: `node --test` loads this file directly (scripts/tests/pdfViewMode.test.mjs).

export type PdfViewMode = 'scroll' | 'single';

export const MODE_STORAGE_KEY = 'stiko.pdfViewer.mode';
/** Same bounds as PDFKonvaViewer's single-page adjustZoom. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
/** iOS Safari refuses canvases over ~16.7M pixels; Chrome caps a side at 16384 (some GPUs lower). */
export const MAX_CANVAS_PIXELS = 16_000_000;
export const MAX_CANVAS_SIDE = 16_384;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** window.localStorage, or null where it is missing or blocked (the getter itself can throw). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredMode(storage: StorageLike | null): PdfViewMode {
  try {
    return storage?.getItem(MODE_STORAGE_KEY) === 'scroll' ? 'scroll' : 'single';
  } catch {
    return 'single';
  }
}

export function writeStoredMode(storage: StorageLike | null, mode: PdfViewMode): void {
  try {
    storage?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Private window, quota, blocked site data: the toggle still works for this visit.
  }
}

/**
 * The mode actually on screen. The sidebar decides, with two overrides: a 1-page PDF is always
 * single-page, and a markup or measure session always runs single-page (a markup snapshot is one
 * page). `numPages` 0 means "not loaded yet" and does not override.
 */
export function effectiveMode(a: { sidebarOpen: boolean; numPages: number; annotating: boolean }): PdfViewMode {
  if (a.annotating || a.numPages === 1) return 'single';
  return a.sidebarOpen ? 'scroll' : 'single';
}

export function clampZoom(scale: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
}

/** A page's size in page pixels at zoom 1 (PDF points × PDF_RENDER_SCALE). */
export interface PageSize {
  width: number;
  height: number;
}

export interface LaidOutPage {
  page: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PageLayout {
  pages: LaidOutPage[];
  contentWidth: number;
  contentHeight: number;
}

/** Stack pages top to bottom. `gap` and `padding` are CSS pixels and do not scale with zoom. */
export function layoutPages(sizes: PageSize[], scale: number, gap: number, padding: number): PageLayout {
  const pages: LaidOutPage[] = [];
  let y = padding;
  let maxWidth = 0;
  sizes.forEach((s, i) => {
    const width = s.width * scale;
    const height = s.height * scale;
    pages.push({ page: i + 1, top: y, bottom: y + height, width, height });
    y += height + gap;
    maxWidth = Math.max(maxWidth, width);
  });
  return {
    pages,
    contentWidth: maxWidth + padding * 2,
    contentHeight: sizes.length ? y - gap + padding : 0,
  };
}

/** The zoom at which the widest page exactly fills the viewport width inside the padding. */
export function fitWidthScale(sizes: PageSize[], viewportWidth: number, padding: number): number {
  const widest = sizes.reduce((m, s) => Math.max(m, s.width), 0);
  if (widest <= 0 || viewportWidth <= 0) return 1;
  return clampZoom((viewportWidth - padding * 2) / widest);
}

/**
 * The page covering the most of [viewTop, viewBottom]. Ties go to the lower page (pages are in
 * order and only a strictly larger cover wins). With the viewport inside a gap every cover is
 * negative and the nearest page wins. `scrolledToEnd` forces the last page, so the counter can
 * reach N even when the last sheet is shorter than the one above it.
 */
export function mostVisiblePage(pages: LaidOutPage[], viewTop: number, viewBottom: number, scrolledToEnd: boolean): number {
  if (!pages.length) return 1;
  if (scrolledToEnd) return pages[pages.length - 1].page;
  let best = pages[0].page;
  let bestCover = -Infinity;
  for (const p of pages) {
    const cover = Math.min(p.bottom, viewBottom) - Math.max(p.top, viewTop);
    if (cover > bestCover) {
      best = p.page;
      bestCover = cover;
    }
  }
  return best;
}

/** Pages that intersect the viewport grown by `overscan` px above and below. */
export function pagesToRender(pages: LaidOutPage[], viewTop: number, viewBottom: number, overscan: number): Set<number> {
  const lo = viewTop - overscan;
  const hi = viewBottom + overscan;
  const out = new Set<number>();
  for (const p of pages) if (p.bottom >= lo && p.top <= hi) out.add(p.page);
  return out;
}

/** The scrollTop that puts `page`'s top one gap below the top edge; 0 for an unknown page. */
export function scrollTopForPage(layout: PageLayout, page: number, gap: number): number {
  const p = layout.pages[page - 1];
  return p ? Math.max(0, p.top - gap) : 0;
}

/**
 * Where to scroll after a zoom so the content under the pointer stays under it.
 * Vertical: the same offset into the same page, scaled. Horizontal: pages are centred in a column
 * max(contentWidth, viewportWidth) wide, so the offset from the column centre scales with zoom.
 * The fixed gaps and padding make points outside a page drift by a few pixels, which is fine.
 */
export function anchoredScroll(a: {
  before: PageLayout;
  after: PageLayout;
  ratio: number;
  scrollLeft: number;
  scrollTop: number;
  pointerX: number;
  pointerY: number;
  viewportWidth: number;
}): { scrollLeft: number; scrollTop: number } {
  const y = a.scrollTop + a.pointerY;
  let idx = 0;
  for (let i = 0; i < a.before.pages.length; i++) if (a.before.pages[i].top <= y) idx = i;
  const b = a.before.pages[idx];
  const n = a.after.pages[idx];
  const newY = b && n ? n.top + (y - b.top) * a.ratio : y;

  const colBefore = Math.max(a.before.contentWidth, a.viewportWidth);
  const colAfter = Math.max(a.after.contentWidth, a.viewportWidth);
  const x = a.scrollLeft + a.pointerX;
  const newX = colAfter / 2 + (x - colBefore / 2) * a.ratio;

  return { scrollLeft: Math.max(0, newX - a.pointerX), scrollTop: Math.max(0, newY - a.pointerY) };
}

/** The scrollTop that brings [itemTop, itemBottom] fully into view, or null when it already is. */
export function scrollTopToReveal(itemTop: number, itemBottom: number, viewTop: number, viewHeight: number): number | null {
  if (itemTop < viewTop) return itemTop;
  if (itemBottom > viewTop + viewHeight) return itemBottom - viewHeight;
  return null;
}

/** The largest render scale ≤ `desired` that keeps a baseWidth×baseHeight page within canvas limits. */
export function cappedRenderScale(baseWidth: number, baseHeight: number, desired: number): number {
  if (baseWidth <= 0 || baseHeight <= 0) return desired;
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (baseWidth * baseHeight));
  const bySide = MAX_CANVAS_SIDE / Math.max(baseWidth, baseHeight);
  return Math.min(desired, byArea, bySide);
}
