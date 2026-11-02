// Draws one pdf.js page into a canvas. Shared by the scroll view and the sidebar thumbnails.
import type { PDFPageProxy } from 'pdfjs-dist';
import { cappedRenderScale } from './viewMode';

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
 * Draw `page` into `target` at `cssWidth` CSS pixels wide (× `dpr` device pixels). Renders
 * off-screen and copies on completion, so a re-render after a zoom never blanks the visible canvas.
 * The scale is capped to stay within browser canvas limits; CSS stretches the result past that.
 */
export function renderPageToCanvas(page: PDFPageProxy, target: HTMLCanvasElement, cssWidth: number, dpr: number): PageRenderJob {
  const base = page.getViewport({ scale: 1 });
  const scale = cappedRenderScale(base.width, base.height, (cssWidth * dpr) / base.width);
  const viewport = page.getViewport({ scale });
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.floor(viewport.width));
  off.height = Math.max(1, Math.floor(viewport.height));
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

/** Free a canvas's pixel buffer. A 0×0 canvas holds nothing, which matters on iOS. */
export function releaseCanvas(c: HTMLCanvasElement | null): void {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}
