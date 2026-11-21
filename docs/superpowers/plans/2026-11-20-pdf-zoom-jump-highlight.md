# PDF sharp zoom, comment page jump, highlighter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDFs (and converted DWG/DXF) stay sharp at any zoom, clicking a tagged comment brings its page and pin into view, and a Highlighter markup tool exists for PDF/DWG/DXF/image files but not 3D.

**Architecture:** Zoom sharpness is a viewport-sized "detail" render drawn over the unchanged base page render after zoom/pan settles (pure geometry in `lib/pdf/detailTile.ts`, pdf.js call in `lib/pdf/pageRender.ts`, wired into the single-page Konva stage and each scroll-mode page). The page jump is an effect in `PDFKonvaViewer` keyed on `activeCommentId`, using pure helpers in `lib/pdf/viewMode.ts` and a new `revealPoint` on the scroll view handle. The highlighter is a new `'highlight'` markup object type riding the existing freehand gesture model, gated in the toolbar by a positive file-type list.

**Tech Stack:** Next.js 14 / React 18, react-konva, pdfjs-dist 5.4.296, `node --test` with native TS type stripping.

Spec: `docs/superpowers/specs/2026-11-20-pdf-zoom-jump-highlight-design.md`

## Global Constraints

- Branch `feature/pdf-zoom-jump-highlight` (already created, spec committed). The user merges and pushes `main` themselves — never push.
- **Never `git add -A` / `git add .`** — three long-lived untracked handoff dirs live in the repo root. Always add explicit paths.
- No migration. No change to `lib/schema.sql`.
- Any `lib/` module imported by a `node --test` file must use RELATIVE imports with the `.ts` extension (e.g. `'./viewMode.ts'`), never `@/`. Components may keep `@/`.
- Page coordinate space is untouched: page pixels at `PDF_RENDER_SCALE` (2) in `lib/measure/space.ts`. Pins, markup, measurements and calibrations must not move.
- `SETTLE_MS` = 150 ms. Device pixel ratio is always `Math.min(window.devicePixelRatio || 1, 2)`.
- Max zoom stays 500 % (single-page `0.25–5`, scroll `MIN_ZOOM`–`MAX_ZOOM`).
- Highlighter: `HIGHLIGHT_WIDTH_FACTOR` 6, `HIGHLIGHT_OPACITY` 0.4, yellow `#FFCF2E` (PALETTE's yellow accent), default markup colour `#FF6B6B`. Shown only when `isImageFile || isPDFFile || annotatingFile !== null`.
- UI copy says "Highlighter".
- `npm run dev` cannot load the PDF viewer (pdf.js `Object.defineProperty called on non-object`). Browser verification uses `npx next build && npx next start`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: tests `npm test` (baseline 1258 pass), types `npx tsc --noEmit`, lint `npm run lint`. If `tsc` fails on stale `.next/types/...` from another branch, `rm -rf .next/types` and rerun.

## File map

| File | Change | Responsibility |
|---|---|---|
| `lib/pdf/detailTile.ts` | create | Pure tile geometry: `intersectRect`, `snapOutward`, `needsDetail`, `detailRenderParams` |
| `scripts/tests/pdfDetailTile.test.mjs` | create | Unit tests for the above |
| `lib/pdf/pageRender.ts` | modify | Add `renderPageRegion`; share the offscreen draw with `renderPageToCanvas` |
| `components/viewers/PDFKonvaViewer.tsx` | modify | Stage `onDragEnd` sync; single-page detail image; comment jump effect |
| `components/viewers/pdf/PdfScrollView.tsx` | modify | Settled viewport; per-page detail canvas; `revealPoint` handle |
| `lib/pdf/viewMode.ts` | modify | `commentJumpTarget`, `isPointHidden`, `scrollToCentre`, `stagePosCentring`, `PIN_MARGIN` |
| `scripts/tests/pdfViewMode.test.mjs` | modify | Tests for the jump helpers |
| `lib/markup/highlight.ts` | create | Highlighter constants + `highlightStrokeWidth`, `colorOnArmHighlight` |
| `scripts/tests/markupHighlight.test.mjs` | create | Tests for the above |
| `lib/markup/draft.ts` | modify | `'highlight'` draft tool: freehand path, Shift = straight 45°-snapped band; `polylineExtent` |
| `scripts/tests/markupDraft.test.mjs` | modify | Tests for highlight geometry |
| `components/markup/useAnnotationObjects.ts` | modify | `'highlight'` type/tool, gesture set, validity |
| `components/markup/AnnotationObjects.tsx` | modify | Render `'highlight'` |
| `components/markup/DrawingTools.tsx` | modify | Highlighter button + icon, `highlightAvailable` prop |
| `app/portal/[id]/page.tsx` | modify | `DRAW_TOOLS`, `highlightAvailable`, colour-on-arm, fall back to pointer |

---

### Task 1: Detail-tile geometry (pure)

**Files:**
- Create: `lib/pdf/detailTile.ts`
- Test: `scripts/tests/pdfDetailTile.test.mjs`

**Interfaces:**
- Consumes: `MAX_CANVAS_PIXELS` from `lib/pdf/viewMode.ts`.
- Produces:
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `intersectRect(a: Rect, b: Rect): Rect | null`
  - `snapOutward(r: Rect, dpr: number): Rect`
  - `DETAIL_TOLERANCE = 1.05`
  - `needsDetail(baseBitmapWidth: number, displayWidth: number, dpr: number): boolean`
  - `interface DetailParams { scale: number; offsetX: number; offsetY: number; canvasWidth: number; canvasHeight: number }`
  - `detailRenderParams(pageWidthPt: number, region: Rect, displayWidth: number, dpr: number): DetailParams`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/pdfDetailTile.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  intersectRect,
  snapOutward,
  needsDetail,
  detailRenderParams,
  DETAIL_TOLERANCE,
} from '../../lib/pdf/detailTile.ts';
import { MAX_CANVAS_PIXELS } from '../../lib/pdf/viewMode.ts';

