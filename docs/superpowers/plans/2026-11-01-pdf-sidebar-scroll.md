# PDF Sidebar + Scroll Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Stiko's PDF viewer a page sidebar. Sidebar open = all pages in one vertical scroll; sidebar closed = one page with medium prev/next arrows on the sides.

**Architecture:** `components/viewers/PDFKonvaViewer.tsx` stays the only entry point, with the same props and the same handle. It gains a mode (`'scroll' | 'single'`) derived from three inputs: the sidebar, the page count and the `annotating` prop.
- **Single-page mode** is today's Konva stage, with floating side arrows added.
- **Scroll mode** is a new DOM view, `PdfScrollView`: a natively scrolling column of lazily drawn page canvases, with the existing DOM `CommentPin`s on top. Next to it sits `PdfSidebar`, the thumbnail list.
- All the maths lives in a pure `lib/pdf/viewMode.ts` that `node --test` covers.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind, react-konva, pdf.js 5.4 (via `react-pdf` 10 / hoisted `pdfjs-dist`), `node --test` (Node 25, native TS type stripping).

**Spec:** `docs/superpowers/specs/2026-11-01-pdf-sidebar-scroll-design.md`

## Global Constraints

- Branch: `feature/pdf-sidebar-scroll`, already created off `main` (7570c14). Never commit to `main`; the user merges and pushes `main` themselves.
- **Never `git add -A` or `git add .`.** The repo has long-lived untracked dirs (`design_handoff_*`, `stiko_handoff/`, `logo/`). Always `git add <explicit paths>`.
- The test harness route `app/portal/harness-pdf/` and the files in `public/uploads/harness-*.pdf` are **never committed**. Task 7 deletes them.
- `ViewerContainer.tsx` and `app/portal/[id]/page.tsx` must **not** change.
- Tested lib modules (`lib/pdf/viewMode.ts`) may not import anything (no `@/` alias, no React, no DOM types at runtime). They are loaded raw by `node --test`.
- The localStorage key is exactly `stiko.pdfViewer.mode` with values `"scroll" | "single"`. Every storage access is wrapped in try/catch.
- Zoom units match in both modes: scale 1 (100%) = page pixels at `PDF_RENDER_SCALE` (2× PDF points) shown 1:1. Zoom is clamped to [0.25, 5], the same as the existing `adjustZoom`.
- Accent colour for the active thumbnail is `#5B60FF`, the same as the active `CommentPin` ring.
- UI copy: "Show pages" / "Hide pages", "Previous page" / "Next page", "Couldn't render page N", "Finish markup to show pages".
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## File Map

| File | Status | Responsibility |
|---|---|---|
| `lib/pdf/viewMode.ts` | create | Pure logic: remembered mode, effective mode, zoom clamp, page layout, fit-width, current page, render window, zoom anchoring, reveal-scroll, canvas size cap |
| `scripts/tests/pdfViewMode.test.mjs` | create | Unit tests for every export above |
| `lib/pdf/pageRender.ts` | create | Draw one pdf.js page into a canvas (off-screen, then copy), with cancel; release a canvas |
| `components/viewers/pdf/usePageSizes.ts` | create | Hook: every page's size in page pixels, loaded once per document |
| `components/viewers/pdf/PageArrows.tsx` | create | The two floating prev/next buttons |
| `components/viewers/pdf/PdfScrollView.tsx` | create | Scroll mode: stacked lazily drawn pages, pins, pin-drop, ctrl/pinch zoom, current-page reporting |
| `components/viewers/pdf/PdfSidebar.tsx` | create | Thumbnail list, current highlight, reveal, phone-width drawer |
| `components/viewers/PDFKonvaViewer.tsx` | modify | Header, arrows, keyboard, mode state, wiring, insert-image guard |

---

### Task 1: Pure view-mode logic

