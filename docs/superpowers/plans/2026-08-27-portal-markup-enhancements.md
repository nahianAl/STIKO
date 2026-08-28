# Portal Markup Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type markup text directly inside a box that grows to fit it, make every applied object re-styleable, remove the black border from annotation snapshots, and restyle the annotation banner into a floating pill in the portal's design language.

**Architecture:** Two Konva surfaces (`AnnotationCanvas` for 3D/image/video/attachments, `PDFKonvaViewer` for PDFs) already share the `useAnnotationObjects` model and the `AnnotationObjects` renderer. This plan pushes more into that shared middle: a `CanvasTextEditor` overlay both surfaces mount, and two dependency-free modules under `lib/markup/` holding the arithmetic so the `node --test` suite can reach it. Nothing about the comment/pin/tagging system changes.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript (strict), Konva 10 / react-konva 18, Tailwind with Stiko design tokens, `node --test` with native TypeScript type-stripping (Node v25).

**Design spec:** `docs/superpowers/specs/2026-08-27-portal-markup-enhancements-design.md`

## Global Constraints

- **Node runs `.ts` directly.** Tests are `.mjs` under `scripts/tests/` and import `../../lib/**/*.ts` by full path including the extension. Type-stripping only erases syntax — **no `enum`, no `namespace`, no constructor parameter properties** in any file a test imports.
- **`lib/markup/*.ts` must have zero imports.** Pure arithmetic only. No React, no Konva, no `three`.
- **Design tokens only.** Colours come from `tailwind.config.ts` (`stiko-*`, `note-*`) or `lib/commentColors.ts`. Never introduce a raw Tailwind palette colour (`bg-amber-50`, `bg-gray-900`) in markup UI.
- **The snapshot reads the canvas, never the DOM.** Any control rendered as sibling DOM inside the viewer area is invisible to `captureSnapshot`. This is load-bearing for the floating banner.
- **`npx tsc --noEmit` must pass at the end of every task — except Tasks 7, 8, 9 and 10.** `strict` is on. Task 7 changes `addText`'s signature, which breaks its two call sites until Task 11 rewrites the second one. Those four tasks each state the exact errors to expect and must show *only* those. A reviewer gating on "does it compile" should gate at Task 11.
- **Tasks 3 through 13 carry a throwaway route** at `app/portal/markup-harness/page.tsx`. It is plan-mandated scaffolding — the markup UI cannot otherwise be seen without a database, an S3 bucket and an uploaded file. Task 14 deletes it. It must never be referenced by production code.
- **The full test suite must stay green:** `npm test` — baseline is **193 passing**.
- **`main` deploys straight to production** (there is no staging). The final task runs a real production build before the work is considered done.
- **Font family is pinned to `Arial` for markup text, explicitly, in both the Konva node and the editor.** This is today's implicit Konva default. Do not switch markup text to Manrope in this plan — `next/font` exposes a hashed family name via a CSS variable, and Konva measures text with `canvas.measureText`, so a mismatch between the two would silently break wrap alignment. Out of scope.

---

### Task 1: `lib/markup/text.ts` — text arithmetic

**Files:**
- Create: `lib/markup/text.ts`
- Test: `scripts/tests/markupText.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TEXT_FONT_FAMILY: string`
  - `STROKE_PRESETS: readonly number[]` — `[2, 4, 6]`
  - `FONT_SIZES: readonly number[]` — `[16, 24, 34]`
  - `fontSizeForStrokeWidth(strokeWidth: number): number`
  - `strokeWidthForFontSize(fontSize: number): number`
  - `wrapWidthForContent(contentWidth: number): number`
  - `isBlank(text: string): boolean`
  - `MIN_WRAP_WIDTH: number`, `MIN_FONT_SIZE: number`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/markupText.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STROKE_PRESETS,
  FONT_SIZES,
  MIN_WRAP_WIDTH,
  MIN_FONT_SIZE,
  fontSizeForStrokeWidth,
  strokeWidthForFontSize,
  wrapWidthForContent,
  isBlank,
} from '../../lib/markup/text.ts';

test('every stroke preset maps to a font size and back again', () => {
  // The toolbar writes a stroke width and later has to show which preset is active for a
  // selected text object. That only works if the map round-trips exactly on the presets.
  for (const w of STROKE_PRESETS) {
    assert.equal(strokeWidthForFontSize(fontSizeForStrokeWidth(w)), w, `stroke ${w} did not round-trip`);
  }
  for (const px of FONT_SIZES) {
    assert.equal(fontSizeForStrokeWidth(strokeWidthForFontSize(px)), px, `size ${px} did not round-trip`);
  }
});

test('the presets are the documented 2/4/6 -> 16/24/34 ladder', () => {
  assert.deepEqual([...STROKE_PRESETS], [2, 4, 6]);
  assert.equal(fontSizeForStrokeWidth(2), 16);
  assert.equal(fontSizeForStrokeWidth(4), 24);
  assert.equal(fontSizeForStrokeWidth(6), 34);
});

test('an unmapped stroke width clamps to the nearest preset', () => {
  assert.equal(fontSizeForStrokeWidth(1), 16);    // below the ladder
  assert.equal(fontSizeForStrokeWidth(99), 34);   // above the ladder
  assert.equal(fontSizeForStrokeWidth(4.6), 24);  // strictly nearer 4 than 6
  assert.equal(fontSizeForStrokeWidth(2.9), 16);  // strictly nearer 2 than 4
});

test('a tie between two presets resolves to the thinner one, deterministically', () => {
  // The presets are evenly spaced, so 3 and 5 are each exactly between two of them. Which way
  // a tie goes matters less than that it never varies, because a scaled text object feeds an
  // arbitrary size back through strokeWidthForFontSize.
  assert.equal(fontSizeForStrokeWidth(3), 16);
  assert.equal(fontSizeForStrokeWidth(5), 24);
  assert.equal(fontSizeForStrokeWidth(3), 16);
});

test('an arbitrary font size from a manual resize clamps to the nearest preset', () => {
  // bakeTextTransform produces continuous sizes; the toolbar still has to highlight one chip.
  assert.equal(strokeWidthForFontSize(17), 2);
  assert.equal(strokeWidthForFontSize(23), 4);
  assert.equal(strokeWidthForFontSize(200), 6);
  assert.equal(strokeWidthForFontSize(1), 2);
});

test('wrap width is 40% of the content', () => {
  assert.equal(wrapWidthForContent(1000), 400);
  assert.equal(wrapWidthForContent(2000), 800);
});

test('wrap width never falls below the floor, so a narrow page is still typable', () => {
  // 40% of 200 is 80, under the floor — but 200 itself is over it, so the floor is what wins.
  // Content must be wider than MIN_WRAP_WIDTH here, or the clamp below takes precedence and
  // this asserts nothing about the floor.
  const content = MIN_WRAP_WIDTH * 2;
  assert.ok(content * 0.4 < MIN_WRAP_WIDTH, 'test setup: 40% must fall under the floor');
  assert.equal(wrapWidthForContent(content), MIN_WRAP_WIDTH);
});

test('the clamp to content beats the floor, so the box never exceeds the page', () => {
  // Content narrower than the floor. The floor must not push the box wider than the page it
  // sits on, so this returns the content width rather than MIN_WRAP_WIDTH.
  const narrow = MIN_WRAP_WIDTH - 20;
  assert.equal(wrapWidthForContent(narrow), narrow);
});

test('an unmeasured container yields the floor rather than a zero-width box', () => {
  // Both surfaces render before their ResizeObserver has fired at least once.
  assert.equal(wrapWidthForContent(0), MIN_WRAP_WIDTH);
  assert.equal(wrapWidthForContent(-5), MIN_WRAP_WIDTH);
});

test('blank text is anything with no visible glyphs', () => {
  assert.equal(isBlank(''), true);
  assert.equal(isBlank('   '), true);
  assert.equal(isBlank('\n\n'), true);
  assert.equal(isBlank(' \t \n '), true);
  assert.equal(isBlank('a'), false);
  assert.equal(isBlank('  hi  '), false);
});

