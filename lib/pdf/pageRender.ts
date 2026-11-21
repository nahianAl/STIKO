// Draws one pdf.js page into a canvas. Shared by the scroll view, the sidebar thumbnails and the
// single-page detail render.
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { cappedRenderScale } from './viewMode';
import { detailRenderParams, type Rect } from './detailTile';

export interface PageRenderJob {
  promise: Promise<void>;
  cancel: () => void;
}

/** pdf.js rejects a cancelled render with this; it is expected, not an error. Matched by name so this
 * module never imports pdf.js at runtime. */
export function isRenderCancelled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'RenderingCancelledException';
}

/**
 * Render `viewport` off-screen at width×height and copy into `target` on completion, so a
 * re-render never blanks the visible canvas.
 */
function drawOffscreen(page: PDFPageProxy, viewport: PageViewport, width: number, height: number, target: HTMLCanvasElement): PageRenderJob {
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.floor(width));
  off.height = Math.max(1, Math.floor(height));
  const ctx = off.getContext('2d');
  if (!ctx) return { promise: Promise.reject(new Error('2D canvas unavailable')), cancel: () => {} };

  const task = page.render({ canvasContext: ctx, viewport, canvas: off } as never);
  const promise = task.promise
    .then(() => {
      target.width = off.width;
      target.height = off.height;
      target.getContext('2d')?.drawImage(off, 0, 0);
    })
    .finally(() => releaseCanvas(off));
  return { promise, cancel: () => task.cancel() };
}

/**
 * Draw `page` into `target` at `cssWidth` CSS pixels wide (× `dpr` device pixels). The scale is
 * capped to stay within browser canvas limits; CSS stretches the result past that, and the detail
 * render (renderPageRegion) covers the visible part at full resolution.
 */
export function renderPageToCanvas(page: PDFPageProxy, target: HTMLCanvasElement, cssWidth: number, dpr: number): PageRenderJob {
  const base = page.getViewport({ scale: 1 });
  const scale = cappedRenderScale(base.width, base.height, (cssWidth * dpr) / base.width);
  const viewport = page.getViewport({ scale });
  return drawOffscreen(page, viewport, viewport.width, viewport.height, target);
}

/**
 * Draw only `region` of `page` — CSS px relative to the page's top-left, with the page displayed
 * `displayWidth` CSS px wide — into `target` at screen resolution. `target` ends up
 * ceil(region × dpr) device pixels (dpr lowered past the canvas pixel cap).
 */
export function renderPageRegion(page: PDFPageProxy, target: HTMLCanvasElement, region: Rect, displayWidth: number, dpr: number): PageRenderJob {
  const base = page.getViewport({ scale: 1 });
  const p = detailRenderParams(base.width, region, displayWidth, dpr);
  const viewport = page.getViewport({ scale: p.scale, offsetX: p.offsetX, offsetY: p.offsetY });
  return drawOffscreen(page, viewport, p.canvasWidth, p.canvasHeight, target);
}

/** Free a canvas's pixel buffer. A 0×0 canvas holds nothing, which matters on iOS. */
export function releaseCanvas(c: HTMLCanvasElement | null): void {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}