**Files:**
- Create: `lib/pdf/viewMode.ts`
- Test: `scripts/tests/pdfViewMode.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks import exactly these names from `@/lib/pdf/viewMode`):
  - `type PdfViewMode = 'scroll' | 'single'`
  - `MODE_STORAGE_KEY`, `MIN_ZOOM`, `MAX_ZOOM`, `MAX_CANVAS_PIXELS`, `MAX_CANVAS_SIDE`
  - `interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }`
  - `browserStorage(): StorageLike | null`
  - `readStoredMode(storage: StorageLike | null): PdfViewMode`
  - `writeStoredMode(storage: StorageLike | null, mode: PdfViewMode): void`
  - `effectiveMode(a: { sidebarOpen: boolean; numPages: number; annotating: boolean }): PdfViewMode`
  - `clampZoom(scale: number): number`
  - `interface PageSize { width: number; height: number }`
  - `interface LaidOutPage { page: number; top: number; bottom: number; width: number; height: number }`
  - `interface PageLayout { pages: LaidOutPage[]; contentWidth: number; contentHeight: number }`
  - `layoutPages(sizes: PageSize[], scale: number, gap: number, padding: number): PageLayout`
  - `fitWidthScale(sizes: PageSize[], viewportWidth: number, padding: number): number`
  - `mostVisiblePage(pages: LaidOutPage[], viewTop: number, viewBottom: number, scrolledToEnd: boolean): number`
  - `pagesToRender(pages: LaidOutPage[], viewTop: number, viewBottom: number, overscan: number): Set<number>`
  - `scrollTopForPage(layout: PageLayout, page: number, gap: number): number`
  - `anchoredScroll(a: { before: PageLayout; after: PageLayout; ratio: number; scrollLeft: number; scrollTop: number; pointerX: number; pointerY: number; viewportWidth: number }): { scrollLeft: number; scrollTop: number }`
  - `scrollTopToReveal(itemTop: number, itemBottom: number, viewTop: number, viewHeight: number): number | null`
  - `cappedRenderScale(baseWidth: number, baseHeight: number, desired: number): number`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/pdfViewMode.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE_STORAGE_KEY,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  browserStorage,
  readStoredMode,
  writeStoredMode,
  effectiveMode,
  clampZoom,
  layoutPages,
  fitWidthScale,
  mostVisiblePage,
  pagesToRender,
  scrollTopForPage,
  anchoredScroll,
  scrollTopToReveal,
  cappedRenderScale,
} from '../../lib/pdf/viewMode.ts';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v) };
};
// What Safari private mode / blocked site data looks like: every call throws.
const throwing = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

// Three 100×100 pages, 10px gap, no padding: tops 0 / 110 / 220, bottoms 100 / 210 / 320.
const square = { width: 100, height: 100 };
const three = layoutPages([square, square, square], 1, 10, 0);

test('readStoredMode is "scroll" only for exactly "scroll"', () => {
  assert.equal(readStoredMode(memStorage({ [MODE_STORAGE_KEY]: 'scroll' })), 'scroll');
  assert.equal(readStoredMode(memStorage({ [MODE_STORAGE_KEY]: 'single' })), 'single');
  assert.equal(readStoredMode(memStorage({ [MODE_STORAGE_KEY]: 'SCROLL' })), 'single');
  assert.equal(readStoredMode(memStorage()), 'single');
  assert.equal(readStoredMode(null), 'single');
  assert.equal(readStoredMode(throwing), 'single');
});

test('writeStoredMode round-trips and never throws', () => {
  const s = memStorage();
  writeStoredMode(s, 'scroll');
  assert.equal(readStoredMode(s), 'scroll');
  writeStoredMode(s, 'single');
  assert.equal(readStoredMode(s), 'single');
  assert.doesNotThrow(() => writeStoredMode(throwing, 'scroll'));
  assert.doesNotThrow(() => writeStoredMode(null, 'scroll'));
});

test('browserStorage is null outside a browser', () => {
  assert.equal(browserStorage(), null);
});

test('effectiveMode: the sidebar decides; 1 page and a session force single; 0 (loading) does not', () => {
  assert.equal(effectiveMode({ sidebarOpen: true, numPages: 12, annotating: false }), 'scroll');
  assert.equal(effectiveMode({ sidebarOpen: false, numPages: 12, annotating: false }), 'single');
  assert.equal(effectiveMode({ sidebarOpen: true, numPages: 1, annotating: false }), 'single');
  assert.equal(effectiveMode({ sidebarOpen: true, numPages: 12, annotating: true }), 'single');
  assert.equal(effectiveMode({ sidebarOpen: true, numPages: 0, annotating: false }), 'scroll');
});

test('clampZoom keeps zoom within [0.25, 5]', () => {
  assert.equal(clampZoom(0.1), 0.25);
  assert.equal(clampZoom(9), 5);
  assert.equal(clampZoom(1.5), 1.5);
});

test('layoutPages stacks scaled pages with a fixed gap and padding', () => {
  const L = layoutPages([{ width: 100, height: 200 }, { width: 300, height: 100 }], 2, 16, 24);
  assert.deepEqual(L.pages, [
    { page: 1, top: 24, bottom: 424, width: 200, height: 400 },
    { page: 2, top: 440, bottom: 640, width: 600, height: 200 },
  ]);
  assert.equal(L.contentHeight, 664);
  assert.equal(L.contentWidth, 648);
  assert.deepEqual(layoutPages([], 1, 16, 24), { pages: [], contentWidth: 48, contentHeight: 0 });
});

test('fitWidthScale fits the widest page inside the padding, clamped', () => {
  assert.equal(fitWidthScale([{ width: 100, height: 1 }, { width: 400, height: 1 }], 848, 24), 2);
  assert.equal(fitWidthScale([], 800, 24), 1);
  assert.equal(fitWidthScale([{ width: 100, height: 1 }], 0, 24), 1);
  assert.equal(fitWidthScale([{ width: 10, height: 1 }], 10048, 24), 5);
});

test('mostVisiblePage picks the page covering most of the viewport', () => {
  assert.equal(mostVisiblePage(three.pages, 0, 100, false), 1);
  assert.equal(mostVisiblePage(three.pages, 60, 160, false), 2);
  // Tie (50px each) goes to the lower page number.
  assert.equal(mostVisiblePage(three.pages, 50, 160, false), 1);
  // Viewport entirely inside a gap: the nearest page.
  assert.equal(mostVisiblePage(three.pages, 102, 109, false), 2);
  // Scrolled to the very end: the last page, even if it is not the biggest slice.
  assert.equal(mostVisiblePage(three.pages, 150, 320, true), 3);
  assert.equal(mostVisiblePage([], 0, 100, false), 1);
});

test('pagesToRender returns pages within the viewport plus overscan', () => {
  assert.deepEqual([...pagesToRender(three.pages, 115, 205, 0)], [2]);
  assert.deepEqual([...pagesToRender(three.pages, 115, 205, 20)], [1, 2, 3]);
});

test('scrollTopForPage puts the page top one gap below the top edge', () => {
  assert.equal(scrollTopForPage(three, 1, 10), 0);
  assert.equal(scrollTopForPage(three, 3, 10), 210);
  assert.equal(scrollTopForPage(three, 9, 10), 0);
});

test('anchoredScroll keeps the point under the pointer fixed across a zoom', () => {
  // Pointer at (175, 50) over scrollTop 140: content y 190 = 80px into page 2; content x 175 =
  // 75% across page 1's 100px box, which is centred in a 300px column (100..200).
  const base = { before: three, scrollLeft: 0, scrollTop: 140, pointerX: 175, pointerY: 50, viewportWidth: 300 };

  const x2 = layoutPages([square, square, square], 2, 10, 0); // tops 0/210/420, width 200
  assert.deepEqual(anchoredScroll({ ...base, after: x2, ratio: 2 }), { scrollLeft: 25, scrollTop: 320 });
  // Check: page 2 top 210 + 80×2 = 370 = 320 + 50. Page box 50..250, 75% = 200 = 25 + 175.

  const x4 = layoutPages([square, square, square], 4, 10, 0); // tops 0/410/820, width 400 > viewport
  assert.deepEqual(anchoredScroll({ ...base, after: x4, ratio: 4 }), { scrollLeft: 125, scrollTop: 680 });
  // Check: 410 + 80×4 = 730 = 680 + 50. Column is now 400 wide, page box 0..400, 75% = 300 = 125 + 175.

  // Never negative.
  const out = anchoredScroll({ ...base, scrollTop: 0, pointerY: 0, pointerX: 0, after: layoutPages([square], 0.5, 10, 0), before: layoutPages([square], 1, 10, 0), ratio: 0.5 });
  assert.ok(out.scrollLeft >= 0 && out.scrollTop >= 0);
});

test('scrollTopToReveal scrolls only when the item is out of view', () => {
  assert.equal(scrollTopToReveal(50, 90, 0, 100), null);
  assert.equal(scrollTopToReveal(120, 160, 0, 100), 60);
  assert.equal(scrollTopToReveal(10, 40, 20, 100), 10);
});

test('cappedRenderScale stays under the canvas area and side limits', () => {
  assert.equal(cappedRenderScale(1000, 1000, 2), 2);
  const s = cappedRenderScale(4000, 3000, 5);
  assert.ok(Math.abs(s - Math.sqrt(MAX_CANVAS_PIXELS / 12_000_000)) < 1e-9);
  assert.ok(4000 * 3000 * s * s <= MAX_CANVAS_PIXELS + 1);
  assert.equal(cappedRenderScale(20000, 10, 5), MAX_CANVAS_SIDE / 20000);
  assert.equal(cappedRenderScale(0, 10, 3), 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/pdfViewMode.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/pdf/viewMode.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/pdf/viewMode.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/pdfViewMode.test.mjs`
Expected: PASS, 13 tests, 0 failures.

Then run the whole suite to confirm nothing else broke: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/viewMode.ts scripts/tests/pdfViewMode.test.mjs
git commit -m "feat(pdf): pure layout and mode logic for the PDF sidebar + scroll mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Page rendering helpers

**Files:**
- Create: `lib/pdf/pageRender.ts`
- Create: `components/viewers/pdf/usePageSizes.ts`

**Interfaces:**
- Consumes: `cappedRenderScale`, `PageSize` from Task 1.
- Produces:
  - `interface PageRenderJob { promise: Promise<void>; cancel: () => void }`
  - `renderPageToCanvas(page: PDFPageProxy, target: HTMLCanvasElement, cssWidth: number, dpr: number): PageRenderJob`
  - `isRenderCancelled(err: unknown): boolean`
  - `releaseCanvas(c: HTMLCanvasElement | null): void`
  - `usePageSizes(pdfDoc: PDFDocumentProxy | null): PageSize[] | null`

These are DOM/pdf.js glue with no logic worth a unit test. The type-check is the gate here; browser behaviour is checked in Task 6.

- [ ] **Step 1: Create `lib/pdf/pageRender.ts`**

```ts
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
```

- [ ] **Step 2: Create `components/viewers/pdf/usePageSizes.ts`**