test('MIN_FONT_SIZE keeps a shrunk text object selectable', () => {
  assert.ok(MIN_FONT_SIZE > 0);
  assert.ok(MIN_FONT_SIZE <= FONT_SIZES[0]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/markupText.test.mjs`
Expected: FAIL — `Cannot find module .../lib/markup/text.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/markup/text.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/markupText.test.mjs`
Expected: PASS, 11 tests

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/markup/text.ts scripts/tests/markupText.test.mjs
git commit -m "feat(markup): text sizing, wrapping and blank-text arithmetic"
```

---

### Task 2: `lib/markup/matte.ts` — the in-stage background rect

**Files:**
- Create: `lib/markup/matte.ts`
- Test: `scripts/tests/markupMatte.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface MatteRect { x: number; y: number; width: number; height: number }`
  - `CANVAS_MATTE: string` — `'#f0f0f0'`
  - `PDF_MATTE: string` — `'#f3f4f6'`
  - `matteRectForStage(input: { stagePos: { x: number; y: number }; stageScale: number; containerSize: { width: number; height: number } }): MatteRect`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/markupMatte.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matteRectForStage } from '../../lib/markup/matte.ts';

const CONTAINER = { width: 800, height: 600 };

/**
 * Project a page-space rect back to screen space the way Konva does: the Stage carries the
 * scale and the translation, and every layer inherits them. This is the oracle — the matte is
 * correct exactly when its projection covers the container.
 */
const project = (rect, stagePos, stageScale) => ({
  x: rect.x * stageScale + stagePos.x,
  y: rect.y * stageScale + stagePos.y,
  width: rect.width * stageScale,
  height: rect.height * stageScale,
});

const cases = [
  { name: 'unscaled and unpanned', stagePos: { x: 0, y: 0 }, stageScale: 1 },
  { name: 'fitted small, centred', stagePos: { x: 120, y: 40 }, stageScale: 0.5 },
  { name: 'zoomed in past the edges', stagePos: { x: -300, y: -220 }, stageScale: 3 },
  { name: 'zoomed out', stagePos: { x: 260, y: 190 }, stageScale: 0.25 },
  { name: 'panned so the page origin is off-screen left', stagePos: { x: -900, y: 30 }, stageScale: 1.4 },
];

for (const c of cases) {
  test(`the matte covers the container exactly when ${c.name}`, () => {
    const rect = matteRectForStage({ stagePos: c.stagePos, stageScale: c.stageScale, containerSize: CONTAINER });
    const onScreen = project(rect, c.stagePos, c.stageScale);
    // Exactly, not merely "contains": any overshoot is wasted fill, any shortfall is a
    // transparent strip that JPEG encodes as the black border this whole change removes.
    assert.ok(Math.abs(onScreen.x) < 1e-9, `left edge at ${onScreen.x}`);
    assert.ok(Math.abs(onScreen.y) < 1e-9, `top edge at ${onScreen.y}`);
    assert.ok(Math.abs(onScreen.width - CONTAINER.width) < 1e-9, `width ${onScreen.width}`);
    assert.ok(Math.abs(onScreen.height - CONTAINER.height) < 1e-9, `height ${onScreen.height}`);
  });
}

test('a degenerate scale yields an empty rect rather than NaN or Infinity', () => {
  // Both surfaces render at least once before their fit effect has run, when stageScale is
  // still its initial value. An Infinity here would poison the whole layer.
  for (const stageScale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const rect = matteRectForStage({ stagePos: { x: 0, y: 0 }, stageScale, containerSize: CONTAINER });
    for (const v of [rect.x, rect.y, rect.width, rect.height]) {
      assert.ok(Number.isFinite(v), `stageScale ${stageScale} produced ${v}`);
    }
    assert.equal(rect.width, 0);
    assert.equal(rect.height, 0);
  }
});

test('an unmeasured container yields an empty rect', () => {
  const rect = matteRectForStage({ stagePos: { x: 0, y: 0 }, stageScale: 1, containerSize: { width: 0, height: 0 } });
  assert.equal(rect.width, 0);
  assert.equal(rect.height, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/markupMatte.test.mjs`
Expected: FAIL — `Cannot find module .../lib/markup/matte.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/markup/matte.ts`:

```typescript
// lib/markup/matte.ts
// The opaque background rect that has to live INSIDE a Konva stage.
//
// A stage captured with `toDataURL({ mimeType: 'image/jpeg' })` encodes every transparent
// pixel as black, because JPEG has no alpha channel. A CSS background on the container div is
// therefore not enough: `toDataURL` reads the stage, which knows nothing about its container.

export interface MatteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** AnnotationCanvas. Matches the 3D viewer's own background (ModelViewerInner.tsx:605). */
export const CANVAS_MATTE = '#f0f0f0';

/** PDFKonvaViewer. Matches its existing `bg-gray-100` container. */
export const PDF_MATTE = '#f3f4f6';

const EMPTY: MatteRect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * A rect that covers the whole visible container, expressed in the stage's own coordinate
 * space.
 *
 * PDFKonvaViewer puts the zoom and pan on the `Stage` itself, so every layer inherits them and
 * a rect at `(0, 0, containerWidth, containerHeight)` would be scaled and translated away from
 * the viewport. Inverting the transform is what keeps the fill pinned to the screen while the
 * page moves under it.
 *
 * AnnotationCanvas has an untransformed stage and can pass `stageScale: 1`, `stagePos: {x:0,y:0}`,
 * which reduces this to the container rect.
 */
export function matteRectForStage({
  stagePos,
  stageScale,
  containerSize,
}: {
  stagePos: { x: number; y: number };
  stageScale: number;
  containerSize: { width: number; height: number };
}): MatteRect {
  if (!Number.isFinite(stageScale) || stageScale <= 0) return EMPTY;
  if (containerSize.width <= 0 || containerSize.height <= 0) return EMPTY;
  return {
    x: -stagePos.x / stageScale,
    y: -stagePos.y / stageScale,
    width: containerSize.width / stageScale,
    height: containerSize.height / stageScale,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/markupMatte.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/markup/matte.ts scripts/tests/markupMatte.test.mjs
git commit -m "feat(markup): in-stage matte rect that survives JPEG capture"
```

---

### Task 3: A throwaway harness route for visual verification

Every remaining task changes UI that cannot be asserted in `node --test`. The portal page needs a real database, a real portal and a real uploaded file, none of which exist locally. This task builds a route that mounts the markup surface directly, so the rest of the plan has somewhere to look. **Task 14 deletes it** — it must never reach `main`.

**Files:**
- Create: `app/portal/markup-harness/page.tsx`

**Interfaces:**
- Consumes: `AnnotationCanvas` and `DrawingTools` as they exist today.
- Produces: a local URL, `http://localhost:3000/portal/markup-harness`. No production code depends on this.

- [ ] **Step 1: Create the harness route**

The path matters. `middleware.ts` lets `/portal/…` through unauthenticated, and a static segment beats the `[id]` dynamic one, so this renders without a login or a database.

Create `app/portal/markup-harness/page.tsx`:

```tsx
'use client';

// THROWAWAY. Deleted in Task 14 of docs/superpowers/plans/2026-08-27-portal-markup-enhancements.md.
// Mounts the markup surface with a synthetic background so the annotation session can be driven
// without a database, an S3 bucket or an uploaded file.

import { useEffect, useRef, useState } from 'react';
import AnnotationCanvas, { type AnnotationCanvasHandle } from '@/components/markup/AnnotationCanvas';
import DrawingTools from '@/components/markup/DrawingTools';
import type { AnnTool } from '@/components/markup/useAnnotationObjects';

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect' | 'text' | 'eraser';

/** A deliberately non-square, dark-ish background: dark proves text legibility, non-square
 *  proves the matte, and the grid makes any letterbox seam obvious. */
function makeBackground(width: number, height: number): string {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, '#2b3350');
  g.addColorStop(1, '#6f7fa8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y <= height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.fillText(`${width} x ${height} background`, 24, 48);
  return c.toDataURL('image/jpeg', 0.92);
}

export default function MarkupHarnessPage() {
  const [bg, setBg] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('pointer');
  const [color, setColor] = useState('#FF6B6B');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [captured, setCaptured] = useState<string | null>(null);
  const surface = useRef<AnnotationCanvasHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 1200x700 is a different aspect ratio from the viewport below, which forces a letterbox on
  // purpose — that is the band that has to come out light grey instead of black.
  useEffect(() => { setBg(makeBackground(1200, 700)); }, []);

  return (
    <div className="h-screen flex flex-col gap-3 bg-stiko-app p-3">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) surface.current?.insertImage(f);
        }}
      />

      <div className="relative flex-1 overflow-hidden rounded-panel bg-white shadow-stiko-panel">
        <AnnotationCanvas
          backgroundDataUrl={bg}
          activeTool={activeTool as AnnTool}
          color={color}
          strokeWidth={strokeWidth}
          handleRef={surface}
          onObjectCreated={() => setActiveTool('pointer')}
        />
        <DrawingTools
          activeTool={activeTool}
          onToolChange={setActiveTool}
          color={color}
          onColorChange={setColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setStrokeWidth}
          tagging={false}
          onToggleTagging={() => {}}
          onInsertImage={() => fileInput.current?.click()}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setCaptured(surface.current?.captureSnapshot() ?? null)}
          className="rounded-chip bg-stiko-primary px-3 py-1.5 text-sm text-white"
        >
          Capture (whole stage)
        </button>
        <button
          onClick={() => setCaptured(surface.current?.captureSnapshot({ native: true }) ?? null)}
          className="rounded-chip border border-stiko-border-strong px-3 py-1.5 text-sm text-stiko-ink"
        >
          Capture (native crop)
        </button>
        <button
          onClick={() => { surface.current?.clear(); setCaptured(null); }}
          className="rounded-chip border border-stiko-border-strong px-3 py-1.5 text-sm text-stiko-ink"
        >
          Clear
        </button>
        <span className="text-sm text-stiko-secondary">
          tool: {activeTool} · colour: {color} · stroke: {strokeWidth}
        </span>
      </div>

      {/* The capture on black. Any transparent pixel that JPEG flattened shows up here. */}
      {captured && (
        <div className="h-64 flex-shrink-0 overflow-hidden rounded-panel bg-black p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={captured} alt="capture" className="h-full w-full object-contain" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Boot the app**

There is no `.env.local` in this checkout and you must not create one — it would shadow real config later. Supply the two vars inline. `DATABASE_URL` is needed even though this route never queries, because `middleware.ts` imports `lib/auth` → `lib/db`, which throws at module load when it is unset. `neon()` connects lazily, so a fake URL is fine.

In a terminal at the repository root:

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev
```

- [ ] **Step 3: Confirm the harness renders and reproduces the bug**

Open `http://localhost:3000/portal/markup-harness`.

Expected: the toolbar floats over a dark gradient background with grey bands above and below it (the 1200×700 background letterboxed into a wider viewport). Draw an arrow, then click **Capture (whole stage)**.

Expected in the capture strip: the drawn arrow over the gradient, with **black bands** where the grey bands were. That black is the bug this plan removes — confirm you can see it before continuing.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add app/portal/markup-harness/page.tsx
git commit -m "test(markup): throwaway harness route for markup verification"
```

---

### Task 4: Paint the matte inside both stages

Fixes cause B of the black border: the surround is CSS on the container, and `toDataURL` cannot see it.

**Files:**
- Modify: `components/markup/AnnotationCanvas.tsx` — the `bg-gray-900` container class, and the background `Layer`
- Modify: `components/viewers/PDFKonvaViewer.tsx` — the background `Layer`

**Interfaces:**
- Consumes: `matteRectForStage`, `CANVAS_MATTE`, `PDF_MATTE` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Add the matte rect to `AnnotationCanvas`**

In `components/markup/AnnotationCanvas.tsx`, add `Rect` to the react-konva import and the matte helpers:

```tsx
import { Stage, Layer, Rect, Image as KonvaImage } from 'react-konva';
import { CANVAS_MATTE } from '@/lib/markup/matte';
```

Replace the background layer (currently `<Layer listening={false}>` holding only the `KonvaImage`) with:

```tsx
<Layer listening={false}>
  {/* Inside the stage, not on the container: toDataURL reads the stage, and JPEG has no
      alpha, so any pixel this rect does not cover is encoded black. */}
  {backgroundDataUrl && <Rect x={0} y={0} width={size.width} height={size.height} fill={CANVAS_MATTE} />}
  {bgImage && bgFit && <KonvaImage image={bgImage} x={bgFit.x} y={bgFit.y} width={bgFit.width} height={bgFit.height} />}
</Layer>
```

The `backgroundDataUrl &&` guard preserves the existing contract: with no snapshot the surface must stay transparent so the live viewer shows through.

- [ ] **Step 2: Lighten the on-screen matte to match**

Still in `AnnotationCanvas.tsx`, the container currently reads:

```tsx
<div ref={containerRef} className={`absolute inset-0 ${backgroundDataUrl ? 'bg-gray-900' : 'bg-transparent'}`} style={{ cursor }}>
```

Replace it, and replace the comment above it:

```tsx
  // What is captured must be what was on screen, so the container matches the in-stage matte
  // rather than contrasting with it. With no snapshot, stay transparent and let the live
  // viewer (which the portal keeps visible in that case) show through.
  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ cursor, background: backgroundDataUrl ? CANVAS_MATTE : 'transparent' }}
    >
```

- [ ] **Step 3: Add the matte rect to `PDFKonvaViewer`**

In `components/viewers/PDFKonvaViewer.tsx`, add `Rect` to the react-konva import and the matte helpers:

```tsx
import { Stage, Layer, Rect, Image as KonvaImage, Text, Circle, Group } from 'react-konva';
import { matteRectForStage, PDF_MATTE } from '@/lib/markup/matte';
```

Immediately before the `return (` of the component body, derive the rect:

```tsx
    // The zoom and pan live on the Stage, so every layer inherits them — the fill has to be
    // expressed in page space or it scrolls away from the viewport with the page.
    const matte = matteRectForStage({ stagePos, stageScale, containerSize });
```

Then, as the **first child of the first `<Layer>` inside the `<Stage>`** (the layer holding the page `KonvaImage`), add:

```tsx
<Rect x={matte.x} y={matte.y} width={matte.width} height={matte.height} fill={PDF_MATTE} listening={false} />
```

- [ ] **Step 4: Verify in the browser**

With `npm run dev` still running from Task 3, reload `http://localhost:3000/portal/markup-harness`, draw an arrow, and click **Capture (whole stage)**.

Expected: the bands in the capture are now **light grey (#f0f0f0)**, not black. Against the black backing of the capture strip the difference is unmistakable. The bands are still there — Task 6 is what removes them from real sessions.

- [ ] **Step 5: Typecheck, test and commit**

```bash
npx tsc --noEmit
npm test
git add components/markup/AnnotationCanvas.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "fix(markup): paint the snapshot matte inside the stage, not on the container"
```

Expected: `pass 211` — 193 baseline, plus 11 from Task 1 and 7 from Task 2. If your count differs, re-read the two new test files rather than proceeding.

---

### Task 5: Extract the toolbar style constants

A pure refactor with no behaviour change, so the next task can build a pill that matches the toolbar exactly rather than approximating it.

**Files:**
- Create: `components/markup/toolbarStyles.ts`
- Modify: `components/markup/DrawingTools.tsx:119-142` — delete the local constants, import them instead

**Interfaces:**
- Consumes: nothing.
- Produces: `BAR`, `SUB_BAR`, `SLOT_BASE`, `LABEL`, `LABEL_ABOVE`, `slot(active: boolean): string`.

- [ ] **Step 1: Create the shared module**

Create `components/markup/toolbarStyles.ts`. `BAR`, `SUB_BAR`, `SLOT_BASE`, `slot` and `LABEL` are moved verbatim from `DrawingTools.tsx`; `LABEL_ABOVE` is new.

```typescript
// components/markup/toolbarStyles.ts
// The markup toolbar's visual recipe, shared so that anything floating over the viewport reads
// as part of one family rather than approximating it.

/** Bar and sub-bar share these, so a sub-toolbar is visually the main toolbar cut short. */
export const BAR =
  'flex items-center gap-[4px] h-[46px] px-[6px] rounded-sheet bg-white border border-stiko-border shadow-stiko-panel';

/** Hung off the button that opened it, clear of the bar's bottom edge. */
export const SUB_BAR = 'absolute top-full mt-[13px] left-1/2 -translate-x-1/2';

/**
 * Every slot in the bar: a tinted chip with a light grey edge that lifts off the bar on
 * hover. The scale is on the button and the label on the wrapper, so growing the chip never
 * drags the tooltip with it.
 */
export const SLOT_BASE =
  'relative flex h-[34px] w-[34px] items-center justify-center rounded-[11px] border transition-all duration-150 hover:scale-[1.12] hover:z-10 hover:shadow-[0_5px_12px_-3px_rgba(28,32,48,0.22)]';

export const slot = (active: boolean) =>
  `${SLOT_BASE} ${
    active
      ? 'border-stiko-primary-light bg-stiko-tint text-stiko-primary'
      : 'border-stiko-divider bg-[#F8EDFC]/60 text-stiko-secondary hover:bg-[#F8EDFC] hover:border-stiko-border-strong'
  }`;

const LABEL_BASE =
  'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[7px] bg-stiko-ink px-2 py-[3px] text-[11px] font-medium leading-none tracking-heading text-white opacity-0 shadow-stiko-sheet transition-opacity duration-100 group-hover:opacity-100';

/** For the toolbar, which sits at the top of the viewport — below is the side with room. */
export const LABEL = `${LABEL_BASE} top-full mt-[9px]`;

/** For the annotation pill, which sits at the bottom — above is the side with room. */
export const LABEL_ABOVE = `${LABEL_BASE} bottom-full mb-[9px]`;
```

- [ ] **Step 2: Point `DrawingTools` at it**

In `components/markup/DrawingTools.tsx`, delete the `BAR`, `SUB_BAR`, `SLOT_BASE`, `slot` and `LABEL` declarations (the block starting at the `/** Bar and sub-bar share these… */` comment and ending with the `LABEL = …` string, currently lines 119-142) along with their doc comments, since those moved with them. Add the import beside the existing ones at the top of the file:

```tsx
import { BAR, SUB_BAR, slot, LABEL } from './toolbarStyles';
```

Leave everything else — `ICON`, `px`, the icon constants, `SHAPE_TOOLS`, `STROKE_PRESETS`, `ToolButton` and the component — untouched.

- [ ] **Step 3: Verify nothing moved**

Reload `http://localhost:3000/portal/markup-harness`.

Expected: the toolbar is pixel-identical to before — same height, same chip size, same hover lift, same tooltips below the buttons. Open the Shapes and Stroke width sub-bars and confirm they still hang below their buttons. This task changes no rendered output; anything that looks different is a transcription error in Step 1.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/markup/toolbarStyles.ts components/markup/DrawingTools.tsx
git commit -m "refactor(markup): lift the toolbar style recipe into a shared module"
```

---

### Task 6: The floating annotation banner

Fixes cause A of the black border — the banner is a flex row that shrinks the viewer *after* the snapshot has been taken at the taller size — and replaces the off-language amber styling.

**Files:**
- Create: `components/markup/AnnotationBanner.tsx`
- Modify: `app/portal/[id]/page.tsx:886-909` — delete the banner row; mount the pill inside `viewerAreaRef`
- Modify: `app/portal/markup-harness/page.tsx` — mount the pill so it can be seen

**Interfaces:**
- Consumes: `BAR`, `SLOT_BASE`, `LABEL_ABOVE` from Task 5.
- Produces: `AnnotationBanner` — default export, props `{ annotatingFileName: string | null; onDiscard: () => void; onApply: () => void }`.

- [ ] **Step 1: Create the pill**

Create `components/markup/AnnotationBanner.tsx`:

```tsx
'use client';

import { BAR, SLOT_BASE, LABEL_ABOVE } from './toolbarStyles';

const CrossIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

const TickIcon = (
  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

/**
 * The two action chips. Same 34x34 geometry and hover lift as a toolbar slot, but each with its
 * own pastel rather than the toolbar's shared lilac — these commit and discard work, so they
 * should not read as another pair of tools.
 *
 * Tints are Tailwind arbitrary values rather than inline styles so hover stays in CSS. The
 * pastels are note-red and note-green from tailwind.config.ts, and the borders are the matching
 * status-chip tokens.
 */
const ACTION_TINTS = {
  discard: 'bg-[#FFE2E2]/60 hover:bg-[#FFE2E2] border-stiko-chip-red text-[#B23A52]',
  apply: 'bg-[#EDFFDA]/60 hover:bg-[#EDFFDA] border-stiko-chip-green text-[#4B7A28]',
} as const;

function ActionButton({
  label,
  tint,
  onClick,
  children,
}: {
  label: string;
  tint: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        aria-label={label}
        onClick={onClick}
        // SLOT_BASE carries the geometry and the hover lift; the tint supplies the colours that
        // slot() would otherwise apply as lilac.
        className={`${SLOT_BASE} ${tint}`}
      >
        {children}
      </button>
      <span className={LABEL_ABOVE}>{label}</span>
    </div>
  );
}

/**
 * The "you are marking up" indicator, as a pill floating over the bottom of the viewport.
 *
 * It floats rather than occupying a row for a reason that is not cosmetic: a row above the
 * viewer shrinks it the moment a session starts, but the snapshot behind the session was
 * captured a tick earlier at the taller size. The mismatched aspect ratio then letterboxes,
 * and those transparent bands encode black in the JPEG. Floating keeps the viewer one size.
 *
 * It cannot appear in a capture: `captureViewerSnapshot` reads the <canvas> element and
 * `stage.toDataURL()` reads the Konva stage. Neither sees sibling DOM.
 */
export default function AnnotationBanner({
  annotatingFileName,
  onDiscard,
  onApply,
}: {
  annotatingFileName: string | null;
  onDiscard: () => void;
  onApply: () => void;
}) {
  return (
    <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 select-none">
      <div className={BAR}>
        <span className="flex items-center gap-2 pl-[6px] pr-[10px] text-[14px] leading-none tracking-heading text-stiko-secondary">
          <span className="inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-stiko-primary" />
          {annotatingFileName !== null ? (
            <span>
              Marking up <span className="font-semibold text-stiko-ink">{annotatingFileName}</span> — applying replaces the attachment
            </span>
          ) : (
            <span>Marking up — apply to attach it to your comment</span>
          )}
        </span>

        <div className="mr-[6px] h-[24px] w-px bg-stiko-divider" />

        <ActionButton label="Discard" tint={ACTION_TINTS.discard} onClick={onDiscard}>
          {CrossIcon}
        </ActionButton>
        <ActionButton label="Apply" tint={ACTION_TINTS.apply} onClick={onApply}>
          {TickIcon}
        </ActionButton>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the banner row in the portal page**

In `app/portal/[id]/page.tsx`, add the import beside the other markup imports:

```tsx
import AnnotationBanner from '@/components/markup/AnnotationBanner';
```

Delete the entire banner block — the `{/* Annotation mode banner */}` comment and the `{annotating && ( … )}` expression that follows it (currently lines 886-909), which sits between the opening of the centre panel `<div className="flex flex-col gap-3 min-h-0 overflow-hidden">` and the `<div ref={viewerAreaRef} …>`.

Then, **inside** `viewerAreaRef`, immediately after the closing tag of the `{annotating && drawsOnCanvas && ( <AnnotationCanvas … /> )}` block and before the `{viewportImage && (` block, add:

```tsx
            {/* Floats rather than taking a row: a row would shrink the viewer after the
                snapshot behind this session was already captured at the taller size, and the
                resulting letterbox is the black border in the saved JPEG. Being DOM, it is
                invisible to the capture. */}
            {annotating && (
              <AnnotationBanner
                annotatingFileName={annotatingFile?.name ?? null}
                onDiscard={handleAnnotationDiscard}
                onApply={handleAnnotationDone}
              />
            )}
```

- [ ] **Step 3: Mount it in the harness too**

In `app/portal/markup-harness/page.tsx`, add the import:

```tsx
import AnnotationBanner from '@/components/markup/AnnotationBanner';
```

and add it inside the `relative flex-1` viewport div, immediately after `<DrawingTools … />`:

```tsx
        <AnnotationBanner
          annotatingFileName={null}
          onDiscard={() => { surface.current?.clear(); setCaptured(null); }}
          onApply={() => setCaptured(surface.current?.captureSnapshot() ?? null)}
        />
```

- [ ] **Step 4: Verify the pill**

Reload `http://localhost:3000/portal/markup-harness`.

Expected: a white pill at the bottom centre of the viewport with the same height, radius, border and shadow as the toolbar at the top. A pulsing indigo dot, 14px grey text reading "Marking up — apply to attach it to your comment", a divider, then a red ✕ and a green ✓ at the toolbar's chip size. Hovering either lifts it and shows its label **above** the button. Hovering deepens the tint.

- [ ] **Step 5: Verify the letterbox is gone from a real session**

The harness cannot prove this — its background is deliberately the wrong aspect ratio. This needs the portal page, and the portal page needs a database, so verify it by reasoning against the diff instead:

Confirm by reading `app/portal/[id]/page.tsx` that the centre panel's children are now exactly the `{annotating && …}` banner **inside** `viewerAreaRef`, and that no sibling of `viewerAreaRef` is conditional on `annotating`. Run:

```bash
grep -n "annotating" "app/portal/[id]/page.tsx" | grep -v viewerAreaRef
```

Expected: no match reports a `className` containing `flex-shrink-0`, and no match sits between the centre-panel `<div className="flex flex-col gap-3 …">` and `<div ref={viewerAreaRef}`. That is what guarantees the viewer's height no longer depends on `annotating`.

- [ ] **Step 6: Typecheck, test and commit**

```bash
npx tsc --noEmit
npm test
git add components/markup/AnnotationBanner.tsx "app/portal/[id]/page.tsx" app/portal/markup-harness/page.tsx
git commit -m "fix(markup): float the annotation banner so a session never resizes the viewer"
```

---

### Task 7: Text and style in the object model

**Files:**
- Modify: `components/markup/useAnnotationObjects.ts`

**Interfaces:**
- Consumes: `fontSizeForStrokeWidth`, `strokeWidthForFontSize`, `MIN_FONT_SIZE` from Task 1.
- Produces, on the object returned by `useAnnotationObjects()`:
  - `addText(p: { x: number; y: number }, opts: { text?: string; color: string; fontSize: number; width: number }): string` — **always creates and always returns the id**, empty text included. Breaking change to the old signature.
  - `updateText(id: string, text: string): void`
  - `applyStyle(id: string, patch: { color?: string; strokeWidth?: number }): void`
  - `bakeTextTransform(id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }): void`
  - `selectedObject: AnnotationObject | null`

- [ ] **Step 1: Add the import**

At the top of `components/markup/useAnnotationObjects.ts`:

```typescript
import { fontSizeForStrokeWidth, strokeWidthForFontSize, MIN_FONT_SIZE } from '@/lib/markup/text';
```

- [ ] **Step 2: Replace `addText`**

Replace the whole existing `addText` callback with:

```typescript
  /**
   * Creates the text object *before* anything is typed, so the editor can be bound to a real
   * object and every keystroke can write through to it. That is what puts the text where it
   * will land rather than in a popup somewhere else — and it is why this no longer rejects
   * empty text. Discarding a blank box is the caller's job, on commit.
   */
  const addText = useCallback(
    (p: { x: number; y: number }, opts: { text?: string; color: string; fontSize: number; width: number }): string => {
      const o = base('text', opts.color, strokeWidthForFontSize(opts.fontSize));
      o.x = p.x;
      o.y = p.y;
      o.text = opts.text ?? '';
      o.fontSize = opts.fontSize;
      o.width = opts.width;
      setObjects((prev) => [...prev, o]);
      setSelectedId(o.id);
      return o.id;
    },
    []
  );
```

- [ ] **Step 3: Add the three new mutators**

Immediately after `updateObject`, add:

```typescript
  /** Write-through from the text editor. Separate from updateObject so the editor cannot
   *  accidentally clobber geometry it does not own. */
  const updateText = useCallback((id: string, text: string) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, text } : o)));
  }, []);

  /**
   * Restyle an existing object. The type decides what a stroke width means: on text it is a
   * font size, on an image it means nothing at all.
   */
  const applyStyle = useCallback((id: string, patch: { color?: string; strokeWidth?: number }) => {
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id || o.type === 'image') return o;
        const next = { ...o };
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.strokeWidth !== undefined) {
          next.strokeWidth = patch.strokeWidth;
          if (o.type === 'text') next.fontSize = fontSizeForStrokeWidth(patch.strokeWidth);
        }
        return next;
      })
    );
  }, []);

  /**
   * Folds a text object's transform scale into its font size and wrap width, resetting the
   * scale to 1.
   *
   * Without this the Transformer's scaleX/scaleY would multiply against the font-size presets:
   * a box dragged to 2x and then set to "Thick" would render at 68px rather than 34px. Baking
   * keeps the presets absolute. strokeWidth follows the new size so the toolbar highlights the
   * right chip after a manual resize.
   */
  const bakeTextTransform = useCallback(
    (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => {
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          const fontSize = Math.max(MIN_FONT_SIZE, o.fontSize * t.scaleY);
          return {
            ...o,
            x: t.x,
            y: t.y,
            rotation: t.rotation,
            scaleX: 1,
            scaleY: 1,
            fontSize,
            width: Math.max(1, o.width * t.scaleX),
            strokeWidth: strokeWidthForFontSize(fontSize),
          };
        })
      );
    },
    []
  );
```

- [ ] **Step 4: Expose the selected object and the new mutators**

Just above the `return` at the end of the hook, add:

```typescript
  // Derived rather than stored, so it can never disagree with `objects`. Consumers must depend
  // on its FIELDS, not its identity — `find` returns a fresh reference on every render.
  const selectedObject = objects.find((o) => o.id === selectedId) ?? null;
```

and replace the return statement with:

```typescript
  return {
    objects, draft, selectedId, setSelectedId, selectedObject,
    startDraw, moveDraw, endDraw, addText, addImage,
    updateObject, updateText, applyStyle, bakeTextTransform,
    deleteObject, clear, hasObjects,
  };
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

Expected: **two errors**, both "Expected 4-5 arguments, but got 4" style mismatches on the old `ann.addText(...)` calls in `components/markup/AnnotationCanvas.tsx` and `components/viewers/PDFKonvaViewer.tsx`. That is the signature change announcing its call sites; Tasks 10 and 11 replace both. Do not patch them here.

- [ ] **Step 6: Commit**

The tree does not typecheck on its own at this point, which is why this task and the next two are one unit of work for a reviewer even though they commit separately.

```bash
git add components/markup/useAnnotationObjects.ts
git commit -m "feat(markup): create text objects empty, and let style be edited after the fact"
```

---

### Task 8: Wrapping, hiding and re-editing in the renderer

**Files:**
- Modify: `components/markup/AnnotationObjects.tsx`

**Interfaces:**
- Consumes: `TEXT_FONT_FAMILY` from Task 1; `bakeTextTransform` from Task 7.
- Produces: two new props on `AnnotationObjects` —
  - `editingId?: string | null`
  - `onEditText?: (id: string) => void`
  - `onBakeText?: (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => void`

- [ ] **Step 1: Extend the props**

In `components/markup/AnnotationObjects.tsx`, add the import:

```tsx
import { TEXT_FONT_FAMILY } from '@/lib/markup/text';
```

and extend the interface:

```tsx
interface AnnotationObjectsProps {
  objects: AnnotationObject[];
  draft: AnnotationObject | null;
  selectedId: string | null;
  activeTool: AnnTool;
  onSelect: (id: string) => void;
  onErase: (id: string) => void;
  onChange: (id: string, patch: Partial<AnnotationObject>) => void;
  /** The text object currently open in the editor. Its Konva node is hidden so the glyphs are
   *  not drawn twice at slightly different rasterisations. */
  editingId?: string | null;
  /** Double-click on a committed text object, with the pointer tool active. */
  onEditText?: (id: string) => void;
  /** Text transforms bake their scale instead of storing it — see bakeTextTransform. */
  onBakeText?: (id: string, t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) => void;
}
```

and the destructure:

```tsx
export default function AnnotationObjects({ objects, draft, selectedId, activeTool, onSelect, onErase, onChange, editingId = null, onEditText, onBakeText }: AnnotationObjectsProps) {
```

- [ ] **Step 2: Keep the Transformer off the node being edited**

Replace the Transformer binding effect with:

```tsx
  // Bind the Transformer to the selected node — unless that node is open in the text editor,
  // where resize handles would fight the caret and sit over the textarea.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const stage = tr.getStage();
    const editing = selectedId !== null && selectedId === editingId;
    const node = selectedId && stage && !editing ? stage.findOne(`#${selectedId}`) : null;
    tr.nodes(node ? [node as Konva.Node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, objects, activeTool, imgLoadTick, editingId]);
```

- [ ] **Step 3: Route text transforms through the bake**

In `renderObj`, replace the `onTransformEnd` entry of `common` with:

```tsx
      onTransformEnd: isDraft ? undefined : (e: Konva.KonvaEventObject<Event>) => {
        const n = e.target;
        const t = { x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() };
        if (obj.type === 'text' && onBakeText) {
          // Reset on the node as well as in state: React re-renders a frame later, and without
          // this the text visibly springs to double size and back.
          n.scaleX(1);
          n.scaleY(1);
          onBakeText(obj.id, t);
        } else {
          onChange(obj.id, t);
        }
      },
```

- [ ] **Step 4: Render text with a wrap width, hidden while edited**

Replace the `case 'text':` branch with:

```tsx
      case 'text':
        return (
          <Text
            key={obj.id}
            {...common}
            text={obj.text}
            fontSize={obj.fontSize}
            fontFamily={TEXT_FONT_FAMILY}
            fill={obj.color}
            fontStyle="bold"
            // The same number the editor wrapped at, so committing does not reflow the text.
            width={obj.width > 0 ? obj.width : undefined}
            wrap="word"
            visible={editingId !== obj.id}
            onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              if (isDraft || activeTool !== 'pointer' || !onEditText) return;
              e.cancelBubble = true;
              onEditText(obj.id);
            }}
            onDblTap={(e: Konva.KonvaEventObject<Event>) => {
              if (isDraft || activeTool !== 'pointer' || !onEditText) return;
              e.cancelBubble = true;
              onEditText(obj.id);
            }}
          />
        );
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

Expected: the same two `addText` errors from Task 7 and nothing new. The new props are all optional, so no existing call site breaks.

- [ ] **Step 6: Commit**

```bash
git add components/markup/AnnotationObjects.tsx
git commit -m "feat(markup): wrap text at a stored width and hide it while it is being edited"
```

---

### Task 9: `CanvasTextEditor`

**Files:**
- Create: `components/markup/CanvasTextEditor.tsx`

**Interfaces:**
- Consumes: `TEXT_FONT_FAMILY` from Task 1.
- Produces: `CanvasTextEditor` — default export, props
  `{ x: number; y: number; scale: number; color: string; fontSize: number; wrapWidth: number; value: string; onChange: (text: string) => void; onCommit: () => void }`.
  `x`/`y` are **screen pixels within the surface container** — the caller does the mapping. `fontSize` and `wrapWidth` are in **object space**; the editor multiplies them by `scale`.

There is no `onCancel`. Escape commits (a blank commit discards), which is the whole of the agreed gesture set.

- [ ] **Step 1: Write the component**

Create `components/markup/CanvasTextEditor.tsx`:

```tsx
'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { TEXT_FONT_FAMILY } from '@/lib/markup/text';

/**
 * A borderless textarea sitting exactly where the Konva text node is, so markup text is typed
 * where it will land rather than in a popup somewhere else.
 *
 * Konva has no text input primitive, and rendering a caret onto the canvas would mean
 * reimplementing caret movement, selection, wrapping, clipboard and IME composition. Overlaying
 * a real form control gets all of that from the browser. The cost is that the overlay has to
 * mirror the stage transform, which is what `scale` is for — 1 on the unscaled AnnotationCanvas,
 * the current zoom on PDFKonvaViewer.
 *
 * The marquee is drawn with `outline`, not `border`: outlines sit outside the box model, so the
 * dashed edge cannot shift the text by a pixel relative to the Konva node it is standing in for.
 */
export default function CanvasTextEditor({
  x,
  y,
  scale,
  color,
  fontSize,
  wrapWidth,
  value,
  onChange,
  onCommit,
}: {
  x: number;
  y: number;
  scale: number;
  color: string;
  fontSize: number;
  wrapWidth: number;
  value: string;
  onChange: (text: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Commit stays in a ref so the listeners below can be bound once, on mount. Re-binding a
  // document-level pointerdown handler on every keystroke risks the handler that closes the
  // editor being attached during the very click that is supposed to close it.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // Focus with the caret at the end — the re-edit path opens on existing text, and landing the
  // caret at the start there would make appending feel broken.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow to fit. Height is reset to auto first, or scrollHeight only ever ratchets upward and
  // the box never shrinks back when text is deleted.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, fontSize, wrapWidth, scale]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) commitRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        commitRef.current();
      }
    };
    // Capture phase: the surface's own stage handlers must not act on the click that closed the
    // editor before the editor has seen it.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const displayFontSize = fontSize * scale;

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // Enter inserts a newline. Nothing here commits — that is clicking away or Escape.
      onKeyDown={(e) => e.stopPropagation()}
      spellCheck={false}
      className="absolute z-40 resize-none overflow-hidden"
      style={{
        left: x,
        top: y,
        width: wrapWidth * scale,
        color,
        // Matched to the Konva Text node: same family, same weight, lineHeight 1, no padding.
        // Any divergence here and the text jumps at the moment it is committed.
        fontFamily: TEXT_FONT_FAMILY,
        fontWeight: 'bold',
        fontSize: displayFontSize,
        lineHeight: 1,
        padding: 0,
        margin: 0,
        border: 'none',
        background: 'rgba(255,255,255,0.10)',
        outline: `1px dashed ${color}`,
        outlineOffset: 3,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
      }}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: only the two known `addText` errors from Task 7, both in files this task does not touch.

- [ ] **Step 3: Commit**

```bash
git add components/markup/CanvasTextEditor.tsx
git commit -m "feat(markup): in-place text editor overlaid on the konva text node"
```

---

### Task 10: In-place text on `AnnotationCanvas`

**Files:**
- Modify: `components/markup/AnnotationCanvas.tsx` — delete the popup, mount the editor

**Interfaces:**
- Consumes: Tasks 1, 7, 8, 9.
- Produces: no signature change to `AnnotationCanvasHandle`.

- [ ] **Step 1: Swap the imports**

In `components/markup/AnnotationCanvas.tsx`, add:

```tsx
import CanvasTextEditor from './CanvasTextEditor';
import { fontSizeForStrokeWidth, wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

- [ ] **Step 2: Replace the popup state with an editing id**

Delete these two lines:

```tsx
  const [textPopup, setTextPopup] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');
```

and put in their place:

```tsx
  // The text object currently open for editing. The object itself already exists in `ann` —
  // this is only which one the editor is bound to.
  const [editingId, setEditingId] = useState<string | null>(null);
```

- [ ] **Step 3: Create the object on click and open the editor**

In `handleMouseDown`, replace the text branch:

```tsx
    if (activeTool === 'text') {
      const id = ann.addText(p, {
        text: '',
        color,
        fontSize: fontSizeForStrokeWidth(strokeWidth),
        // The fitted background region, not the stage: the wrap width must not depend on how
        // much matte happens to surround the snapshot.
        width: wrapWidthForContent(bgFit ? bgFit.width : size.width),
      });
      setEditingId(id);
      // Return to the pointer immediately. Otherwise the click that commits this box would also
      // start another one, since the text tool would still be armed.
      onObjectCreated?.();
      return;
    }
```

- [ ] **Step 4: Replace `submitText` with a commit that discards blanks**

Delete the `submitText` function and put in its place:

```tsx
  const editingObj = editingId ? ann.objects.find((o) => o.id === editingId) ?? null : null;

  /** Blank in, nothing out — an empty box is a mis-click, not an object. */
  const commitText = () => {
    if (editingObj && isBlank(editingObj.text)) {
      ann.deleteObject(editingObj.id);
    }
    setEditingId(null);
  };
```

- [ ] **Step 5: Close the editor when the session ends**

The imperative `clear()` is what `endSession` calls on discard, and a half-typed box must go with it. Replace the `clear` entry of the imperative handle:

```tsx
    clear: () => { setEditingId(null); ann.clear(); },
```

Also make the edited node visible again before a capture. Replace the first lines of `captureSnapshot`:

```tsx
    captureSnapshot: (opts) => {
      const stage = stageRef.current;
      if (!stage) return null;
      // A capture while the editor is open would otherwise lose that object: its Konva node is
      // hidden (`visible={editingId !== obj.id}`) so the textarea can stand in for it, and
      // `setEditingId(null)` is a React state update that will not have been applied by the
      // time toDataURL runs on the next line. Un-hide the node directly instead.
      if (editingId) (stage.findOne(`#${editingId}`) as Konva.Node | undefined)?.visible(true);
      setEditingId(null);
      stage.find('Transformer').forEach((t) => (t as Konva.Transformer).nodes([]));
      stage.draw();
```

> The textarea itself is DOM, so it never reaches a canvas capture — the marquee outline cannot be baked into a snapshot and needs no handling here. The only thing at risk is the Konva node the editor is standing in for.
>
> In today's flows a capture cannot actually begin mid-edit: Apply lives on the banner, and pointer-down anywhere outside the textarea commits the editor a full event earlier. This is defence against that coupling quietly changing — a snapshot silently missing the text the user just typed is the kind of failure nobody notices until a comment is already posted.

- [ ] **Step 6: Pass the new props to `AnnotationObjects` and mount the editor**

Extend the `<AnnotationObjects … />` element with:

```tsx
              editingId={editingId}
              onEditText={setEditingId}
              onBakeText={ann.bakeTextTransform}
```

Then delete the entire `{textPopup && ( … )}` JSX block and put in its place:

```tsx
      {editingObj && (
        <CanvasTextEditor
          // Keyed by the object so a different text block gets a FRESH editor. The mount
          // effect that focuses and puts the caret at the end runs once per mount.
          //
          // The path this guards is CREATE, not re-edit: clicking to start a new box while an
          // editor is already open fires the document pointerdown that commits the old one and
          // the Konva mousedown that creates the new one in the same task, so React 18 batches
          // them and `editingId` can go straight from one id to another with no null render in
          // between. (A real double-click re-edit already passes through null, a full event
          // earlier.) Without the key the instance would be reused and open unfocused.
          key={editingObj.id}
          // The stage is untransformed here, so object space is screen space.
          x={editingObj.x}
          y={editingObj.y}
          scale={1}
          color={editingObj.color}
          fontSize={editingObj.fontSize}
          wrapWidth={editingObj.width}
          value={editingObj.text}
          onChange={(t) => ann.updateText(editingObj.id, t)}
          onCommit={commitText}
        />
      )}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`

Expected: **one** error remaining — the `addText` call in `components/viewers/PDFKonvaViewer.tsx`. Task 11 fixes it.

- [ ] **Step 8: Verify in the browser**

Reload `http://localhost:3000/portal/markup-harness`, pick the **Text** tool, click on the background.

Expected, in order:
1. A dashed box appears at the click point with a blinking caret, and the toolbar returns to Pointer.
2. Typing shows the glyphs **inside that box**, at the toolbar colour, at the size the stroke preset implies. No popup appears anywhere.
3. Keep typing past the box width: the text **wraps to a second line and the box grows downward**. Nothing scrolls out of sight.
4. Press Enter: a new line, the box grows. The text is not committed.
5. Click elsewhere on the background: the dashed box disappears and the text stays, in the same position, same size, **without reflowing**.
6. Press the Text tool, click, type nothing, click away: no object is left behind.
7. Double-click the committed text: the dashed box returns with the caret at the end. Type more, click away — the addition is kept.
8. Click **Capture (whole stage)**: the text is in the capture, with no dashed outline.

- [ ] **Step 9: Commit**

```bash
git add components/markup/AnnotationCanvas.tsx
git commit -m "feat(markup): type text in place on the annotation canvas"
```

---

### Task 11: In-place text on `PDFKonvaViewer`

The same change, with the one difference that makes it a separate task: this stage is zoomed and panned, so object space and screen space differ.

**Files:**
- Modify: `components/viewers/PDFKonvaViewer.tsx`

**Interfaces:**
- Consumes: Tasks 1, 7, 8, 9.
- Produces: no signature change to `PDFKonvaViewerHandle`.

- [ ] **Step 1: Swap the imports**

```tsx
import CanvasTextEditor from '@/components/markup/CanvasTextEditor';
import { fontSizeForStrokeWidth, wrapWidthForContent, isBlank } from '@/lib/markup/text';
```

- [ ] **Step 2: Replace the popup state**

Delete:

```tsx
    const [textPopup, setTextPopup] = useState<{ px: number; py: number; sx: number; sy: number } | null>(null);
    const [textInput, setTextInput] = useState('');
```

and put in their place:

```tsx
    const [editingId, setEditingId] = useState<string | null>(null);
```

- [ ] **Step 3: Create the object on click**

In `handleStageMouseDown`, replace the text branch:

```tsx
      if (activeTool === 'text') {
        const id = ann.addText(coords, {
          text: '',
          color,
          fontSize: fontSizeForStrokeWidth(strokeWidth),
          // The page's own width, not the stage's: the stage width changes with the zoom, and a
          // zoom-dependent wrap would reflow committed text on every scroll.
          width: wrapWidthForContent(pageSize.width),
        });
        setEditingId(id);
        onObjectCreated?.();
        return;
      }
```

Add `pageSize.width` to that callback's dependency array — it currently ends `}, [tagging, annotating, activeTool, getPageCoords, toPercent, onCommentPlace, currentPage, color, strokeWidth, ann]);`, so make it:

```tsx
    }, [tagging, annotating, activeTool, getPageCoords, toPercent, onCommentPlace, currentPage, color, strokeWidth, ann, pageSize.width, onObjectCreated]);
```

- [ ] **Step 4: Replace `submitText`**

Delete the `submitText` callback and put in its place:

```tsx
    const editingObj = editingId ? ann.objects.find((o) => o.id === editingId) ?? null : null;

    const commitText = useCallback(() => {
      const obj = editingId ? ann.objects.find((o) => o.id === editingId) : null;
      if (obj && isBlank(obj.text)) ann.deleteObject(obj.id);
      setEditingId(null);
    }, [editingId, ann]);
```

- [ ] **Step 5: Close the editor on clear and on capture**

Replace the `clearDrawings` entry of the imperative handle:

```tsx
      clearDrawings: () => { setEditingId(null); ann.clear(); },
```

and do the same in `captureSnapshot`, right after the null check — including un-hiding the node the editor is standing in for, for the reason given in Task 10 Step 5:

```tsx
      captureSnapshot: () => {
        const stage = stageRef.current;
        if (!stage) return null;
        // See Task 10 Step 5: the edited object's node is hidden, and setEditingId is a state
        // update that will not have applied by the time toDataURL runs below.
        if (editingId) (stage.findOne(`#${editingId}`) as Konva.Node | undefined)?.visible(true);
        setEditingId(null);
        stage.find('Transformer').forEach((t) => (t as Konva.Transformer).nodes([]));
        stage.draw();
```

- [ ] **Step 6: Pass the new props and mount the editor**

Find the `<AnnotationObjects … />` element inside the drawing `<Layer>` and add:

```tsx
                editingId={editingId}
                onEditText={setEditingId}
                onBakeText={ann.bakeTextTransform}
```

Delete the `{textPopup && ( … )}` JSX block. Mount the editor **inside the canvas container div** (the one with `ref={containerRef}` and `className="flex-1 overflow-hidden bg-gray-100 relative"`), as its last child, so the editor is positioned relative to the same box the stage fills:

```tsx
          {editingObj && (
            <CanvasTextEditor
              // Keyed by the object — see the note on the same line in Task 10 Step 6.
              key={editingObj.id}
              // Page space -> screen space. The Stage carries the zoom and the pan, so the
              // overlay has to apply them by hand to sit on top of the node it stands in for.
              x={editingObj.x * stageScale + stagePos.x}
              y={editingObj.y * stageScale + stagePos.y}
              scale={stageScale}
              color={editingObj.color}
              fontSize={editingObj.fontSize}
              wrapWidth={editingObj.width}
              value={editingObj.text}
              onChange={(t) => ann.updateText(editingObj.id, t)}
              onCommit={commitText}
            />
          )}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: **clean, no errors.** This is the first point since Task 7 that the whole tree typechecks.

- [ ] **Step 8: Verify against a real PDF**

The harness does not cover the PDF surface. Confirm the arithmetic by reading the diff instead: the editor's `x`/`y` apply exactly the inverse of `getPageCoords`, which computes `(pointer - stagePos) / stageScale`. Check the two are inverses:

```bash
grep -n "pointer.x - stagePos.x) / stageScale\|editingObj.x \* stageScale + stagePos.x" components/viewers/PDFKonvaViewer.tsx
```

Expected: both lines present. `(p - pos)/s` and `x*s + pos` are inverses, so a box opens exactly under the cursor at any zoom.

Full interactive verification of this surface happens in Task 14 against a real portal, and is listed there.

- [ ] **Step 9: Test and commit**

```bash
npm test
git add components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(markup): type text in place on the pdf surface"
```

Expected: `pass 211`.

---

### Task 12: Style edits reach the selection

**Files:**
- Modify: `components/markup/AnnotationCanvas.tsx` — handle + `onSelectionChange`
- Modify: `components/viewers/PDFKonvaViewer.tsx` — handle + `onSelectionChange`

**Interfaces:**
- Consumes: `applyStyle`, `selectedObject` from Task 7.
- Produces:
  - `interface MarkupSelection { type: AnnotationObjectType; color: string; strokeWidth: number }` — exported from `components/markup/useAnnotationObjects.ts`
  - `applyStyleToSelection(patch: { color?: string; strokeWidth?: number }): void` on both `AnnotationCanvasHandle` and `PDFKonvaViewerHandle`
  - `onSelectionChange?: (selection: MarkupSelection | null) => void` prop on both surfaces

- [ ] **Step 1: Export the selection shape**

At the end of `components/markup/useAnnotationObjects.ts`, after the `AnnotationObject` interface, add:

```typescript
/** What a surface reports upward about its selection, so the toolbar can reflect it. */
export interface MarkupSelection {
  type: AnnotationObjectType;
  color: string;
  strokeWidth: number;
}
```

- [ ] **Step 2: Add the handle method and the callback to `AnnotationCanvas`**

Extend the handle interface:

```tsx
export interface AnnotationCanvasHandle {
  captureSnapshot: (opts?: { native?: boolean }) => string | null;
  clear: () => void;
  hasObjects: () => boolean;
  insertImage: (file: File) => void;
  /** Restyle whatever is selected. A no-op with nothing selected. */
  applyStyleToSelection: (patch: { color?: string; strokeWidth?: number }) => void;
}
```

Extend the props interface with:

```tsx
  onSelectionChange?: (selection: MarkupSelection | null) => void;
```

and the import and destructure:

```tsx
import { useAnnotationObjects, type AnnTool, type MarkupSelection } from './useAnnotationObjects';
```

```tsx
export default function AnnotationCanvas({ backgroundDataUrl, activeTool, color, strokeWidth, handleRef, onObjectCreated, onSelectionChange }: AnnotationCanvasProps) {
```

Add to the imperative handle object, after `insertImage`:

```tsx
    applyStyleToSelection: (patch) => {
      if (ann.selectedId) ann.applyStyle(ann.selectedId, patch);
    },
```

- [ ] **Step 3: Report the selection upward without looping**

Add this effect after the existing effects in `AnnotationCanvas`:

```tsx
  // Depend on the FIELDS, never on `sel` itself: `selectedObject` is derived with `find`, so it
  // is a fresh object every render. Depending on its identity would fire this effect on every
  // render, push state up to the portal page, and re-render forever.
  //
  // The same loop exists from the other end: `onSelectionChange` is in this dependency array,
  // so the caller MUST pass a `useCallback`-stable reference. An inline arrow function there
  // re-subscribes this effect on every render and reintroduces exactly the same cycle.
  const sel = ann.selectedObject;
  const selType = sel?.type ?? null;
  const selColor = sel?.color ?? null;
  const selStroke = sel?.strokeWidth ?? null;
  useEffect(() => {
    onSelectionChange?.(
      selType !== null && selColor !== null && selStroke !== null
        ? { type: selType, color: selColor, strokeWidth: selStroke }
        : null
    );
  }, [selType, selColor, selStroke, onSelectionChange]);
```

- [ ] **Step 4: Do the same on `PDFKonvaViewer`**

Extend the handle interface:

```tsx
export interface PDFKonvaViewerHandle {
  captureSnapshot: () => string | null;
  getCurrentPage: () => number;
  clearDrawings: () => void;
  hasObjects: () => boolean;
  insertImage: (file: File) => void;
  applyStyleToSelection: (patch: { color?: string; strokeWidth?: number }) => void;
}
```

Extend the props interface with `onSelectionChange?: (selection: MarkupSelection | null) => void;`, add it to the destructured parameter list, and extend the import:

```tsx
import { useAnnotationObjects, type AnnTool, type MarkupSelection } from '@/components/markup/useAnnotationObjects';
```

Add to the imperative handle, after `insertImage`:

```tsx
      applyStyleToSelection: (patch) => {
        if (ann.selectedId) ann.applyStyle(ann.selectedId, patch);
      },
```

and add the identical effect from Step 3 to this component.

- [ ] **Step 5: Verify in the browser**

Reload `http://localhost:3000/portal/markup-harness`.

Expected: nothing changes yet — the toolbar is not wired to these methods until Task 13. Confirm no regression: draw an arrow, a rectangle and a freehand stroke; select each with the pointer; drag, resize and rotate each; press Delete. All still work. Type a text box, select it, resize it with a corner handle, and confirm it scales smoothly and does not spring back.

- [ ] **Step 6: Typecheck, test and commit**

```bash
npx tsc --noEmit
npm test
git add components/markup/useAnnotationObjects.ts components/markup/AnnotationCanvas.tsx components/viewers/PDFKonvaViewer.tsx
git commit -m "feat(markup): expose selection style and restyling on both surfaces"
```

---

### Task 13: A selection-aware toolbar

**Files:**
- Modify: `components/markup/DrawingTools.tsx` — a `selectionType` prop; the stroke picker becomes a text-size picker for text
- Modify: `app/portal/[id]/page.tsx` — route colour/width to the selection, and the selection back to the toolbar
- Modify: `app/portal/markup-harness/page.tsx` — wire the same, so it can be verified

**Interfaces:**
- Consumes: `applyStyleToSelection`, `onSelectionChange`, `MarkupSelection` from Task 12; `STROKE_PRESETS` from Task 1.
- Produces: `selectionType?: AnnotationObjectType | null` prop on `DrawingTools`.

- [ ] **Step 1: Teach `DrawingTools` about the selection**

In `components/markup/DrawingTools.tsx`, add the import:

```tsx
import type { AnnotationObjectType } from './useAnnotationObjects';
```

Add to `DrawingToolsProps`:

```tsx
  /** Type of the currently selected markup object, or null. The stroke picker reads this to
   *  decide whether it is presenting stroke weights or text sizes — there is no other way for
   *  the toolbar to know what kind of object a width would be applied to. */
  selectionType?: AnnotationObjectType | null;
```

Add `selectionType = null,` to the destructured parameter list.

Replace the `STROKE_PRESETS` constant with both labellings:

```tsx
const STROKE_PRESETS = [
  { value: 2, label: 'Thin', textLabel: 'Small' },
  { value: 4, label: 'Medium', textLabel: 'Medium' },
  { value: 6, label: 'Thick', textLabel: 'Large' },
];

/** Glyph heights for the text-size variant of the picker, index-aligned with STROKE_PRESETS. */
const TEXT_PREVIEW_SIZES = [10, 13, 16];
```

Inside the component, just before the `return`, add:

```tsx
  // Width means font size on a text object, so the picker relabels rather than lying about it.
  const strokeIsTextSize = selectionType === 'text';
```

Change the stroke width `ToolButton`'s label from `"Stroke width"` to:

```tsx
            label={strokeIsTextSize ? 'Text size' : 'Stroke width'}
```

and replace the body of the stroke sub-bar's `.map` with:

```tsx
                {STROKE_PRESETS.map((s, i) => (
                  <ToolButton
                    key={s.value}
                    label={strokeIsTextSize ? s.textLabel : s.label}
                    active={strokeWidth === s.value}
                    onClick={() => { onStrokeWidthChange(s.value); setMenu(null); }}
                  >
                    {strokeIsTextSize ? (
                      <svg width="18" height="18" viewBox="0 0 18 18">
                        <text
                          x="9"
                          y="9"
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={TEXT_PREVIEW_SIZES[i]}
                          fontWeight="bold"
                          fill="currentColor"
                        >
                          A
                        </text>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 18 18">
                        <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth={s.value} strokeLinecap="round" />
                      </svg>
                    )}
                  </ToolButton>
                ))}
```

- [ ] **Step 2: Route colour and width to the selection in the portal page**

In `app/portal/[id]/page.tsx`, add to the imports:

```tsx
import type { AnnotationObjectType, MarkupSelection } from '@/components/markup/useAnnotationObjects';
```

Add the state beside `drawingColor` / `drawingStrokeWidth` (currently lines 170-171):

```tsx
  const [selectionType, setSelectionType] = useState<AnnotationObjectType | null>(null);
```

Then add the three handlers. They must sit **after line 251**, where `pdfKonvaRef` is declared — `drawsOnCanvas` is on 249 and `annotationCanvasRef` on 208, but `activeSurface` closes over all three:

```tsx
  /**
   * Colour and stroke width now do two things: set the default for the next object, and
   * restyle whatever is selected. With nothing selected the second half is a no-op, which is
   * exactly the behaviour these controls had before.
   */
  const activeSurface = useCallback(
    () => (drawsOnCanvas ? annotationCanvasRef.current : pdfKonvaRef.current),
    [drawsOnCanvas]
  );

  const handleColorChange = useCallback((c: string) => {
    setDrawingColor(c);
    activeSurface()?.applyStyleToSelection({ color: c });
  }, [activeSurface]);

  const handleStrokeWidthChange = useCallback((w: number) => {
    setDrawingStrokeWidth(w);
    activeSurface()?.applyStyleToSelection({ strokeWidth: w });
  }, [activeSurface]);

  /**
   * Selecting an object pulls its style into the toolbar, so the swatch and the preset on show
   * are the selected object's. That also makes it the style of the *next* object — the ordinary
   * design-tool convention, and it keeps one piece of state driving both rather than two that
   * can disagree. Images carry no style, so they only clear the type.
   */
  const handleSelectionChange = useCallback((s: MarkupSelection | null) => {
    setSelectionType(s?.type ?? null);
    if (s && s.type !== 'image') {
      setDrawingColor(s.color);
      setDrawingStrokeWidth(s.strokeWidth);
    }
  }, []);
```

- [ ] **Step 3: Wire the three into the JSX**

On the `<DrawingTools … />` element, replace `onColorChange={setDrawingColor}` with `onColorChange={handleColorChange}`, replace `onStrokeWidthChange={setDrawingStrokeWidth}` with `onStrokeWidthChange={handleStrokeWidthChange}`, and add:

```tsx
                selectionType={selectionType}
```

On the `<AnnotationCanvas … />` element, add:

```tsx
                onSelectionChange={handleSelectionChange}
```

On the `<ViewerContainer … />` element, add `onSelectionChange={handleSelectionChange}` — and add the matching pass-through to `ViewerContainer` so it reaches `PDFKonvaViewer`. In `components/viewers/ViewerContainer.tsx`:

- add the import `import type { MarkupSelection } from '@/components/markup/useAnnotationObjects';`
- add `onSelectionChange?: (selection: MarkupSelection | null) => void;` to `ViewerContainerProps` (the interface at line 25, beside `onObjectCreated` at line 52)
- add `onSelectionChange` to the destructured parameter list (line 68)
- forward it on the `<PDFKonvaViewer …>` element (line 116), alongside `onObjectCreated={onObjectCreated}` at line 130:

```tsx
        onSelectionChange={onSelectionChange}
```

This mirrors how `pdfViewerRef` and `onObjectCreated` already reach that component — `next/dynamic` drops `ref`, which is why these all travel as ordinary props.

Finally, clear the selection type when a session ends. In `endSession`, add:

```tsx
    setSelectionType(null);
```

- [ ] **Step 4: Wire the harness the same way**

In `app/portal/markup-harness/page.tsx`, add:

```tsx
import type { AnnotationObjectType, MarkupSelection } from '@/components/markup/useAnnotationObjects';
```

```tsx
  const [selectionType, setSelectionType] = useState<AnnotationObjectType | null>(null);

  const onSelectionChange = useCallback((s: MarkupSelection | null) => {
    setSelectionType(s?.type ?? null);
    if (s && s.type !== 'image') { setColor(s.color); setStrokeWidth(s.strokeWidth); }
  }, []);

  const onColorChange = useCallback((c: string) => {
    setColor(c);
    surface.current?.applyStyleToSelection({ color: c });
  }, []);

  const onStrokeWidthChange = useCallback((w: number) => {
    setStrokeWidth(w);
    surface.current?.applyStyleToSelection({ strokeWidth: w });
  }, []);
```

Add `useCallback` to the React import. On `<AnnotationCanvas … />` add `onSelectionChange={onSelectionChange}`. On `<DrawingTools … />` replace `onColorChange={setColor}` with `onColorChange={onColorChange}`, replace `onStrokeWidthChange={setStrokeWidth}` with `onStrokeWidthChange={onStrokeWidthChange}`, and add `selectionType={selectionType}`.

- [ ] **Step 5: Verify in the browser**

Reload `http://localhost:3000/portal/markup-harness`.

Expected:
1. Draw an arrow. It stays selected. Click a different swatch — **the arrow changes colour**. Open Stroke width, pick Thick — **the arrow gets fatter**.
2. Click empty background to deselect, then click the arrow again. The toolbar swatch and stroke preset **jump to the arrow's own** colour and width.
3. Repeat with a rectangle and a freehand stroke. Both restyle.
4. Select a text object. Open the stroke picker: the button's tooltip now reads **"Text size"** and the three chips read **Small / Medium / Large**, showing three sizes of a bold **A** rather than three line weights. Pick Large — the text grows. Pick a swatch — the text changes colour.
5. Insert an image with the Insert image tool and select it. Picking a swatch or a width leaves it **unchanged** — and does not throw.
6. Resize a text object with a corner handle, then open the stroke picker: the chip that is highlighted is the one nearest its new size.

- [ ] **Step 6: Typecheck, test and commit**

```bash
npx tsc --noEmit
npm test
git add components/markup/DrawingTools.tsx "app/portal/[id]/page.tsx" components/viewers/ViewerContainer.tsx app/portal/markup-harness/page.tsx
git commit -m "feat(markup): apply colour and width to the selected object"
```

---

### Task 14: Remove the harness and verify against the real app

**Files:**
- Delete: `app/portal/markup-harness/page.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: a tree ready to merge.

- [ ] **Step 1: Delete the harness**

```bash
git rm app/portal/markup-harness/page.tsx
rm -rf .next/types/app/portal/markup-harness
```

The second command is not optional. Next generates route types under `.next/types`, and a stale one makes `tsc --noEmit` fail on a route that no longer exists — a confusing error that looks like a code defect.

- [ ] **Step 2: Confirm nothing references it**

```bash
grep -rn "markup-harness" --include="*.ts" --include="*.tsx" app components lib
```

Expected: no output.

- [ ] **Step 3: Full typecheck and test**

```bash
npx tsc --noEmit
npm test
```

Expected: clean, and `pass 211`.

- [ ] **Step 4: Production build**

`main` deploys straight to production and there is no staging environment, so the build has to pass before this merges. `lib/s3.ts` throws at import when any of its four vars is missing, so supply all six:

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
```

Expected: `Compiled successfully`, then a route table. A bare `npm run build` failing at "Collect page data" is this missing config, not a code defect — do not chase it.

- [ ] **Step 5: Verify against a real portal**

Everything to this point was verified on a synthetic surface. These four cannot be, because they need a real portal, a real uploaded file and a real comment composer. Point `DATABASE_URL` and the R2 vars at a working environment, run `npm run dev`, open a portal, and check:

1. **3D model.** Pick the Text tool. Confirm the amber banner is gone and a white pill sits at the bottom of the viewport. Confirm **the model does not shift or resize** when the session starts — that is the whole fix. Type a long label, apply with the green ✓, and open the attached snapshot from the comment: **no black band on any edge**.
2. **Image file.** Same, with a portrait image whose aspect ratio differs from the viewport. The bands around it must be light grey, not black.
3. **PDF file.** Pick the Text tool, click on the page, and confirm the box opens **under the cursor**. Zoom in two steps and place another: it must open under the cursor there too, at a size that matches the zoom. Apply, and check the snapshot for black edges.
4. **Attachment markup.** Attach an image to a comment, click its thumbnail to mark it up, draw on it, apply. The result must replace the attachment at its own resolution, uncropped — this path was already correct and must stay so.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(markup): remove the verification harness"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: in-place text → 7, 8, 9, 10, 11; wrapping agreement → 1 (`wrapWidthForContent`), 8 (`width`/`wrap` on the node), 10/11 (per-surface content width); style on the selection → 7, 12, 13; text scale baking → 7, 8; snapshot cause A → 6; snapshot cause B → 2, 4; banner restyle → 5, 6; `endSession` closing the editor → 10, 11 (via `clear`/`clearDrawings`), 13 (`setSelectionType(null)`); testing → 1, 2, 14.

**Deliberate divergences from the spec**, both narrowing rather than widening:
- `CanvasTextEditor` has no `onCancel`. Escape commits per locked decision 2, so a cancel path would be dead code.
- The spec's `lib/markup/text.ts` sketch listed `STROKE_TO_FONT_SIZE` as a record. Two index-aligned arrays serve the same purpose and give the toolbar its ordering for free.

**Placeholder scan.** No "TBD", no "implement later", no "similar to Task N", no "add error handling". Every code step carries the code. Three defects found and fixed inline on review: a wrong test count in Task 4, a corrupted token in Task 9's style object, and a misspelled identifier in Task 13.

**Type consistency.** `addText`'s options-object signature is defined in Task 7 and used with the same field names in Tasks 10 and 11. `MarkupSelection` is defined in Task 12 Step 1 and consumed in Tasks 12 and 13. `editingId` / `onEditText` / `onBakeText` are declared in Task 8 and passed in Tasks 10 and 11. `matteRectForStage`'s input shape matches its call in Task 4. `wrapWidthForContent` is the name in Tasks 1, 10 and 11 alike.

**Deliberate ordering wrinkle.** The tree does not typecheck between Task 7 Step 5 and Task 11 Step 7, because changing `addText`'s signature breaks its two call sites until both are rewritten. This is called out in Task 7 Step 5, Task 8 Step 5, Task 9 Step 2 and Task 10 Step 7, each stating the exact errors to expect. A reviewer gating on "does it compile" should gate at Task 11, not at 7, 8, 9 or 10.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-27-portal-markup-enhancements.md`.