test('intersectRect: overlapping rects give their overlap', () => {
  assert.deepEqual(
    intersectRect({ x: 0, y: 0, width: 100, height: 50 }, { x: 60, y: 20, width: 100, height: 100 }),
    { x: 60, y: 20, width: 40, height: 30 },
  );
});

test('intersectRect: disjoint or edge-touching rects give null', () => {
  assert.equal(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }), null);
  assert.equal(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), null);
});

test('intersectRect: a rect inside another is itself', () => {
  const inner = { x: 5, y: 5, width: 2, height: 3 };
  assert.deepEqual(intersectRect({ x: 0, y: 0, width: 100, height: 100 }, inner), inner);
});

test('snapOutward: grows to whole device pixels and never shrinks', () => {
  const r = snapOutward({ x: 10.3, y: 4.74, width: 20.1, height: 5.01 }, 2);
  // device px: x 20.6→20, y 9.48→9, right 60.8→61, bottom 19.5→20
  assert.deepEqual(r, { x: 10, y: 4.5, width: 20.5, height: 5.5 });
});

test('snapOutward: already-aligned rect is unchanged', () => {
  assert.deepEqual(snapOutward({ x: 1, y: 2, width: 3, height: 4 }, 1), { x: 1, y: 2, width: 3, height: 4 });
});

test('needsDetail: base at screen density does not need detail', () => {
  // 1000-px bitmap shown 500 CSS px wide on a 2x screen = exactly 2 device px per CSS px.
  assert.equal(needsDetail(1000, 500, 2), false);
});

test('needsDetail: stretched base needs detail', () => {
  // 1000-px bitmap shown 1000 CSS px wide on a 2x screen = 1 device px per CSS px.
  assert.equal(needsDetail(1000, 1000, 2), true);
});

test('needsDetail: the tolerance absorbs rounding just under density', () => {
  // 0.97 of the needed density: within tolerance, no redraw.
  assert.equal(needsDetail(970, 500, 2), false);
  assert.ok(DETAIL_TOLERANCE > 1);
});

test('needsDetail: unknown sizes never need detail', () => {
  assert.equal(needsDetail(0, 500, 2), false);
  assert.equal(needsDetail(1000, 0, 2), false);
});

test('detailRenderParams: scale and offset map the region to the canvas origin', () => {
  // Page 600 pt wide, displayed 1200 CSS px wide, dpr 2 -> 4 device px per pt.
  const p = detailRenderParams(600, { x: 100, y: 50, width: 300, height: 200 }, 1200, 2);
  assert.equal(p.scale, 4);
  assert.equal(p.offsetX, -200);
  assert.equal(p.offsetY, -100);
  assert.equal(p.canvasWidth, 600);
  assert.equal(p.canvasHeight, 400);
});

test('detailRenderParams: lowers density to stay within the canvas pixel cap', () => {
  const region = { x: 0, y: 0, width: 4000, height: 4000 }; // 16M CSS px; at dpr 2 would be 64M
  const p = detailRenderParams(1000, region, 8000, 2);
  assert.ok(p.canvasWidth * p.canvasHeight <= MAX_CANVAS_PIXELS * 1.001);
  assert.ok(p.scale < (8000 * 2) / 1000);
});