```ts
'use client';

import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_RENDER_SCALE } from '@/lib/measure/space';
import type { PageSize } from '@/lib/pdf/viewMode';

// US Letter in page pixels: the stand-in for a page whose size could not be read. Its render fails
// too and shows the per-page error box, so the exact size hardly matters.
const FALLBACK: PageSize = { width: 612 * PDF_RENDER_SCALE, height: 792 * PDF_RENDER_SCALE };

/**
 * Every page's size in page pixels (PDF points × PDF_RENDER_SCALE, the single-page stage's units),
 * or null while loading. Read once per document so the scroll column and the sidebar can lay out
 * correctly sized placeholders before anything is drawn.
 */
export function usePageSizes(pdfDoc: PDFDocumentProxy | null): PageSize[] | null {
  const [sizes, setSizes] = useState<PageSize[] | null>(null);

  useEffect(() => {
    setSizes(null);
    if (!pdfDoc) return;
    let cancelled = false;
    const numbers = Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);
    Promise.allSettled(
      numbers.map(async (n) => {
        const vp = (await pdfDoc.getPage(n)).getViewport({ scale: PDF_RENDER_SCALE });
        return { width: vp.width, height: vp.height };
      }),
    ).then((results) => {
      if (cancelled) return;
      setSizes(
        results.map((r, i) => {
          if (r.status === 'fulfilled') return r.value;
          console.error(`Failed to read the size of PDF page ${i + 1}:`, r.reason);
          return FALLBACK;
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  return sizes;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

`PDFKonvaViewer` holds its document as `pdfjs.PDFDocumentProxy` from `react-pdf`. That `pdfjs` *is* `pdfjs-dist` (`node_modules/react-pdf/dist/index.d.ts` line 1: `import * as pdfjs from 'pdfjs-dist'`, hoisted), so the two types are identical.

- [ ] **Step 4: Commit**

```bash
git add lib/pdf/pageRender.ts components/viewers/pdf/usePageSizes.ts
git commit -m "feat(pdf): page render and page-size helpers for the scroll view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Single-page mode — side arrows, keyboard, header counter

Ships on its own: today's viewer, with the small header arrows replaced by floating side arrows and ←/→.

**Files:**
- Create: `components/viewers/pdf/PageArrows.tsx`
- Modify: `components/viewers/PDFKonvaViewer.tsx` (header "Page navigation" block, around lines 644–667; just after `const pageNavLocked = …`, around line 634; before `{editingObj && (`, around line 856)
- Harness (never committed): `app/portal/harness-pdf/page.tsx`, `public/uploads/harness-multipage.pdf`, `public/uploads/harness-onepage.pdf`, plus a generator script in the session scratchpad

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `PageArrows` default export, props `{ canPrev: boolean; canNext: boolean; disabled: boolean; onPrev: () => void; onNext: () => void }`
  - In `PDFKonvaViewer`: `goPrev`, `goNext` callbacks and the keyboard effect. Task 6 adds a `mode` guard to that effect.

- [ ] **Step 1: Create `components/viewers/pdf/PageArrows.tsx`**

```tsx
'use client';

interface PageArrowsProps {
  canPrev: boolean;
  canNext: boolean;
  /** Page navigation is locked (a markup session with objects in it). */
  disabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}

// Positioned on the VIEWPORT's edges, not the page's, so zooming and panning never move them.
const BUTTON =
  'absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-gray-700 shadow-md ring-1 ring-black/5 transition hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40';

export default function PageArrows({ canPrev, canNext, disabled, onPrev, onNext }: PageArrowsProps) {
  return (
    <>
      {canPrev && (
        <button type="button" aria-label="Previous page" title="Previous page" onClick={onPrev} disabled={disabled} className={`${BUTTON} left-3`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {canNext && (
        <button type="button" aria-label="Next page" title="Next page" onClick={onNext} disabled={disabled} className={`${BUTTON} right-3`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </>
  );
}
```

- [ ] **Step 2: Replace the header's page-navigation block with a counter**

In `components/viewers/PDFKonvaViewer.tsx`, replace this whole block:

```tsx
          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || pageNavLocked}
              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {currentPage} / {numPages || '...'}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages || pageNavLocked}
              className="rounded px-2 py-0.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
```

with:

```tsx
          {/* Page counter. Pages turn with the side arrows / ←→ (single-page) or by scrolling (scroll mode). */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {currentPage} / {numPages || '...'}
            </span>
          </div>
```

- [ ] **Step 3: Add `goPrev` / `goNext` and the keyboard handler**

Insert directly after the line `const pageNavLocked = annotating && !(isMeasureTool(activeTool) && !ann.hasObjects());`:

```tsx

    const goPrev = useCallback(() => setCurrentPage((p) => Math.max(1, p - 1)), []);
    const goNext = useCallback(() => setCurrentPage((p) => Math.min(numPages, p + 1)), [numPages]);

    // ←/→ turn pages, under the same lock as the arrows. Skipped while typing, with a modifier held,
    // and when a handler nearer the target already used the key (the colour picker uses arrows;
    // React's root listener runs before this window listener, so its preventDefault is visible).
    useEffect(() => {
      if (numPages <= 1) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
        if (pageNavLocked) return;
        e.preventDefault();
        if (e.key === 'ArrowLeft') goPrev();
        else goNext();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [numPages, pageNavLocked, goPrev, goNext]);
```

- [ ] **Step 4: Render the arrows inside the canvas container**

Add the import next to the other imports at the top of the file:

```tsx
import PageArrows from './pdf/PageArrows';
```

Then insert directly before the line `          {editingObj && (`:

```tsx
          {numPages > 1 && (
            <PageArrows
              canPrev={currentPage > 1}
              canNext={currentPage < numPages}
              disabled={pageNavLocked}
              onPrev={goPrev}
              onNext={goNext}
            />
          )}

```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc exit 0. Lint shows no new warnings or errors in `PDFKonvaViewer.tsx` or `pdf/PageArrows.tsx`.

- [ ] **Step 6: Build the local harness (never committed)**

Write a test-PDF generator in the session scratchpad (not the repo) as `make-test-pdf.mjs`:

```js
// node make-test-pdf.mjs <out.pdf> <pageCount>
// Page 3 is tabloid landscape, page 5 A4 landscape and the rest US Letter, so mixed sizes get exercised.
import { writeFileSync } from 'node:fs';
const [out, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 40);
const sizeFor = (n) => (n === 3 ? [1224, 792] : n === 5 ? [842, 595] : [612, 792]);
const objs = [];
objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
const kids = [];
for (let n = 1; n <= count; n++) {
  const [w, h] = sizeFor(n);
  const pageId = 2 + n * 2;
  const contentId = pageId + 1;
  const text = `0 0 1 RG 4 w 20 20 ${w - 40} ${h - 40} re S BT /F1 72 Tf ${w / 2 - 130} ${h / 2} Td (Page ${n}) Tj ET`;
  objs[contentId] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
  kids.push(`${pageId} 0 R`);
}
objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`;
let pdf = '%PDF-1.4\n';
const offsets = [];
for (let i = 1; i < objs.length; i++) {
  offsets[i] = pdf.length;
  pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
}
const xref = pdf.length;
pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
for (let i = 1; i < objs.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(out, pdf, 'latin1');
```

Run it twice, from the repo root, using the scratchpad path for the script:

```bash
node <scratchpad>/make-test-pdf.mjs public/uploads/harness-multipage.pdf 40
node <scratchpad>/make-test-pdf.mjs public/uploads/harness-onepage.pdf 1
```

`public/uploads/` is exempt from the auth middleware. Create `app/portal/harness-pdf/page.tsx`. The folder must **not** start with `_`, and it must sit under `/portal/` so the middleware lets it through.

```tsx
'use client';

// LOCAL TEST HARNESS — never commit. Deleted in Task 7.
import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import type { Comment } from '@/lib/types';
import type { ToolType } from '@/components/markup/useAnnotationObjects';

const PDFKonvaViewer = dynamic(() => import('@/components/viewers/PDFKonvaViewer'), { ssr: false });

const pin = (id: string, page: number, x: number, y: number) =>
  ({ id, author: `user-${id}`, pageNumber: page, xPosition: x, yPosition: y, worldX: null, worldY: null, worldZ: null }) as unknown as Comment;

export default function HarnessPdf() {
  const file = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('f') ?? 'harness-multipage.pdf' : 'harness-multipage.pdf';
  const [tagging, setTagging] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [tool, setTool] = useState<ToolType>('pointer');
  const [comments, setComments] = useState<Comment[]>([pin('a', 1, 20, 20), pin('b', 3, 50, 50)]);
  const [log, setLog] = useState<string[]>([]);
  const push = useCallback((s: string) => setLog((l) => [s, ...l].slice(0, 12)), []);
  const onPlace = useCallback((x: number, y: number, page: number) => {
    setComments((cs) => [...cs, pin(`n${cs.length}`, page, x, y)]);
    setTagging(false);
    push(`placed p${page} ${x.toFixed(1)},${y.toFixed(1)}`);
  }, [push]);
  const onPin = useCallback((c: Comment) => push(`pin ${c.id}`), [push]);
  const onPage = useCallback((p: number) => push(`page ${p}`), [push]);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex gap-2 border-b p-2 text-sm" data-testid="harness-bar">
        <button className="rounded border px-2" onClick={() => setTagging((t) => !t)}>tagging: {String(tagging)}</button>
        <button className="rounded border px-2" onClick={() => { setAnnotating((a) => !a); setTool((t) => (t === 'pointer' ? 'freehand' : 'pointer')); }}>annotating: {String(annotating)}</button>
        <span data-testid="harness-log">{log.join(' | ')}</span>
      </div>
      <div className="min-h-0 flex-1">
        <PDFKonvaViewer
          url={`/uploads/${file}`}
          fileId="harness"
          activeTool={tool}
          color="#FF6B6B"
          strokeWidth={3}
          tagging={tagging}
          annotating={annotating}
          comments={comments}
          activeCommentId={null}
          onCommentPinClick={onPin}
          onCommentPlace={onPlace}
          onPageChange={onPage}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify single-page mode in a browser**

Start the dev server: `npm run dev`. The checkout has a real `.env.local`, and Next loads it itself. Open `http://localhost:3000/portal/harness-pdf`. If the first load shows a skeleton forever, navigate again: the bundle was still compiling.

Check, and record what you saw:
1. The header shows `1 / 40` and **no** small header arrows. The zoom controls are unchanged.
2. There is **no** "Previous page" button on page 1, and there is a round "Next page" button on the right edge, vertically centred.
3. Clicking Next goes to page 2, and both arrows show. The harness log shows `page 2`.
4. Pressing `→` three times reaches page 5 (A4 landscape); `←` goes back. Pressing `→` while the focus is in a text input does nothing. Test this by running `document.body.appendChild(document.createElement('input')).focus()` in the console, then pressing `→`.
5. Zoom in with the wheel and pan: the arrows stay fixed on the viewport edges.
6. Click "annotating", draw one stroke on the page: both arrows go disabled (40% opacity), and `→` does nothing. Click "annotating" again to end the session.
7. `?f=harness-onepage.pdf`: there are no arrows, and the counter reads `1 / 1`.

- [ ] **Step 8: Commit (explicit paths only — the harness stays untracked)**

```bash
git add components/viewers/pdf/PageArrows.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(pdf): floating side arrows and arrow keys replace the header page buttons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scroll view component

**Files:**
- Create: `components/viewers/pdf/PdfScrollView.tsx`

**Interfaces:**
- Consumes:
  - From Task 1: `anchoredScroll`, `clampZoom`, `fitWidthScale`, `layoutPages`, `mostVisiblePage`, `pagesToRender`, `scrollTopForPage`, `PageSize`.
  - From Task 2: `renderPageToCanvas`, `isRenderCancelled`, `releaseCanvas`, `PageRenderJob`.
  - Existing: `CommentPin` (`components/markup/CommentPin.tsx`), `paletteForComment` (`lib/commentColors.ts`, which returns `{ swatch, dark, accent, … }`), `buildTagNumbers` (`lib/tagNumbers.ts`).
- Produces:
  - default export `PdfScrollView`
  - `interface PdfScrollViewHandle { scrollToPage(page: number, behavior?: ScrollBehavior): void; zoomStep(delta: number): void; fitWidth(): void }`
  - Props: `{ pdfDoc; pageSizes: PageSize[]; initialPage: number; comments: Comment[]; activeCommentId: string | null; pendingCommentId?: string | null; onCommentPinClick(c: Comment): void; tagging: boolean; onCommentPlace(x: number, y: number, page: number): void; onCurrentPageChange(page: number): void; onScaleChange(scale: number): void; onFirstPageDrawn(): void; handleRef?: Ref<PdfScrollViewHandle> }`

Behaviour notes for the implementer:
- `scaleRef` holds the latest *requested* zoom, which runs ahead of React state between renders. Successive ctrl-wheel events in one frame therefore compound instead of each starting from a stale value. `pendingScrollRef` holds where to scroll once the new layout is in the DOM, and is applied in a layout effect.
- `ready` flips true only after the first scroll-to-`initialPage`. Until then nothing reports a current page, so the counter never flashes `1`.
- `initialPage` is read once, at mount. The parent passes its live `currentPage`, which this view itself updates.

- [ ] **Step 1: Create `components/viewers/pdf/PdfScrollView.tsx`**

```tsx
'use client';

import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Comment } from '@/lib/types';
import CommentPin from '@/components/markup/CommentPin';
import { paletteForComment } from '@/lib/commentColors';
import { buildTagNumbers } from '@/lib/tagNumbers';
import {
  anchoredScroll,
  clampZoom,
  fitWidthScale,
  layoutPages,
  mostVisiblePage,
  pagesToRender,
  scrollTopForPage,
  type PageSize,
} from '@/lib/pdf/viewMode';
import { isRenderCancelled, releaseCanvas, renderPageToCanvas, type PageRenderJob } from '@/lib/pdf/pageRender';

const GAP = 16; // CSS px between pages
const PADDING = 24; // CSS px around the column
const SETTLE_MS = 150; // redraw sharp this long after the last zoom change
const NO_COMMENTS: Comment[] = [];

export interface PdfScrollViewHandle {
  scrollToPage: (page: number, behavior?: ScrollBehavior) => void;
  /** Add `delta` to the zoom (the single-page buttons' additive step), anchored on the viewport centre. */
  zoomStep: (delta: number) => void;
  fitWidth: () => void;
}

interface PdfScrollViewProps {
  pdfDoc: PDFDocumentProxy;
  pageSizes: PageSize[];
  /** Read once at mount. */
  initialPage: number;
  comments: Comment[];
  activeCommentId: string | null;
  pendingCommentId?: string | null;
  onCommentPinClick: (comment: Comment) => void;
  tagging: boolean;
  onCommentPlace: (x: number, y: number, pageNumber: number) => void;
  onCurrentPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  /** Once, when the first page has been drawn (drives the viewer's onReady). */
  onFirstPageDrawn: () => void;
  handleRef?: Ref<PdfScrollViewHandle>;
}

export default function PdfScrollView({
  pdfDoc, pageSizes, initialPage, comments, activeCommentId, pendingCommentId, onCommentPinClick, tagging,
  onCommentPlace, onCurrentPageChange, onScaleChange, onFirstPageDrawn, handleRef,
}: PdfScrollViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [scale, setScale] = useState<number | null>(null);
  const [renderScale, setRenderScale] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const scaleRef = useRef<number | null>(null);
  const fitModeRef = useRef(true);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const initialPageRef = useRef(initialPage);

  // Parent callbacks through refs, so memoised pages never re-render for a new function identity.
  const cbs = useRef({ onCommentPinClick, onCommentPlace, onCurrentPageChange, onScaleChange, onFirstPageDrawn });
  cbs.current = { onCommentPinClick, onCommentPlace, onCurrentPageChange, onScaleChange, onFirstPageDrawn };
  const handlePinClick = useCallback((c: Comment) => cbs.current.onCommentPinClick(c), []);
  const handlePlace = useCallback((x: number, y: number, p: number) => cbs.current.onCommentPlace(x, y, p), []);
  const firstDrawnRef = useRef(false);
  const handleDrawn = useCallback(() => {
    if (firstDrawnRef.current) return;
    firstDrawnRef.current = true;
    cbs.current.onFirstPageDrawn();
  }, []);

  // Viewport size. clientWidth excludes the scrollbar, which is what fit-width must fill.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Change the zoom, keeping the content under (anchorX, anchorY) — viewport coords — in place. */
  const applyScale = useCallback((next: number, anchorX: number, anchorY: number) => {
    const el = scrollRef.current;
    const clamped = clampZoom(next);
    const prev = scaleRef.current;
    scaleRef.current = clamped;
    if (prev === null || !el) {
      setScale(clamped);
      return;
    }
    if (clamped === prev) return;
    const from = pendingScrollRef.current ?? { left: el.scrollLeft, top: el.scrollTop };
    const s = anchoredScroll({
      before: layoutPages(pageSizes, prev, GAP, PADDING),
      after: layoutPages(pageSizes, clamped, GAP, PADDING),
      ratio: clamped / prev,
      scrollLeft: from.left,
      scrollTop: from.top,
      pointerX: anchorX,
      pointerY: anchorY,
      viewportWidth: el.clientWidth,
    });
    pendingScrollRef.current = { left: s.scrollLeft, top: s.scrollTop };
    setScale(clamped);
  }, [pageSizes]);

  // Fit-width on first measure, and again on resize until the user zooms by hand.
  useEffect(() => {
    if (!viewport.width || !fitModeRef.current) return;
    applyScale(fitWidthScale(pageSizes, viewport.width, PADDING), 0, 0);
  }, [viewport.width, pageSizes, applyScale]);

  // Ctrl/⌘ + wheel, and trackpad pinch (which browsers send as ctrl+wheel), zoom on the cursor.
  // Native listener because React's onWheel is passive and cannot preventDefault the page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const current = scaleRef.current;
      if (current === null) return;
      const rect = el.getBoundingClientRect();
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.01)));
      fitModeRef.current = false;
      applyScale(current * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyScale]);

  // Report the zoom for the header's percentage.
  useEffect(() => {
    if (scale !== null) cbs.current.onScaleChange(scale);
  }, [scale]);

  // Pages are drawn at `renderScale`: the zoom, settled. In between, CSS stretches the old bitmap.
  useEffect(() => {
    if (scale === null) return;
    setRenderScale((prev) => (prev === null ? scale : prev));
    const t = setTimeout(() => setRenderScale(scale), SETTLE_MS);
    return () => clearTimeout(t);
  }, [scale]);

  const layout = useMemo(() => (scale === null ? null : layoutPages(pageSizes, scale, GAP, PADDING)), [pageSizes, scale]);

  // After a layout change: the first time, jump to the initial page; afterwards apply a pending
  // zoom-anchored scroll. Layout effect, so it lands before paint and the page never jumps visibly.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !layout) return;
    if (!ready) {
      el.scrollTop = scrollTopForPage(layout, initialPageRef.current, GAP);
      setScrollTop(el.scrollTop);
      setReady(true);
      return;
    }
    const p = pendingScrollRef.current;
    if (!p) return;
    pendingScrollRef.current = null;
    el.scrollLeft = p.left;
    el.scrollTop = p.top;
    setScrollTop(el.scrollTop);
  }, [layout, ready]);

  // Scroll position, at most once per frame.
  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const currentPage = useMemo(() => {
    if (!layout || !ready || !viewport.height) return null;
    const end = scrollTop > 0 && scrollTop + viewport.height >= layout.contentHeight - 2;
    return mostVisiblePage(layout.pages, scrollTop, scrollTop + viewport.height, end);
  }, [layout, ready, scrollTop, viewport.height]);

  useEffect(() => {
    if (currentPage !== null) cbs.current.onCurrentPageChange(currentPage);
  }, [currentPage]);

  // Draw only pages within about two screens; the rest release their pixels.
  const renderSet = useMemo(
    () => (layout && ready ? pagesToRender(layout.pages, scrollTop, scrollTop + viewport.height, viewport.height * 2) : new Set<number>()),
    [layout, ready, scrollTop, viewport.height],
  );

  const commentsByPage = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of comments) {
      if (c.pageNumber === null || c.xPosition === null || c.yPosition === null) continue;
      const list = m.get(c.pageNumber);
      if (list) list.push(c);
      else m.set(c.pageNumber, [c]);
    }
    return m;
  }, [comments]);
  const tagNumbers = useMemo(() => buildTagNumbers(comments), [comments]);

  useImperativeHandle(handleRef, () => ({
    scrollToPage: (page, behavior = 'smooth') => {
      const el = scrollRef.current;
      const s = scaleRef.current;
      if (!el || s === null) return;
      el.scrollTo({ top: scrollTopForPage(layoutPages(pageSizes, s, GAP, PADDING), page, GAP), behavior });
    },
    zoomStep: (delta) => {
      const el = scrollRef.current;
      const s = scaleRef.current;
      if (!el || s === null) return;
      fitModeRef.current = false;
      applyScale(s + delta, el.clientWidth / 2, el.clientHeight / 2);
    },
    fitWidth: () => {
      const el = scrollRef.current;
      if (!el) return;
      fitModeRef.current = true;
      applyScale(fitWidthScale(pageSizes, el.clientWidth, PADDING), el.clientWidth / 2, el.clientHeight / 2);
    },
  }), [pageSizes, applyScale]);

  const drawScale = renderScale ?? scale ?? 1;
  const colWidth = layout ? Math.max(layout.contentWidth, viewport.width) : 0;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="relative min-w-0 flex-1 overflow-auto bg-gray-100">
      {!layout ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        </div>
      ) : (
        <div className="relative" style={{ width: colWidth, height: layout.contentHeight }}>
          {layout.pages.map((p) => (
            <ScrollPage
              key={p.page}
              pdfDoc={pdfDoc}
              page={p.page}
              top={p.top}
              left={(colWidth - p.width) / 2}
              width={p.width}
              height={p.height}
              shouldRender={renderSet.has(p.page)}
              renderWidth={pageSizes[p.page - 1].width * drawScale}
              comments={commentsByPage.get(p.page) ?? NO_COMMENTS}
              tagNumbers={tagNumbers}
              activeCommentId={activeCommentId}
              pendingCommentId={pendingCommentId ?? null}
              tagging={tagging}
              onPinClick={handlePinClick}
              onPlace={handlePlace}
              onDrawn={handleDrawn}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ScrollPageProps {
  pdfDoc: PDFDocumentProxy;
  page: number;
  top: number;
  left: number;
  width: number;
  height: number;
  shouldRender: boolean;
  /** CSS px width to draw the bitmap at (the settled zoom); `width` is the live on-screen width. */
  renderWidth: number;
  comments: Comment[];
  tagNumbers: Map<string, number>;
  activeCommentId: string | null;
  pendingCommentId: string | null;
  tagging: boolean;
  onPinClick: (c: Comment) => void;
  onPlace: (x: number, y: number, page: number) => void;
  onDrawn: () => void;
}

const ScrollPage = memo(function ScrollPage({
  pdfDoc, page, top, left, width, height, shouldRender, renderWidth, comments, tagNumbers, activeCommentId,
  pendingCommentId, tagging, onPinClick, onPlace, onDrawn,
}: ScrollPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!shouldRender) {
      releaseCanvas(canvas);
      return;
    }
    let cancelled = false;
    let job: PageRenderJob | null = null;
    pdfDoc
      .getPage(page)
      .then((pg) => {
        if (cancelled) return;
        job = renderPageToCanvas(pg, canvas, renderWidth, window.devicePixelRatio || 1);
        return job.promise.then(() => {
          if (cancelled) return;
          setFailed(false);
          onDrawn();
        });
      })
      .catch((err) => {
        if (cancelled || isRenderCancelled(err)) return;
        console.error(`Failed to render PDF page ${page}:`, err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [pdfDoc, page, shouldRender, renderWidth, onDrawn]);

  useEffect(() => {
    const c = canvasRef.current;
    return () => releaseCanvas(c);
  }, []);

  return (
    <div
      className="absolute bg-white shadow-sm ring-1 ring-black/5"
      style={{ top, left, width, height, cursor: tagging ? 'crosshair' : undefined }}
      data-page={page}
      onClick={
        tagging
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onPlace(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100, page);
            }
          : undefined
      }
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 text-sm text-gray-500">
          Couldn&apos;t render page {page}
        </div>
      )}
      {comments.map((c, idx) => {
        const pal = paletteForComment(c);
        return (
          <CommentPin
            key={c.id}
            index={tagNumbers.get(c.id) ?? idx + 1}
            x={c.xPosition!}
            y={c.yPosition!}
            isActive={activeCommentId === c.id}
            isPending={c.id === pendingCommentId}
            fill={pal.swatch}
            textColor={pal.dark}
            onClick={() => onPinClick(c)}
          />
        );
      })}
    </div>
  );
});
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc exit 0. No lint errors in `components/viewers/pdf/PdfScrollView.tsx`. If lint flags `cbs.current = …` during render, that same pattern already exists in `PDFKonvaViewer.tsx` (`onPageChangeRef.current = onPageChange`), so match how that line is handled there rather than restructuring.

- [ ] **Step 3: Commit**

```bash
git add components/viewers/pdf/PdfScrollView.tsx
git commit -m "feat(pdf): continuous scroll view with lazy pages, pins and cursor-anchored zoom

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sidebar component

**Files:**
- Create: `components/viewers/pdf/PdfSidebar.tsx`

**Interfaces:**
- Consumes: `scrollTopToReveal`, `PageSize` (Task 1); `renderPageToCanvas`, `isRenderCancelled`, `releaseCanvas`, `PageRenderJob` (Task 2).
- Produces: default export `PdfSidebar`, props `{ pdfDoc: PDFDocumentProxy; pageSizes: PageSize[]; currentPage: number; onSelectPage(page: number): void; onClose(): void }`.

- [ ] **Step 1: Create `components/viewers/pdf/PdfSidebar.tsx`**

```tsx
'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { scrollTopToReveal, type PageSize } from '@/lib/pdf/viewMode';
import { isRenderCancelled, releaseCanvas, renderPageToCanvas, type PageRenderJob } from '@/lib/pdf/pageRender';

const THUMB_WIDTH = 140; // CSS px; the sidebar is 180px wide with 20px padding each side

interface PdfSidebarProps {
  pdfDoc: PDFDocumentProxy;
  pageSizes: PageSize[];
  currentPage: number;
  onSelectPage: (page: number) => void;
  /** Phone width only: the scrim behind the drawer was tapped. */
  onClose: () => void;
}

export default function PdfSidebar({ pdfDoc, pageSizes, currentPage, onSelectPage, onClose }: PdfSidebarProps) {
  // State, not a ref: thumbnails need the element as their IntersectionObserver root.
  const [list, setList] = useState<HTMLElement | null>(null);

  // Keep the current page's thumbnail in view, but only when it has left the view, so a hand
  // scroll of the list is never fought.
  useEffect(() => {
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`);
    if (!item) return;
    const next = scrollTopToReveal(item.offsetTop - 8, item.offsetTop + item.offsetHeight + 8, list.scrollTop, list.clientHeight);
    if (next !== null) list.scrollTo({ top: next, behavior: 'smooth' });
  }, [list, currentPage]);

  return (
    <>
      {/* Phone width: the sidebar is a drawer over the page; tapping outside closes it. */}
      <div className="absolute inset-0 z-20 bg-black/30 md:hidden" onClick={onClose} aria-hidden="true" />
      <nav
        ref={setList}
        aria-label="Pages"
        className="absolute inset-y-0 left-0 z-30 w-[180px] flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white px-5 py-4 shadow-lg md:relative md:inset-auto md:z-auto md:shadow-none"
      >
        <ol className="flex flex-col gap-4">
          {pageSizes.map((size, i) => (
            <Thumbnail
              key={i + 1}
              pdfDoc={pdfDoc}
              page={i + 1}
              size={size}
              active={i + 1 === currentPage}
              root={list}
              onSelect={onSelectPage}
            />
          ))}
        </ol>
      </nav>
    </>
  );
}

interface ThumbnailProps {
  pdfDoc: PDFDocumentProxy;
  page: number;
  size: PageSize;
  active: boolean;
  root: HTMLElement | null;
  onSelect: (page: number) => void;
}

const Thumbnail = memo(function Thumbnail({ pdfDoc, page, size, active, root, onSelect }: ThumbnailProps) {
  const itemRef = useRef<HTMLLIElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  // Draw once the thumbnail comes near the visible part of the list; keep it afterwards (small).
  useEffect(() => {
    const el = itemRef.current;
    if (!el || !root || visible) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { root, rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root, visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) return;
    let cancelled = false;
    let job: PageRenderJob | null = null;
    pdfDoc
      .getPage(page)
      .then((pg) => {
        if (cancelled) return;
        job = renderPageToCanvas(pg, canvas, THUMB_WIDTH, window.devicePixelRatio || 1);
        return job.promise;
      })
      .catch((err) => {
        if (cancelled || isRenderCancelled(err)) return;
        console.error(`Failed to render the thumbnail of PDF page ${page}:`, err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [visible, pdfDoc, page]);

  useEffect(() => {
    const c = canvasRef.current;
    return () => releaseCanvas(c);
  }, []);

  const height = Math.round((THUMB_WIDTH * size.height) / size.width);

  return (
    <li ref={itemRef} data-thumb={page}>
      <button
        type="button"
        onClick={() => onSelect(page)}
        aria-label={`Page ${page}`}
        aria-current={active ? 'page' : undefined}
        className="group flex w-full flex-col items-center gap-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B60FF]"
      >
        <span
          className={`relative block overflow-hidden rounded-sm bg-white shadow-sm transition ${active ? 'ring-2 ring-[#5B60FF]' : 'ring-1 ring-black/10 group-hover:ring-gray-400'}`}
          style={{ width: THUMB_WIDTH, height }}
        >
          <canvas ref={canvasRef} className="block h-full w-full" />
          {failed && (
            <span className="absolute inset-0 flex items-center justify-center bg-gray-200 px-2 text-center text-[11px] text-gray-500">
              Couldn&apos;t render page {page}
            </span>
          )}
        </span>
        <span className={`text-xs ${active ? 'font-semibold text-[#5B60FF]' : 'text-gray-500'}`}>{page}</span>
      </button>
    </li>
  );
});
```

`li.offsetTop` is measured against the `nav`, because the `nav` is the nearest positioned ancestor (absolute on phones, relative on desktop). That is what the reveal maths needs.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc exit 0. No lint errors in `components/viewers/pdf/PdfSidebar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/viewers/pdf/PdfSidebar.tsx
git commit -m "feat(pdf): page thumbnail sidebar with lazy thumbnails and phone drawer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire scroll mode into PDFKonvaViewer

**Files:**
- Modify: `components/viewers/PDFKonvaViewer.tsx`

**Interfaces:**
- Consumes:
  - From Task 1: `browserStorage`, `effectiveMode`, `readStoredMode`, `writeStoredMode`.
  - From Task 2: `usePageSizes`.
  - From Task 3: `goPrev`, `goNext`, the keyboard effect.
  - From Task 4: `PdfScrollView`, `PdfScrollViewHandle`.
  - From Task 5: `PdfSidebar`.
- Produces: the finished feature. The component's props and `PDFKonvaViewerHandle` are unchanged.

- [ ] **Step 1: Imports**

Directly below `import PageArrows from './pdf/PageArrows';` (added in Task 3), add:

```tsx
import PdfScrollView, { type PdfScrollViewHandle } from './pdf/PdfScrollView';
import PdfSidebar from './pdf/PdfSidebar';
import { usePageSizes } from './pdf/usePageSizes';
import { browserStorage, effectiveMode, readStoredMode, writeStoredMode } from '@/lib/pdf/viewMode';
```

- [ ] **Step 2: Mode state**

Directly after the line `    const [loading, setLoading] = useState(true);`, insert:

```tsx
    // Sidebar open = scroll mode, closed = single-page (lib/pdf/viewMode.ts). Seeded from the
    // remembered choice; this component is client-only (ssr:false in ViewerContainer), so storage
    // can be read in the initializer.
    const [sidebarOpen, setSidebarOpen] = useState(() => readStoredMode(browserStorage()) === 'scroll');
    // A markup or measure session always runs single-page — a markup snapshot is one page — and the
    // view returns to scroll mode on its own when the session ends.
    const mode = effectiveMode({ sidebarOpen, numPages, annotating });
    const pageSizes = usePageSizes(pdfDoc);
    const scrollViewRef = useRef<PdfScrollViewHandle>(null);
    const [scrollScale, setScrollScale] = useState(1);
```

- [ ] **Step 3: Render the single page only in single-page mode**

In the "Render current page to image" effect, replace:

```tsx
    useEffect(() => {
      if (!pdfDoc) return;
      let cancelled = false;
      setLoading(true);
```

with:

```tsx
    useEffect(() => {
      // Scroll mode draws its own pages; rendering this one too would redo a 2× page on every
      // page the scroll passes.
      if (!pdfDoc || mode !== 'single') return;
      let cancelled = false;
      setLoading(true);
```

and replace that effect's dependency line `    }, [pdfDoc, currentPage, announceReady]);` with:

```tsx
    }, [pdfDoc, currentPage, announceReady, mode]);
```

Then insert directly after that effect's closing line:

```tsx

    // Leaving single-page mode drops the rendered page, so coming back never flashes a stale sheet
    // and nothing sized from `pageSize` (insertImage, the fit) can use another page's dimensions.
    useEffect(() => {
      if (mode !== 'scroll') return;
      setPageImage(null);
      setPageSize({ width: 0, height: 0 });
    }, [mode]);
```

- [ ] **Step 4: Make insertImage wait for the page size**

The portal calls `startAnnotationSession()` and then `insertImage(file)` in the same tick (`app/portal/[id]/page.tsx` around line 2185). From scroll mode, that is also the tick the viewer switches to single-page, before that page has rendered and while `pageSize` is 0×0.

Insert directly before the comment line `    // Ref handle (attached to the \`handleRef\` prop, not React \`ref\` — see note on props)`:

```tsx
    // insertImage can arrive before the page it lands on has rendered (the portal starts the
    // session and inserts in one tick, and from scroll mode that tick is also the switch to
    // single-page): park the image until `pageSize` is known.
    const pageSizeRef = useRef(pageSize);
    pageSizeRef.current = pageSize;
    const pendingImageRef = useRef<{ src: string; im: HTMLImageElement } | null>(null);
    const placeImage = useCallback((src: string, im: HTMLImageElement) => {
      const { width: pw, height: ph } = pageSizeRef.current;
      const scale = Math.min((pw * 0.5) / im.width, (ph * 0.5) / im.height, 1);
      const w = im.width * scale;
      const h = im.height * scale;
      ann.addImage({ x: (pw - w) / 2, y: (ph - h) / 2 }, src, w, h);
    }, [ann]);
    useEffect(() => {
      const p = pendingImageRef.current;
      if (!p || !pageSize.width) return;
      pendingImageRef.current = null;
      placeImage(p.src, p.im);
    }, [pageSize, placeImage]);

```

Then, inside `insertImage`, replace:

```tsx
          im.onload = () => {
            const maxW = pageSize.width * 0.5;
            const maxH = pageSize.height * 0.5;
            const scale = Math.min(maxW / im.width, maxH / im.height, 1);
            const w = im.width * scale;
            const h = im.height * scale;
            ann.addImage({ x: (pageSize.width - w) / 2, y: (pageSize.height - h) / 2 }, src, w, h);
          };
```

with:

```tsx
          im.onload = () => {
            if (!pageSizeRef.current.width) {
              pendingImageRef.current = { src, im };
              return;
            }
            placeImage(src, im);
          };
```

- [ ] **Step 5: Mode handlers**

Insert directly before the comment line `    // Comment pins for current page`:

```tsx
    const toggleSidebar = useCallback(() => {
      const next = !sidebarOpen;
      setSidebarOpen(next);
      writeStoredMode(browserStorage(), next ? 'scroll' : 'single');
    }, [sidebarOpen]);
    const selectPage = useCallback((page: number) => scrollViewRef.current?.scrollToPage(page), []);
    const handleFirstScrollDraw = useCallback(() => {
      setLoading(false);
      announceReady();
    }, [announceReady]);
    const zoomOut = () => (mode === 'scroll' ? scrollViewRef.current?.zoomStep(-0.25) : adjustZoom(-0.25));
    const zoomIn = () => (mode === 'scroll' ? scrollViewRef.current?.zoomStep(0.25) : adjustZoom(0.25));
    const fitZoom = () => (mode === 'scroll' ? scrollViewRef.current?.fitWidth() : resetZoom());
    const zoomPercent = Math.round((mode === 'scroll' ? scrollScale : stageScale) * 100);

```

- [ ] **Step 6: Keyboard handler only in single-page mode**

In the keyboard effect added in Task 3, replace `      if (numPages <= 1) return;` with `      if (mode !== 'single' || numPages <= 1) return;`. Replace its dependency line `    }, [numPages, pageNavLocked, goPrev, goNext]);` with:

```tsx
    }, [mode, numPages, pageNavLocked, goPrev, goNext]);
```

- [ ] **Step 7: Header — sidebar toggle and zoom dispatch**

Replace the counter block from Task 3:

```tsx
          {/* Page counter. Pages turn with the side arrows / ←→ (single-page) or by scrolling (scroll mode). */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {currentPage} / {numPages || '...'}
            </span>
          </div>
```

with:

```tsx
          {/* Sidebar toggle + page counter. Pages turn with the side arrows / ←→ (single-page) or by
              scrolling (scroll mode). */}
          <div className="flex items-center gap-2">
            {numPages > 1 && (
              <button
                type="button"
                onClick={toggleSidebar}
                disabled={annotating}
                aria-pressed={mode === 'scroll'}
                aria-label={sidebarOpen ? 'Hide pages' : 'Show pages'}
                title={annotating ? 'Finish markup to show pages' : sidebarOpen ? 'Hide pages' : 'Show pages'}
                className={`rounded p-1 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent ${mode === 'scroll' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'}`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path strokeLinecap="round" d="M9 4v16" />
                </svg>
              </button>
            )}
            <span className="text-sm text-gray-600 min-w-[60px] text-center">
              {currentPage} / {numPages || '...'}
            </span>
          </div>
```

In the zoom controls block:
- replace `onClick={() => adjustZoom(-0.25)}` with `onClick={zoomOut}`;
- replace `onClick={() => adjustZoom(0.25)}` with `onClick={zoomIn}`;
- replace `onClick={resetZoom}` with `onClick={fitZoom}`;
- replace `{Math.round(stageScale * 100)}%` with `{zoomPercent}%`.

- [ ] **Step 8: Body — sidebar + scroll view beside the (now hideable) canvas container**

Replace:

```tsx
        {/* Canvas container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden bg-gray-100 relative"
          style={{ cursor: cursorStyle }}
        >
```

with:

```tsx
        <div className="relative flex min-h-0 flex-1">
          {mode === 'scroll' && pdfDoc && pageSizes && (
            <>
              <PdfSidebar
                pdfDoc={pdfDoc}
                pageSizes={pageSizes}
                currentPage={currentPage}
                onSelectPage={selectPage}
                onClose={toggleSidebar}
              />
              <PdfScrollView
                handleRef={scrollViewRef}
                pdfDoc={pdfDoc}
                pageSizes={pageSizes}
                initialPage={currentPage}
                comments={comments}
                activeCommentId={activeCommentId}
                pendingCommentId={pendingCommentId}
                onCommentPinClick={onCommentPinClick}
                tagging={tagging}
                onCommentPlace={onCommentPlace}
                onCurrentPageChange={setCurrentPage}
                onScaleChange={setScrollScale}
                onFirstPageDrawn={handleFirstScrollDraw}
              />
            </>
          )}
          {mode === 'scroll' && (!pdfDoc || !pageSizes) && loading && (
            <div className="flex flex-1 items-center justify-center bg-gray-100">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            </div>
          )}

        {/* Canvas container (single-page mode). Hidden — never unmounted — in scroll mode: its
            ResizeObserver is attached once on mount, and while hidden it measures 0×0, which is
            what unmounts the Konva stage inside it. */}
        <div
          ref={containerRef}
          className={`min-w-0 flex-1 overflow-hidden bg-gray-100 relative ${mode === 'scroll' ? 'hidden' : ''}`}
          style={{ cursor: cursorStyle }}
        >
```

Then close the new wrapper at the very end of the JSX. Replace:

```tsx
              onCommit={commitText}
            />
          )}
        </div>
      </div>
    );
}
```

with:

```tsx
              onCommit={commitText}
            />
          )}
        </div>
        </div>
      </div>
    );
}
```

- [ ] **Step 9: Type-check, lint, unit tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc exit 0, no new lint findings in the touched files, all tests pass.

- [ ] **Step 10: Verify in the browser (harness from Task 3)**

Restart `npm run dev` if it is not running, then open `http://localhost:3000/portal/harness-pdf`. Clear the remembered mode first with `localStorage.removeItem('stiko.pdfViewer.mode')` and reload. Check each item and record what you saw:

1. It opens in single-page view (no sidebar, side arrows visible). The header shows the panel toggle at the far left.
2. Turn to page 4 with `→`, then click the toggle: the sidebar shows 40 thumbnails, the main view shows a column of pages at fit-width, and page 4 is at the top. The page-4 thumbnail has the purple outline, and the counter reads `4 / 40`.
3. Scroll the main view down. The counter and highlight follow, and the harness log shows the `page N` changes. Scroll to the very bottom: the counter reads `40 / 40`.
4. Scroll the sidebar by hand to page 30 while the main view sits on page 10: the sidebar does not jump back. Click thumbnail 30: the main view smooth-scrolls to page 30.
5. Page 3 (tabloid landscape) is the widest page and exactly fills the width. Pages 1, 2 and 4 are narrower and centred.
6. Ctrl+wheel over a word on page 6: it zooms and that word stays under the cursor. Wait half a second: the text is sharp, not blurry. `+`, `−` and `Fit` work, and the % changes. After `Fit`, resize the window: the column keeps fitting the width.
7. Pins: the pin numbered 1 is on page 1 and the pin numbered 2 is on page 3, at 20%/20% and 50%/50%. Click "tagging", then click page 7 near its top-left: the harness log shows `placed p7 …`, a pin numbered 3 appears there, and the view stays in scroll mode.
8. Click "annotating" while on page 7 in scroll mode: the sidebar disappears and page 7 shows single-page with arrows. The toggle is disabled with the title "Finish markup to show pages". The pin numbered 3 is in the same spot on the page. Click "annotating" again: you are back in scroll mode at page 7 with the sidebar.
9. Reload: it opens in scroll mode (remembered). Close the sidebar, reload: it opens single-page.
10. In DevTools → Memory, or `document.querySelectorAll('[data-page] canvas')`, count the canvases with `width > 0` while sitting mid-document: it is a handful (roughly 3–8), not 40.
11. Set the window to 375px wide, scroll mode: the sidebar overlays the page with a dark scrim. Tapping a thumbnail scrolls the page. Tapping the scrim closes it into single-page view.
12. `?f=harness-onepage.pdf`: no toggle, no arrows, no sidebar, even with `stiko.pdfViewer.mode` = `scroll` stored.
13. The console shows no errors except expected ones. A `RenderingCancelledException` must **not** appear as an error.