test('detailRenderParams: canvas is at least 1x1', () => {
  const p = detailRenderParams(600, { x: 0, y: 0, width: 0.1, height: 0.1 }, 600, 1);
  assert.equal(p.canvasWidth, 1);
  assert.equal(p.canvasHeight, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/pdfDetailTile.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `lib/pdf/detailTile.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/pdf/detailTile.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/pdfDetailTile.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/detailTile.ts scripts/tests/pdfDetailTile.test.mjs
git commit -m "feat(pdf): detail-tile geometry for sharp zoom

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `renderPageRegion` + single-page detail layer + Stage drag sync

**Files:**
- Modify: `lib/pdf/pageRender.ts`
- Modify: `components/viewers/PDFKonvaViewer.tsx` (Stage at ~L857, background Layer at ~L873, the "Leaving single-page mode" effect at ~L417)

**Interfaces:**
- Consumes: Task 1's `Rect`, `intersectRect`, `snapOutward`, `needsDetail`, `detailRenderParams`.
- Produces: `renderPageRegion(page: PDFPageProxy, target: HTMLCanvasElement, region: Rect, displayWidth: number, dpr: number): PageRenderJob` in `lib/pdf/pageRender.ts` (used again by Task 3).

No unit test: pdf.js rendering and Konva are exercised in the browser pass (Task 8). Gate is `tsc` + lint + existing tests.

- [ ] **Step 1: Refactor `lib/pdf/pageRender.ts` and add `renderPageRegion`**

Replace the body of `renderPageToCanvas` and add the new function. Full new file:

```ts
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
```

Note: `drawOffscreen` floors width/height where the old code did `Math.floor(viewport.width)` — identical for `renderPageToCanvas`; `detailRenderParams` already returns integers.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `PageViewport` is not exported from `pdfjs-dist`'s root types, use `ReturnType<PDFPageProxy['getViewport']>` instead.)

- [ ] **Step 3: Sync the Stage's dragged position (pre-existing bug)**

In `components/viewers/PDFKonvaViewer.tsx`, the `<Stage ... draggable={...}>` has no `onDragEnd`, so after a pan `stagePos` keeps the old value and the next wheel/button zoom computes from the wrong origin and jumps. Add this prop to the `<Stage>` element, right after `draggable={...}`:

```tsx
              // A pan moves the Stage itself; write the result back, or `stagePos` (which the zoom
              // maths, the matte, the detail render and the pin centring all read) goes stale.
              // Markup objects are draggable too and their dragend bubbles here — only the Stage's own counts.
              onDragEnd={(e) => {
                const s = e.target;
                if (s !== s.getStage()) return;
                setStagePos({ x: s.x(), y: s.y() });
              }}
```

- [ ] **Step 4: Add the single-page detail render**

Imports at the top of `PDFKonvaViewer.tsx` — add:

```ts
import { intersectRect, needsDetail, snapOutward, type Rect } from '@/lib/pdf/detailTile';
import { isRenderCancelled, releaseCanvas, renderPageRegion, type PageRenderJob } from '@/lib/pdf/pageRender';
```

(If `pageRender` is already imported, merge the names into that import.)

Below the existing `const [stagePos, setStagePos] = ...` line, add state:

```ts
    // The on-screen part of the page, redrawn at screen resolution once zoom/pan settles
    // (lib/pdf/detailTile.ts). `rect` is in PAGE pixels, so it stays aligned through later zooms
    // and pans and is only stretched until the next one lands. Tagged with its page so a page
    // turn never shows another sheet's pixels.
    const [detail, setDetail] = useState<{ canvas: HTMLCanvasElement; page: number; rect: Rect } | null>(null);
```

After the "Render current page to image" effect (the one ending `}, [pdfDoc, currentPage, announceReady, mode]);`), add:

```ts
    // Detail render (single-page). Runs SETTLE_MS after the last zoom/pan/resize; a newer change
    // cancels it. Skipped when the base is already at screen density (fit zoom).
    useEffect(() => {
      if (!pdfDoc || mode !== 'single' || !pageImage || !pageSize.width || !containerSize.width) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const displayWidth = pageSize.width * stageScale;
      // The base image is pageSize.width bitmap pixels wide (rendered at PDF_RENDER_SCALE).
      if (!needsDetail(pageSize.width, displayWidth, dpr)) {
        setDetail(null);
        return;
      }
      const visible = intersectRect(
        { x: 0, y: 0, width: containerSize.width, height: containerSize.height },
        { x: stagePos.x, y: stagePos.y, width: displayWidth, height: pageSize.height * stageScale },
      );
      if (!visible) return;
      const region = snapOutward({ x: visible.x - stagePos.x, y: visible.y - stagePos.y, width: visible.width, height: visible.height }, dpr);
      const page = currentPage;
      let cancelled = false;
      let job: PageRenderJob | null = null;
      const t = setTimeout(() => {
        pdfDoc
          .getPage(page)
          .then((pg) => {
            if (cancelled) return;
            const canvas = document.createElement('canvas');
            job = renderPageRegion(pg, canvas, region, displayWidth, dpr);
            return job.promise.then(() => {
              if (cancelled) {
                releaseCanvas(canvas);
                return;
              }
              setDetail({
                canvas,
                page,
                rect: { x: region.x / stageScale, y: region.y / stageScale, width: region.width / stageScale, height: region.height / stageScale },
              });
            });
          })
          .catch((err) => {
            if (cancelled || isRenderCancelled(err)) return;
            console.error('Failed to render PDF detail:', err);
          });
      }, DETAIL_SETTLE_MS);
      return () => {
        cancelled = true;
        clearTimeout(t);
        job?.cancel();
      };
    }, [pdfDoc, mode, pageImage, pageSize, containerSize, stageScale, stagePos, currentPage]);

    // Free a replaced or dropped detail canvas once the stage no longer draws it.
    useEffect(() => {
      const c = detail?.canvas ?? null;
      return () => releaseCanvas(c);
    }, [detail]);
```

Add the constant near the top of the file (module scope, below the imports):

```ts
/** Redraw the visible part sharp this long after the last zoom/pan (matches PdfScrollView's SETTLE_MS). */
const DETAIL_SETTLE_MS = 150;
```

In the existing "Leaving single-page mode drops the rendered page" effect, add `setDetail(null);` beside `setPageImage(null);`.

In the PDF Background `<Layer>`, render the detail after the base image:

```tsx
                {pageImage && (
                  <KonvaImage image={pageImage} width={pageSize.width} height={pageSize.height} listening={false} />
                )}
                {pageImage && detail && detail.page === currentPage && (
                  <KonvaImage image={detail.canvas} x={detail.rect.x} y={detail.rect.y} width={detail.rect.width} height={detail.rect.height} listening={false} />
                )}
```

- [ ] **Step 5: Typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: no type/lint errors; `pass 1270` (1258 + Task 1's 12), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib/pdf/pageRender.ts components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(pdf): sharp single-page zoom via a viewport detail render

Also writes the Stage's dragged position back to stagePos, so a zoom
after a pan no longer jumps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scroll-mode detail canvas

**Files:**
- Modify: `components/viewers/pdf/PdfScrollView.tsx`

**Interfaces:**
- Consumes: `intersectRect`, `snapOutward`, `needsDetail`, `Rect` (Task 1); `renderPageRegion` (Task 2).
- Produces: `ScrollPage` accepts a new prop `visibleRegion: Rect | null` (page-local CSS px at the current zoom). Nothing outside this file changes.

- [ ] **Step 1: Imports**

Add to the imports in `PdfScrollView.tsx`:

```ts
import { intersectRect, needsDetail, snapOutward, type Rect } from '@/lib/pdf/detailTile';
```

and add `renderPageRegion` to the existing `@/lib/pdf/pageRender` import.

- [ ] **Step 2: Settled viewport in `PdfScrollView`**

After the `renderSet` `useMemo`, add:

```ts
  // The viewport, SETTLE_MS after the last scroll or zoom, stamped with the zoom it was measured at.
  // Drives the per-page detail render; a stamp from another zoom is ignored until it re-settles.
  const [settledView, setSettledView] = useState<{ rect: Rect; scale: number } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !ready || scale === null) return;
    const t = setTimeout(() => {
      setSettledView({ rect: { x: el.scrollLeft, y: el.scrollTop, width: el.clientWidth, height: el.clientHeight }, scale });
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [scrollPos, scale, viewport, ready]);
```

Move the existing `const colWidth = layout ? Math.max(layout.contentWidth, viewport.width) : 0;` line up so it sits **above** this new block's following memo (it is used there), then add:

```ts
  // Each rendered page's on-screen part, in page-local CSS px.
  const visibleRegions = useMemo(() => {
    const m = new Map<number, Rect>();
    if (!layout || !settledView || settledView.scale !== scale) return m;
    for (const p of layout.pages) {
      if (!renderSet.has(p.page)) continue;
      const left = (colWidth - p.width) / 2;
      const vis = intersectRect(settledView.rect, { x: left, y: p.top, width: p.width, height: p.height });
      if (vis) m.set(p.page, { x: vis.x - left, y: vis.y - p.top, width: vis.width, height: vis.height });
    }
    return m;
  }, [layout, settledView, scale, renderSet, colWidth]);
```

Pass it to each page in the `layout.pages.map(...)` JSX:

```tsx
              visibleRegion={visibleRegions.get(p.page) ?? null}
```

- [ ] **Step 3: `ScrollPage` — track base bitmap width and draw the detail canvas**

Add `visibleRegion: Rect | null;` to `ScrollPageProps` (with the doc comment `/** This page's on-screen part, page-local CSS px at the current zoom; null when off screen or not settled. */`) and to the destructured props.

Inside `ScrollPage`, add below `const [failed, setFailed] = useState(false);`:

```ts
  const detailRef = useRef<HTMLCanvasElement>(null);
  // Width of the base bitmap last drawn — what needsDetail compares against the on-screen width.
  const [baseWidth, setBaseWidth] = useState(0);
```

In the base render effect, change the success branch so it records the width:

```ts
        return job.promise.then(() => {
          if (cancelled) return;
          setBaseWidth(canvas.width);
          onDrawn();
        });
```

and in its `if (!shouldRender) { releaseCanvas(canvas); return; }` branch add `setBaseWidth(0);` before `return`.

Add the detail effect after the base render effect:

```ts
  // Detail render: only where the base is visibly stretched (it hit the canvas cap). Positioned
  // in percentages of the page, written in the same tick the pixels land, so it stays aligned
  // through later zooms and never shows new pixels in an old box.
  useEffect(() => {
    const canvas = detailRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!shouldRender || !visibleRegion || !needsDetail(baseWidth, width, dpr)) {
      if (!shouldRender || !needsDetail(baseWidth, width, dpr)) {
        releaseCanvas(canvas);
        canvas.style.display = 'none';
      }
      return;
    }
    const region = snapOutward(visibleRegion, dpr);
    let cancelled = false;
    let job: PageRenderJob | null = null;
    pdfDoc
      .getPage(page)
      .then((pg) => {
        if (cancelled) return;
        job = renderPageRegion(pg, canvas, region, width, dpr);
        return job.promise.then(() => {
          if (cancelled) return;
          Object.assign(canvas.style, {
            display: 'block',
            left: `${(region.x / width) * 100}%`,
            top: `${(region.y / height) * 100}%`,
            width: `${(region.width / width) * 100}%`,
            height: `${(region.height / height) * 100}%`,
          });
        });
      })
      .catch((err) => {
        if (cancelled || isRenderCancelled(err)) return;
        console.error(`Failed to render PDF page ${page} detail:`, err);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
    // `width`/`height` are read only together with `visibleRegion`, which is recomputed whenever they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, page, shouldRender, visibleRegion, baseWidth]);
```

Note: an off-screen-but-rendered page (`visibleRegion` null, base still needs detail) keeps its last detail canvas — it is positioned in percentages, so if it scrolls back in it is still aligned; it is released when the page leaves the render window.

Extend the unmount cleanup to free the detail canvas too:

```ts
  useEffect(() => {
    const c = canvasRef.current;
    const d = detailRef.current;
    return () => {
      releaseCanvas(c);
      releaseCanvas(d);
    };
  }, []);
```

In the returned JSX, directly after `<canvas ref={canvasRef} className="block h-full w-full" />`, add:

```tsx
      <canvas ref={detailRef} className="pointer-events-none absolute" style={{ display: 'none' }} />
```

(`pointer-events-none` keeps tag placement and pin clicks working through it. The pins render after it, so they stay on top.)

- [ ] **Step 4: Typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: clean; `pass 1270`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/pdf/PdfScrollView.tsx
git commit -m "feat(pdf): sharp scroll-mode zoom past the canvas cap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Comment-jump helpers (pure)

**Files:**
- Modify: `lib/pdf/viewMode.ts` (append at end)
- Modify: `scripts/tests/pdfViewMode.test.mjs` (extend import list, append tests)

**Interfaces:**
- Produces:
  - `PIN_MARGIN = 24`
  - `interface JumpTarget { page: number; xPct: number; yPct: number }`
  - `commentJumpTarget(c: { pageNumber: number | null; xPosition: number | null; yPosition: number | null } | undefined, numPages: number): JumpTarget | null`
  - `isPointHidden(x: number, y: number, viewWidth: number, viewHeight: number, margin: number): boolean` — point in viewport coords
  - `scrollToCentre(x: number, y: number, viewWidth: number, viewHeight: number): { left: number; top: number }` — point in content coords
  - `stagePosCentring(a: { xPct: number; yPct: number; pageWidth: number; pageHeight: number; scale: number; containerWidth: number; containerHeight: number }): { x: number; y: number }`

(`annotating` is handled by the caller, not here — the caller must mark the comment as handled while annotating, which a null return could not distinguish.)

- [ ] **Step 1: Write the failing tests**

Add to the import list at the top of `scripts/tests/pdfViewMode.test.mjs`: `PIN_MARGIN, commentJumpTarget, isPointHidden, scrollToCentre, stagePosCentring,`. Append:

```js
test('commentJumpTarget: a tagged comment on a valid page', () => {
  assert.deepEqual(commentJumpTarget({ pageNumber: 3, xPosition: 25, yPosition: 75 }, 5), { page: 3, xPct: 25, yPct: 75 });
});

test('commentJumpTarget: no target without a page, a position, or a loaded document', () => {
  assert.equal(commentJumpTarget(undefined, 5), null);
  assert.equal(commentJumpTarget({ pageNumber: null, xPosition: 1, yPosition: 1 }, 5), null);
  assert.equal(commentJumpTarget({ pageNumber: 2, xPosition: null, yPosition: 1 }, 5), null);
  assert.equal(commentJumpTarget({ pageNumber: 2, xPosition: 1, yPosition: null }, 5), null);
  assert.equal(commentJumpTarget({ pageNumber: 2, xPosition: 1, yPosition: 1 }, 0), null);
});

test('commentJumpTarget: out-of-range or fractional page is no target', () => {
  assert.equal(commentJumpTarget({ pageNumber: 0, xPosition: 1, yPosition: 1 }, 5), null);
  assert.equal(commentJumpTarget({ pageNumber: 6, xPosition: 1, yPosition: 1 }, 5), null);
  assert.equal(commentJumpTarget({ pageNumber: 2.5, xPosition: 1, yPosition: 1 }, 5), null);
});

test('isPointHidden: inside the margin-shrunk viewport is visible', () => {
  assert.equal(isPointHidden(100, 100, 800, 600, PIN_MARGIN), false);
});

test('isPointHidden: outside, or within the margin of an edge, is hidden', () => {
  assert.equal(isPointHidden(-5, 100, 800, 600, PIN_MARGIN), true);
  assert.equal(isPointHidden(100, 900, 800, 600, PIN_MARGIN), true);
  assert.equal(isPointHidden(10, 100, 800, 600, PIN_MARGIN), true);
  assert.equal(isPointHidden(100, 590, 800, 600, PIN_MARGIN), true);
});

test('scrollToCentre: centres the point, clamped at zero', () => {
  assert.deepEqual(scrollToCentre(1000, 2000, 800, 600), { left: 600, top: 1700 });
  assert.deepEqual(scrollToCentre(100, 100, 800, 600), { left: 0, top: 0 });
});

test('stagePosCentring: puts the pin at the container centre', () => {
  const pos = stagePosCentring({ xPct: 50, yPct: 25, pageWidth: 1000, pageHeight: 800, scale: 2, containerWidth: 600, containerHeight: 400 });
  // pin in page px (500, 200) -> screen = pos + pin*scale must equal (300, 200)
  assert.deepEqual(pos, { x: 300 - 1000, y: 200 - 400 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/pdfViewMode.test.mjs`
Expected: FAIL — `commentJumpTarget` (etc.) is not exported.

- [ ] **Step 3: Implement**

Append to `lib/pdf/viewMode.ts`:

```ts
/** How far inside the viewport edge a pin must be to count as on screen (CSS px). */
export const PIN_MARGIN = 24;

export interface JumpTarget {
  page: number;
  /** Pin position, percent of the page (the Comment's xPosition / yPosition). */
  xPct: number;
  yPct: number;
}

/**
 * Where clicking a comment should take the viewer: its page and pin, or null for a comment with
 * no page tag, no pin, a page outside the document, or a document not loaded yet (`numPages` 0).
 */
export function commentJumpTarget(
  c: { pageNumber: number | null; xPosition: number | null; yPosition: number | null } | undefined,
  numPages: number,
): JumpTarget | null {
  if (!c || numPages < 1) return null;
  if (c.pageNumber === null || c.xPosition === null || c.yPosition === null) return null;
  if (!Number.isInteger(c.pageNumber) || c.pageNumber < 1 || c.pageNumber > numPages) return null;
  return { page: c.pageNumber, xPct: c.xPosition, yPct: c.yPosition };
}

/** True when (x, y) — viewport coords — is outside the viewport shrunk by `margin` on every side. */
export function isPointHidden(x: number, y: number, viewWidth: number, viewHeight: number, margin: number): boolean {
  return x < margin || y < margin || x > viewWidth - margin || y > viewHeight - margin;
}

/** Scroll offsets that put (x, y) — content coords — at the viewport centre. */
export function scrollToCentre(x: number, y: number, viewWidth: number, viewHeight: number): { left: number; top: number } {
  return { left: Math.max(0, x - viewWidth / 2), top: Math.max(0, y - viewHeight / 2) };
}

/** The single-page Stage position that puts a pin (percent of the page) at the container centre, zoom kept. */
export function stagePosCentring(a: {
  xPct: number;
  yPct: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  containerWidth: number;
  containerHeight: number;
}): { x: number; y: number } {
  return {
    x: a.containerWidth / 2 - (a.xPct / 100) * a.pageWidth * a.scale,
    y: a.containerHeight / 2 - (a.yPct / 100) * a.pageHeight * a.scale,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/pdfViewMode.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/viewMode.ts scripts/tests/pdfViewMode.test.mjs
git commit -m "feat(pdf): pure helpers for jumping to a comment's page and pin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire the comment jump

**Files:**
- Modify: `components/viewers/pdf/PdfScrollView.tsx` (handle interface ~L25, refs ~L65, first-layout effect ~L172, `useImperativeHandle` ~L232)
- Modify: `components/viewers/PDFKonvaViewer.tsx`

**Interfaces:**
- Consumes: Task 4's `PIN_MARGIN`, `commentJumpTarget`, `isPointHidden`, `scrollToCentre`, `stagePosCentring`, `JumpTarget`.
- Produces: `PdfScrollViewHandle.revealPoint(page: number, xPct: number, yPct: number): void` — scrolls the pin to centre if it is not on screen; if the view is not laid out yet, queues it and applies it on first layout (instead of the initial page).

- [ ] **Step 1: `PdfScrollView` — `revealPoint`**

Add `isPointHidden`, `scrollToCentre`, `PIN_MARGIN` and `type JumpTarget`, `type PageLayout` to the `@/lib/pdf/viewMode` import.

Extend the handle interface:

```ts
  /** Bring a pin (percent of `page`) on screen, centred, unless it already is. Queued until first layout. */
  revealPoint: (page: number, xPct: number, yPct: number) => void;
```

Module-level helper (below `NO_COMMENTS`):

```ts
/** Scroll `el` so the pin is centred, unless it is already on screen. */
function revealIn(el: HTMLDivElement, layout: PageLayout, t: JumpTarget, behavior: ScrollBehavior): void {
  const p = layout.pages[t.page - 1];
  if (!p) return;
  const colWidth = Math.max(layout.contentWidth, el.clientWidth);
  const x = (colWidth - p.width) / 2 + (t.xPct / 100) * p.width;
  const y = p.top + (t.yPct / 100) * p.height;
  if (!isPointHidden(x - el.scrollLeft, y - el.scrollTop, el.clientWidth, el.clientHeight, PIN_MARGIN)) return;
  const c = scrollToCentre(x, y, el.clientWidth, el.clientHeight);
  el.scrollTo({ left: c.left, top: c.top, behavior });
}
```

Refs, next to `initialPageRef`:

```ts
  // A revealPoint that arrived before the first layout; applied in place of the initial page.
  const pendingRevealRef = useRef<JumpTarget | null>(null);
  // `ready` as a ref, for the imperative handle.
  const readyRef = useRef(false);
```

In the first-layout branch of the layout effect, replace:

```ts
    if (!ready) {
      el.scrollTop = scrollTopForPage(layout, initialPageRef.current, GAP);
      setScrollPos({ top: el.scrollTop, scale });
      setReady(true);
      return;
    }
```

with:

```ts
    if (!ready) {
      el.scrollTop = scrollTopForPage(layout, initialPageRef.current, GAP);
      const reveal = pendingRevealRef.current;
      pendingRevealRef.current = null;
      if (reveal) revealIn(el, layout, reveal, 'auto');
      setScrollPos({ top: el.scrollTop, scale });
      readyRef.current = true;
      setReady(true);
      return;
    }
```

Add to the `useImperativeHandle` object:

```ts
    revealPoint: (page, xPct, yPct) => {
      const el = scrollRef.current;
      const s = scaleRef.current;
      if (!el || s === null || !readyRef.current) {
        pendingRevealRef.current = { page, xPct, yPct };
        return;
      }
      revealIn(el, layoutPages(pageSizes, s, GAP, PADDING), { page, xPct, yPct }, 'smooth');
    },
```

- [ ] **Step 2: `PDFKonvaViewer` — the jump effect**

Add `PIN_MARGIN, commentJumpTarget, isPointHidden, stagePosCentring` to the existing `@/lib/pdf/viewMode` import.

Add after the "Fit page to container" effect:

```ts
    // Clicking a tagged comment (panel, pin or Brief citation) brings its page and pin into view.
    // Once per activeCommentId: paging away afterwards is never undone. Waits — without marking
    // the comment handled — for the document, the comments and the page layout to exist, which
    // is how a Brief citation that switched files still lands. A markup/measure session locks the
    // page, so a click during one is marked handled and ignored.
    const jumpedForRef = useRef<string | null>(null);
    useEffect(() => {
      if (!activeCommentId) {
        jumpedForRef.current = null;
        return;
      }
      if (jumpedForRef.current === activeCommentId) return;
      if (annotating) {
        jumpedForRef.current = activeCommentId;
        return;
      }
      const comment = comments.find((c) => c.id === activeCommentId);
      if (!comment || !numPages) return; // not loaded yet: try again when it is
      const target = commentJumpTarget(comment, numPages);
      if (!target) {
        jumpedForRef.current = activeCommentId;
        return;
      }
      if (mode === 'scroll') {
        if (!pageSizes) return; // the scroll view mounts once page sizes exist
        scrollViewRef.current?.revealPoint(target.page, target.xPct, target.yPct);
      } else if (target.page !== currentPage) {
        // A page turn re-fits the whole sheet (the fit effect above), so the pin is on screen.
        setCurrentPage(target.page);
      } else {
        if (!pageSize.width || !containerSize.width) return; // page not laid out yet
        const sx = stagePos.x + (target.xPct / 100) * pageSize.width * stageScale;
        const sy = stagePos.y + (target.yPct / 100) * pageSize.height * stageScale;
        if (isPointHidden(sx, sy, containerSize.width, containerSize.height, PIN_MARGIN)) {
          setStagePos(stagePosCentring({
            xPct: target.xPct,
            yPct: target.yPct,
            pageWidth: pageSize.width,
            pageHeight: pageSize.height,
            scale: stageScale,
            containerWidth: containerSize.width,
            containerHeight: containerSize.height,
          }));
        }
      }
      jumpedForRef.current = activeCommentId;
    }, [activeCommentId, annotating, comments, numPages, mode, pageSizes, currentPage, pageSize, containerSize, stagePos, stageScale]);
```

- [ ] **Step 3: Typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: clean; `pass 1277`, `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add components/viewers/pdf/PdfScrollView.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(pdf): clicking a tagged comment brings its page and pin into view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Highlighter object model

**Files:**
- Create: `lib/markup/highlight.ts`
- Create: `scripts/tests/markupHighlight.test.mjs`
- Modify: `lib/markup/draft.ts`
- Modify: `scripts/tests/markupDraft.test.mjs`
- Modify: `components/markup/useAnnotationObjects.ts` (L19-20 types, L68 `GESTURE_TOOLS`, L138 validity)
- Modify: `components/markup/AnnotationObjects.tsx` (switch at ~L205)

**Interfaces:**
- Produces (`lib/markup/highlight.ts`): `HIGHLIGHT_WIDTH_FACTOR = 6`, `HIGHLIGHT_OPACITY = 0.4`, `HIGHLIGHT_COLOR = '#FFCF2E'`, `DEFAULT_MARKUP_COLOR = '#FF6B6B'`, `highlightStrokeWidth(w: number): number`, `colorOnArmHighlight(current: string): string`.
- Produces (`lib/markup/draft.ts`): `DraftTool` gains `'highlight'`; `polylineExtent(points: number[]): number` (max distance of any point from the first).
- Produces: `AnnTool` and `AnnotationObjectType` gain `'highlight'` (so `ToolType` does too).

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/markupHighlight.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGHLIGHT_WIDTH_FACTOR,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_COLOR,
  DEFAULT_MARKUP_COLOR,
  highlightStrokeWidth,
  colorOnArmHighlight,
} from '../../lib/markup/highlight.ts';
import { PALETTE } from '../../lib/commentColors.ts';

test('highlighter is a wide, translucent stroke', () => {
  assert.equal(highlightStrokeWidth(4), 4 * HIGHLIGHT_WIDTH_FACTOR);
  assert.ok(HIGHLIGHT_OPACITY > 0 && HIGHLIGHT_OPACITY < 1);
});

test('highlighter yellow is the palette yellow, so the swatch row shows it selected', () => {
  assert.equal(PALETTE.find((p) => p.name === 'yellow').accent.toLowerCase(), HIGHLIGHT_COLOR.toLowerCase());
});

test('arming the highlighter on the default colour switches to yellow', () => {
  assert.equal(colorOnArmHighlight(DEFAULT_MARKUP_COLOR), HIGHLIGHT_COLOR);
  assert.equal(colorOnArmHighlight(DEFAULT_MARKUP_COLOR.toLowerCase()), HIGHLIGHT_COLOR);
});

test('arming the highlighter keeps any colour the user chose', () => {
  assert.equal(colorOnArmHighlight('#4A9FE0'), '#4A9FE0');
  assert.equal(colorOnArmHighlight('#123456'), '#123456');
});
```

Append to `scripts/tests/markupDraft.test.mjs` (add `polylineExtent` to its import list):

```js
test('highlight starts like freehand', () => {
  assert.deepEqual(startGeometry('highlight', { x: 3, y: 4 }), { points: [3, 4], x: 0, y: 0, width: 0, height: 0 });
});

test('highlight without Shift appends points like freehand', () => {
  const g = startGeometry('highlight', { x: 0, y: 0 });
  const g2 = updateGeometry('highlight', updateGeometry('highlight', g, { x: 5, y: 1 }, false), { x: 9, y: 2 }, false);
  assert.deepEqual(g2.points, [0, 0, 5, 1, 9, 2]);
});

test('highlight with Shift is a straight band from the start, snapped to 45 degrees', () => {
  let g = startGeometry('highlight', { x: 0, y: 0 });
  g = updateGeometry('highlight', g, { x: 5, y: 3 }, false);
  g = updateGeometry('highlight', g, { x: 100, y: 4 }, true);
  assert.equal(g.points.length, 4);
  assert.equal(g.points[0], 0);
  assert.equal(g.points[1], 0);
  assert.ok(Math.abs(g.points[3]) < 1e-9); // snapped horizontal
  assert.ok(Math.abs(g.points[2] - Math.hypot(100, 4)) < 1e-9); // length kept
});

test('polylineExtent: furthest distance from the first point', () => {
  assert.equal(polylineExtent([0, 0]), 0);
  assert.equal(polylineExtent([0, 0, 3, 4, 1, 1]), 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/tests/markupHighlight.test.mjs scripts/tests/markupDraft.test.mjs`
Expected: FAIL — `lib/markup/highlight.ts` missing; `polylineExtent` not exported.

- [ ] **Step 3: Implement `lib/markup/highlight.ts`**

```ts
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
```

- [ ] **Step 4: Extend `lib/markup/draft.ts`**

Change the type:

```ts
export type DraftTool = 'freehand' | 'highlight' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud';
```

In `startGeometry`, change the first line to:

```ts
  if (tool === 'freehand' || tool === 'highlight') return { points: [p.x, p.y], x: 0, y: 0, width: 0, height: 0 };
```

In `updateGeometry`, insert after the freehand line:

```ts
  // Shift turns a highlight into a straight band from where it started, snapped like a segment.
  if (tool === 'highlight') {
    if (!constrain) return { ...g, points: [...g.points, p.x, p.y] };
    const end = constrainSegment(g.points[0], g.points[1], p.x, p.y);
    return { ...g, points: [g.points[0], g.points[1], end.x, end.y] };
  }
```

Append:

```ts
/** The furthest any point of a flat [x, y, ...] list lies from its first point — "was anything drawn". */
export function polylineExtent(points: number[]): number {
  let max = 0;
  for (let i = 2; i + 1 < points.length; i += 2) {
    max = Math.max(max, Math.hypot(points[i] - points[0], points[i + 1] - points[1]));
  }
  return max;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/tests/markupHighlight.test.mjs scripts/tests/markupDraft.test.mjs`
Expected: all PASS.

- [ ] **Step 6: Object model — `components/markup/useAnnotationObjects.ts`**

```ts
export type AnnotationObjectType = 'freehand' | 'highlight' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'image';
export type AnnTool = 'pointer' | 'freehand' | 'highlight' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text' | 'eraser';
```

```ts
const GESTURE_TOOLS = new Set<AnnTool>(['freehand', 'highlight', 'line', 'arrow', 'rect', 'ellipse', 'cloud']);
```

Import `polylineExtent` alongside `startGeometry, updateGeometry, isBoxTool` from `@/lib/markup/draft`, and change the validity expression in `endDraw` to:

```ts
    const valid = d.type === 'freehand' ? d.points.length > 2
      : d.type === 'highlight' ? polylineExtent(d.points) > 3
      : isBoxTool(d.type) ? Math.abs(d.width) > 3 && Math.abs(d.height) > 3
      : (d.type === 'line' || d.type === 'arrow') ? Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) > 3
      : true;
```

Also update the `points` field comment to `// freehand/highlight/line/arrow (flat [x,y,...], in object space)`.

- [ ] **Step 7: Render — `components/markup/AnnotationObjects.tsx`**

Import: `import { HIGHLIGHT_OPACITY, highlightStrokeWidth } from '@/lib/markup/highlight';`

In the `switch (obj.type)`, after the `'freehand'` case:

```tsx
      case 'highlight': {
        const w = highlightStrokeWidth(obj.strokeWidth);
        return <Line key={obj.id} {...common} points={obj.points} stroke={obj.color} strokeWidth={w} opacity={HIGHLIGHT_OPACITY} lineCap="round" lineJoin="round" tension={0.4} hitStrokeWidth={Math.max(w, 12)} />;
      }
```

- [ ] **Step 8: Typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: clean; `pass 1285`, `fail 0`. If `tsc` flags an exhaustive `switch`/`Record` over `AnnotationObjectType` or `AnnTool` elsewhere, add the `'highlight'` case there with the same behaviour as `'freehand'`.

- [ ] **Step 9: Commit**

```bash
git add lib/markup/highlight.ts lib/markup/draft.ts scripts/tests/markupHighlight.test.mjs scripts/tests/markupDraft.test.mjs components/markup/useAnnotationObjects.ts components/markup/AnnotationObjects.tsx
git commit -m "feat(markup): highlight object type (wide translucent stroke, Shift = straight)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Highlighter button + portal gating

**Files:**
- Modify: `components/markup/DrawingTools.tsx` (props ~L11-45, icons ~L66, tool row ~L326)
- Modify: `app/portal/[id]/page.tsx` (L84 `DRAW_TOOLS`, L276 colour default, ~L761 file flags, ~L2596 `<DrawingTools>`)

**Interfaces:**
- Consumes: `DEFAULT_MARKUP_COLOR`, `colorOnArmHighlight` (Task 6); `'highlight'` in `ToolType` (Task 6).
- Produces: `DrawingToolsProps.highlightAvailable: boolean`.

- [ ] **Step 1: `DrawingTools.tsx`**

Add to `DrawingToolsProps`:

```ts
  /**
   * False hides the Highlighter. A positive list in the host (image, PDF — which covers a
   * converted DWG/DXF — or an attachment session): never on a 3D model or a video.
   */
  highlightAvailable: boolean;
```

Destructure `highlightAvailable` with the other props.

Add the icon after `FreehandIcon`:

```tsx
const HighlighterIcon = (
  <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 11-6 6v3h9l3-3" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </svg>
);
```

In the bar, after `{pickTool('freehand', 'Freehand', FreehandIcon)}`:

```tsx
        {highlightAvailable && pickTool('highlight', 'Highlighter', HighlighterIcon)}
```

- [ ] **Step 2: Portal page**

Import: `import { DEFAULT_MARKUP_COLOR, colorOnArmHighlight } from '@/lib/markup/highlight';`

L84:

```ts
const DRAW_TOOLS: ToolType[] = ['freehand', 'highlight', 'line', 'arrow', 'rect', 'ellipse', 'cloud', 'text'];
```

L276:

```ts
  const [drawingColor, setDrawingColor] = useState(DEFAULT_MARKUP_COLOR); // red-pastel accent; matches default toolbar swatch
```

After the `isImageFile` memo (~L764), add:

```ts
  // Where the Highlighter is offered: a positive list, like measureAvailable. isPDFFile covers a
  // converted DWG/DXF; an attachment session always draws on an image. Never 3D, never video.
  const highlightAvailable = isImageFile || isPDFFile || annotatingFile !== null;

  // The Highlighter can be armed and then the selection move to a 3D file or a video.
  useEffect(() => {
    if (activeTool === 'highlight' && !highlightAvailable) setActiveTool('pointer');
  }, [activeTool, highlightAvailable]);

  // Arming the Highlighter swaps the untouched default red for yellow; a chosen colour is kept.
  // setDrawingColor, not handleColorChange: arming a tool must never restyle a selection.
  const handleToolChange = useCallback((tool: ToolType) => {
    if (tool === 'highlight') setDrawingColor((c) => colorOnArmHighlight(c));
    setActiveTool(tool);
  }, []);
```

(If `activeTool`/`setActiveTool` are declared below this point, place the block after their declaration instead — it must come after `activeTool`, `isImageFile`, `isPDFFile` and `annotatingFile`.)

On `<DrawingTools>`: change `onToolChange={setActiveTool}` to `onToolChange={handleToolChange}` and add, after `measureAvailable={...}`:

```tsx
                highlightAvailable={highlightAvailable}
```

- [ ] **Step 3: Typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: clean; `pass 1285`, `fail 0`. If `DrawingTools` is rendered anywhere else, `tsc` will flag the missing prop — pass `highlightAvailable` there with the same rule for that surface.

- [ ] **Step 4: Commit**

```bash
git add components/markup/DrawingTools.tsx "app/portal/[id]/page.tsx"
git commit -m "feat(markup): Highlighter tool for PDF, DWG/DXF and images, not 3D

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Build and browser verification

**Files:** none (fix-ups only if something fails; commit them with a `fix(...)` message).

Follow `stiko-local-visual-verification` for booting the app signed-in and stubbing `/api/home` (the local account has zero projects). The PDF viewer only works on a production build.

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npx next build 2>&1 | tail -5`
Expected: no errors; `pass 1285`, `fail 0`; build succeeds.

- [ ] **Step 2: Start the build**

Run (background): `npx next start -p 3000`

- [ ] **Step 3: Browser checks (chrome-devtools MCP), each with a screenshot**

1. Large sheet (A1-size PDF, or a converted DWG), single-page mode: zoom to 500 % with the wheel; after ~150 ms linework is crisp (compare with a screenshot taken immediately after the wheel). Pan by dragging, then wheel-zoom: no jump. Zoom back to Fit: no detail canvas drawn (`detail` null — check no extra Konva image via `stage.find('Image').length === 1` in `evaluate_script`).
2. Same sheet, scroll mode (sidebar open): zoom to 500 %; visible page crisp; `document.querySelectorAll('[data-page] canvas')` shows the second canvas with `display: block` only on visible pages.
3. Multi-page PDF with a tagged comment on page 3. Single-page on page 1: click the comment in the panel → page 3 shown with the pin. Zoom in on page 3, pan away from the pin, click the comment off and on → view recentres on the pin at the same zoom. Scroll mode: scroll to page 1, click the comment → page 3's pin scrolls to centre.
4. Start a markup session (pick Freehand), click the page-3 comment → page does not change.
5. Highlighter: on a PDF, toolbar shows "Highlighter" after Freehand; arming it turns the swatch yellow (from the default red); a drag leaves a wide translucent band, linework visible through it; Shift-drag gives a straight band; select/move it, erase it, ⌘Z restores it. On an image file: button present. On a 3D file: button absent; arm Highlighter on a PDF then switch to a 3D file → tool returns to Pointer.

- [ ] **Step 4: Record results**

Note each check's pass/fail in the final report; stop the server. Any fix-ups found are committed individually on the branch.