If any check fails, fix it with superpowers:systematic-debugging before committing.

- [ ] **Step 11: Commit**

```bash
git add components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(pdf): sidebar toggles a continuous scroll mode; sessions run single-page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final checks and harness cleanup

**Files:**
- Delete (untracked, never committed): `app/portal/harness-pdf/`, `.next/types/app/portal/harness-pdf/`, `public/uploads/harness-multipage.pdf`, `public/uploads/harness-onepage.pdf`

- [ ] **Step 1: Delete the harness**

```bash
rm -rf app/portal/harness-pdf .next/types/app/portal/harness-pdf public/uploads/harness-multipage.pdf public/uploads/harness-onepage.pdf
git status --short
```

Expected: `git status --short` shows only the five long-lived untracked dirs (`design_handoff_brief_section/`, `design_handoff_dashboard_redesign/`, `design_handoff_portal_view/`, `logo/`, `stiko_handoff/`) and nothing else.

- [ ] **Step 2: Full static checks and production build**

```bash
npx tsc --noEmit && npm run lint && npm test
npm run build
```

Expected: everything passes. If `npm run build` fails at "Collect page data" because of missing R2/S3 env vars, that is config, not this change. Re-run with the throwaway vars:

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
```

- [ ] **Step 3: Confirm untouched files**

```bash
git diff main --stat -- components/viewers/ViewerContainer.tsx 'app/portal/[id]/page.tsx'
```

Expected: no output (neither file changed).

- [ ] **Step 4: Report**

Summarise for the user:
- what shipped, and the branch `feature/pdf-sidebar-scroll`;
- which browser checks passed and anything not checked. **Not checked by the harness:** a real portal session, a real DWG/DXF-converted drawing, and insert-image from scroll mode. List these as things to try after merge.

The user merges and pushes `main` themselves. Give them one paste block for that, with a rollback line (`git revert -m 1 <merge sha>`).
