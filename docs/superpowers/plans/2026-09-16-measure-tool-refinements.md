# Measure Tool Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four refinements to the shipped measure tool — a live preview while measuring, measurement lines in the markup palette, eraser support on all three surfaces, and a 15° Shift snap on the 2D surfaces.

**Architecture:** One new pure module for the snap arithmetic; everything else extends code that already exists. The measurement store gains a hover point, the `Measurement` record gains a colour, the two Konva measure layers open to the eraser, and the 3D viewport gains an eraser mode it has never had.

**Tech Stack:** Next.js 14 app router, React, TypeScript, three.js + react-three-fiber, react-konva, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-16-measure-tool-refinements-design.md`

**Base:** branch `feature/measure-tool-refinements`, off `main` at `ad3e39e` (the measure tool as shipped).

## Global Constraints

- **Tests are `node --test`**, in `scripts/tests/<name>.test.mjs`, run by `npm test`. They import library modules **by relative path with the `.ts` extension**.
- **A VALUE import between `lib/` modules needs BOTH a relative path AND an explicit `.ts` extension.** Node's ESM resolver does no extension guessing. Components under `components/` and routes under `app/` use the `@/` alias like their neighbours.
- **There is no React testing library in this repo and none is to be added.** Only Task 1 has unit tests; everything else is verified in a browser by the user.
- **Never run `git add -A` or `git add .`.** Four long-lived untracked directories (`stiko_handoff/`, `design_handoff_*/`) would be swept in. Stage exact paths.
- **Every commit message ends with the trailer:**
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- `npx tsc --noEmit` is clean at the start of this plan and must be clean at the end of every task. `npx next lint --file <path>` on touched files must be warning-free.
- `npm test` is **617 passing** at the start.
- A `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr is repo-wide and pre-existing. Ignore it.
- **User-facing copy says "Package", never "Portal".**
- **Shift is 2D only.** The 3D surface ignores it entirely — a snapped direction would push the endpoint off the geometry, and a 3D reading is only trustworthy because its points lie on the model.
- **Measurements gain colour but NOT stroke width**, and still never go through `onSelectionChange`.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `lib/measure/snap.ts` | 15° segment snapping for measurement gestures |
| `scripts/tests/measureSnap.test.mjs` | Its tests |

**Modified:**

| Path | Change |
| --- | --- |
| `components/markup/useMeasurements.ts` | `hoverPoint` state; `color` on a committed measurement |
| `components/markup/MeasureObjects.tsx` | Draw in the measurement's colour; halo selection; render the hover point |
| `components/viewers/MeasureLayer.tsx` | Same three, in WebGL; expose its group for the 3D eraser |
| `components/viewers/PDFKonvaViewer.tsx` | Hover reporting; Shift snap; eraser on the measure layer |
| `components/markup/AnnotationCanvas.tsx` | The same three |
| `components/viewers/ModelViewerInner.tsx` | Hover raycast; eraser mode; gate camera orbit |
| `components/viewers/ViewerContainer.tsx` | Forward the new props to both branches |
| `app/portal/[id]/page.tsx` | Pass the drawing colour in; recolour a selected measurement |

---

## Task 1: 15° snap arithmetic

**Files:**
- Create: `lib/measure/snap.ts`
- Test: `scripts/tests/measureSnap.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const MEASURE_SNAP_STEP: number` — `Math.PI / 12`
  - `snapMeasureSegment(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/measureSnap.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE_SNAP_STEP, snapMeasureSegment } from '../../lib/measure/snap.ts';

const deg = (r) => (r * 180) / Math.PI;
const angleOf = (a, b) => deg(Math.atan2(b.y - a.y, b.x - a.x));

test('the step is 15 degrees', () => {
  assert.ok(Math.abs(deg(MEASURE_SNAP_STEP) - 15) < 1e-12);
});

test('a nearly-horizontal segment snaps flat', () => {
  const p = snapMeasureSegment(0, 0, 100, 7);
  assert.ok(Math.abs(angleOf({ x: 0, y: 0 }, p)) < 1e-9);
});

// The snap is ABSOLUTE, not a quantised delta: a 7 degree segment goes to 0, never to 15.
test('a 7 degree segment snaps to 0, not to 15', () => {
  const p = snapMeasureSegment(0, 0, Math.cos(deg2rad(7)) * 50, Math.sin(deg2rad(7)) * 50);
  assert.ok(Math.abs(angleOf({ x: 0, y: 0 }, p)) < 1e-9);
});
function deg2rad(d) { return (d * Math.PI) / 180; }

test('every 15 degree multiple is reachable, from either side', () => {
  for (const target of [15, 30, 45, 60, 75, 90, 120, 165]) {
    for (const nudge of [-4, 4]) {
      const a = deg2rad(target + nudge);
      const p = snapMeasureSegment(0, 0, Math.cos(a) * 80, Math.sin(a) * 80);
      const got = angleOf({ x: 0, y: 0 }, p);
      assert.ok(Math.abs(got - target) < 1e-9, `${target}${nudge >= 0 ? '+' : ''}${nudge} -> ${got}`);
    }
  }
});

// atan2 returns (-pi, pi], so the snap must behave across the discontinuity.
test('it works across the 180 degree wrap', () => {
  const near = deg2rad(178);
  const p = snapMeasureSegment(0, 0, Math.cos(near) * 40, Math.sin(near) * 40);
  assert.ok(Math.abs(Math.abs(angleOf({ x: 0, y: 0 }, p)) - 180) < 1e-9);
});

test('length is preserved exactly enough to measure with', () => {
  const p = snapMeasureSegment(10, 10, 10 + 60, 10 + 13);
  const length = Math.hypot(p.x - 10, p.y - 10);
  assert.ok(Math.abs(length - Math.hypot(60, 13)) < 1e-9);
});

test('it snaps about the anchor, not the origin', () => {
  const p = snapMeasureSegment(200, 500, 300, 507);
  assert.ok(Math.abs(p.y - 500) < 1e-9);
  assert.ok(Math.abs(p.x - 300) < 1e-9);
});

// A zero-length segment has no direction to snap. Returning the point unchanged keeps the
// caller's first click exactly where it was put, instead of NaN from atan2(0,0)/hypot.
test('a zero-length segment is returned unchanged', () => {
  const p = snapMeasureSegment(42, 17, 42, 17);
  assert.deepEqual(p, { x: 42, y: 17 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/measureSnap.test.mjs`
Expected: FAIL — `Cannot find module .../lib/measure/snap.ts`

- [ ] **Step 3: Write the implementation**

Create `lib/measure/snap.ts`:

```ts
/**
 * What "hold Shift while measuring" means.
 *
 * Deliberately NOT in lib/markup/draft.ts, which owns the 45 degree rule the line and arrow
 * tools use. Two different Shift rules in one module is how they get accidentally unified
 * later, and they are different on purpose: an annotation arrow usually just wants to be
 * straight, while a dimension often has to follow a real edge at an odd angle — a 30 degree
 * pitch, a 60 degree chamfer — where eighths of a turn are too coarse.
 *
 * 2D only. The 3D surface ignores Shift: its points are raycast hits that lie ON the geometry,
 * which is the whole reason a 3D reading can be trusted, and snapping the direction would push
 * the endpoint off the surface.
 */

/** Twenty-fourths of a turn: 15 degrees. */
export const MEASURE_SNAP_STEP = Math.PI / 12;

/**
 * The far end of a segment, snapped to the nearest 15 degrees about its anchor, length kept.
 *
 * The snap is ABSOLUTE, not a quantised delta — a segment at 7 degrees goes to 0, not to 97 —
 * which is what makes Shift always produce a clean angle rather than preserving whatever
 * crookedness it started with. Same contract as `snapToRightAngle` in lib/markup/rotationSnap.ts.
 */
export function snapMeasureSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  // No direction to snap, and atan2(0, 0) would feed a meaningless angle into a zero length.
  // Returning the point untouched leaves the caller's first click exactly where they put it.
  if (length === 0) return { x: x1, y: y1 };

  const angle = Math.round(Math.atan2(dy, dx) / MEASURE_SNAP_STEP) * MEASURE_SNAP_STEP;
  return { x: x0 + Math.cos(angle) * length, y: y0 + Math.sin(angle) * length };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/measureSnap.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: 625 passing (617 + 8).

- [ ] **Step 6: Commit**

```bash
git add lib/measure/snap.ts scripts/tests/measureSnap.test.mjs
git commit -m "feat: 15 degree shift snap for measurement segments"
```

---

## Task 2: Measurements draw in the markup colour

**Files:**
- Modify: `components/markup/useMeasurements.ts`
- Modify: `components/markup/MeasureObjects.tsx`
- Modify: `components/viewers/MeasureLayer.tsx`
- Modify: `components/viewers/PDFKonvaViewer.tsx`, `components/markup/AnnotationCanvas.tsx`, `components/viewers/ViewerContainer.tsx`, `app/portal/[id]/page.tsx` (thread the colour)

**Interfaces:**
- Consumes: `Measurement` (Task 0 / shipped).
- Produces:
  - `Measurement` gains `color: string`
  - `useMeasurements().addPoint(point: number[], minSeparation: number, color: string): Measurement | null`
  - `useMeasurements().recolor(id: string, color: string): void`
  - `MeasureObjectsProps` gains `haloColor: string`
  - `MeasureLayerProps` unchanged in shape; colour now read per-measurement

- [ ] **Step 1: Add colour to the record and the store**

In `components/markup/useMeasurements.ts`, extend the interface:

```ts
export interface Measurement extends MeasurementDraft {
  id: string;
  /**
   * The markup colour in force when this was placed. Measurements carry colour but NOT stroke
   * width: a width is part of a drawing, whereas a dimension is chrome that has to stay legible
   * at any zoom. This is also why measurements never go through `onSelectionChange` — the
   * stroke picker must not relabel itself for an object that ignores it.
   */
  color: string;
}
```

Change `addPoint` to take the colour and stamp it on commit:

```ts
  const addPoint = useCallback(
    (point: number[], minSeparation: number, color: string): Measurement | null => {
      const current = pendingRef.current;
      if (!current) return null;

      const result = addGesturePoint(current, point, minSeparation);
      if (result.status === 'pending') {
        setGesture(result.gesture);
        return null;
      }

      setGesture(beginGesture(current.kind, current.page));
      if (result.status === 'rejected') return null;

      const committed: Measurement = {
        ...result.measurement,
        id: `measure-${idRef.current++}`,
        color,
      };
      setMeasurements((prev) => [...prev, committed]);
      return committed;
    },
    [setGesture]
  );
```

Add a recolour action beside `remove`:

```ts
  /** Restyle one measurement. The colour picker's route to a selected dimension. */
  const recolor = useCallback((id: string, color: string) => {
    setMeasurements((prev) => prev.map((m) => (m.id === id ? { ...m, color } : m)));
  }, []);
```

Return `recolor` alongside the existing members.

- [ ] **Step 2: Draw in that colour on the Konva surfaces, with a halo for selection**

In `components/markup/MeasureObjects.tsx`, delete the `STROKE` constant and the `SELECTED`
constant. Add a required prop:

```ts
  /**
   * The colour drawn UNDER a selected measurement, wider than the stroke, so selection reads
   * against any measurement colour on any background.
   *
   * A fixed highlight colour is no longer possible: the old #5B60FF is now a colour the user
   * can pick from the swatch row, and a purple dimension would look identical selected and not.
   * The value is the host stage's own matte — PDF_MATTE or CANVAS_MATTE — because "the
   * background" genuinely differs per surface.
   */
  haloColor: string;
```

Replace the per-measurement colour derivation:

```tsx
        const color = m.color;
        const selected = m.id === selectedId;
```

and render each stroked element twice when selected, halo first. For the leg line:

```tsx
            {selected && (
              <Line
                points={flat}
                stroke={haloColor}
                strokeWidth={px(7)}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
            <Line
              points={flat}
              stroke={color}
              strokeWidth={px(selected ? 3.5 : 2)}
              lineCap="round"
              lineJoin="round"
              id={m.id}
            />
```

Apply the same halo-then-stroke pair to the arc. Endpoint dots become `fill={color}` (they were
hard-coded to `STROKE`), and the label text becomes `fill={color}` with its existing white
shadow plate, which already keeps it legible.

- [ ] **Step 3: Pass the halo colour from each surface**

In `components/viewers/PDFKonvaViewer.tsx`, on the `<MeasureObjects>` element:

```tsx
                haloColor={PDF_MATTE}
```

In `components/markup/AnnotationCanvas.tsx`:

```tsx
                haloColor={CANVAS_MATTE}
```

Both constants are already imported in their files from `@/lib/markup/matte`.

- [ ] **Step 4: Draw in that colour in 3D**

In `components/viewers/MeasureLayer.tsx`, delete `LINE_COLOR` and `SELECTED_COLOR`. The label
texture builder takes the colour as an argument:

```ts
function makeLabelTexture(text: string, color: string): THREE.CanvasTexture {
```

and uses it for the text fill (`c.fillStyle = color;`), keeping the white plate and its border.
Every `color: LINE_COLOR` in the entry construction becomes `color: m.color`, and the call site
becomes `makeLabelTexture(labelFor(m), m.color)`.

A 3D scene has no matte to halo against, so selection there is expressed on the objects that
already exist rather than by adding new ones:

- the leg line's material gets the measurement's colour either way, and a selected entry sets
  `linewidth` to 2 where an unselected one uses 1 (three ignores `linewidth` on most platforms,
  so this is the weaker half and must not be the only signal);
- the endpoint `THREE.Points` material doubles its `size` when selected — this is the reliable
  one, since point size is honoured everywhere;
- the label texture is rebuilt with a filled plate in the measurement's colour and white text
  when selected, inverting the unselected white-plate-coloured-text treatment.

`makeLabelTexture` therefore takes the selected flag as well:

```ts
function makeLabelTexture(text: string, color: string, selected: boolean): THREE.CanvasTexture {
```

and `selectedId` joins the `entries` memo's dependency array, since the texture now depends on
it. Do not invent a `ringScale` or any other new geometry for this.

**Do not invent a shared "paper" token** for the two cases. The Konva halo and the 3D ring solve
the same problem in genuinely different media.

- [ ] **Step 5: Thread the colour in from the toolbar and recolour on pick**

In `app/portal/[id]/page.tsx`, the toolbar's current colour is already `drawingColor`. Pass it
to every `onMeasurePoint` call so the store can stamp it — the surfaces call
`onMeasurePoint(point, minSeparation)`, and the portal's handler becomes:

```tsx
  onMeasurePoint={(point, minSeparation) => addMeasurePoint(point, minSeparation, drawingColor)}
```

In the existing colour-change handler, recolour a selected measurement. The markup and
measurement selections are already mutually exclusive, so exactly one of these can fire:

```tsx
    if (selectedMeasurementId) {
      recolorMeasure(selectedMeasurementId, next);
      return;
    }
```

placed before the existing `applyStyleToSelection` call.

- [ ] **Step 6: Typecheck, lint, test**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx next lint --file "app/portal/[id]/page.tsx" --file components/markup/MeasureObjects.tsx --file components/viewers/MeasureLayer.tsx --file components/markup/useMeasurements.ts` — expected no warnings.
Run: `npm test` — expected 625 passing.

- [ ] **Step 7: Commit**

```bash
git add components/markup/useMeasurements.ts components/markup/MeasureObjects.tsx components/viewers/MeasureLayer.tsx components/viewers/PDFKonvaViewer.tsx components/markup/AnnotationCanvas.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx"
git commit -m "feat: draw measurements in the markup colour, with a halo for selection"
```

---

## Task 3: Live preview while measuring

**Files:**
- Modify: `components/markup/useMeasurements.ts`
- Modify: `components/markup/MeasureObjects.tsx`, `components/viewers/MeasureLayer.tsx`
- Modify: `components/viewers/PDFKonvaViewer.tsx`, `components/markup/AnnotationCanvas.tsx`, `components/viewers/ModelViewerInner.tsx`, `components/viewers/ViewerContainer.tsx`, `app/portal/[id]/page.tsx`

**Interfaces:**
- Consumes: `Measurement.color` (Task 2).
- Produces:
  - `useMeasurements().hoverPoint: number[] | null`
  - `useMeasurements().setHoverPoint(point: number[] | null): void`
  - `MeasureObjectsProps` and `MeasureLayerProps` both gain `hoverPoint: number[] | null` and
    `previewColor: string` — the gesture has not committed, so there is no `Measurement.color`
    to read yet and the toolbar's current colour has to be passed separately
  - `onMeasureHover?: (point: number[] | null) => void` on all three surfaces

- [ ] **Step 1: Hold the hover point in the store**

In `components/markup/useMeasurements.ts`:

```ts
  /**
   * Where the cursor is, in the surface's own space, while a gesture is pending.
   *
   * Rendered as a provisional last point so the user sees the line and its running value before
   * committing. Cleared anywhere the pending gesture is cleared — on commit, on cancel, on the
   * tool being disarmed, on a file switch — so a stale hover line can never outlive its gesture.
   */
  const [hoverPoint, setHoverPointState] = useState<number[] | null>(null);

  const setHoverPoint = useCallback((point: number[] | null) => {
    setHoverPointState(point ? [...point] : null);
  }, []);
```

Clear it inside `setGesture`, which already funnels every gesture change:

```ts
  const setGesture = useCallback((next: PendingGesture | null) => {
    pendingRef.current = next;
    setPending(next);
    // A new or cleared gesture invalidates the hover line by definition.
    setHoverPointState(null);
  }, []);
```

Return `hoverPoint` and `setHoverPoint`.

- [ ] **Step 2: Render it as a provisional point**

In `components/markup/MeasureObjects.tsx`, add `hoverPoint: number[] | null` to the props and
build the preview from `pending.points` plus the hover point:

```tsx
      {pending && pending.page === page && pending.points.length > 0 && (() => {
        const preview = hoverPoint ? [...pending.points, hoverPoint] : pending.points;
        const flat = preview.flat();
        // Two points make a linear reading; three make an angle at the middle one. Anything
        // less is just the placed dots, which render below regardless.
        const value =
          preview.length === 2 ? lengthLabel(preview[0], preview[1])
          : preview.length === 3 ? formatAngle(angleAt(preview[1], preview[0], preview[2]))
          : '';
        return (
          <>
            {preview.length > 1 && (
              <Line points={flat} stroke={previewColor} strokeWidth={px(1.5)} dash={[px(6), px(4)]} listening={false} />
            )}
            {value && (
              <Text
                x={preview[preview.length - 1][0] + px(10)}
                y={preview[preview.length - 1][1] - px(20)}
                text={value}
                fontSize={px(14)}
                fontStyle="600"
                fill={previewColor}
                shadowColor="#FFFFFF"
                shadowBlur={px(6)}
                shadowOpacity={1}
                listening={false}
              />
            )}
          </>
        );
      })()}
```

`previewColor` is a new prop carrying the toolbar's current colour — the gesture has not
committed yet, so there is no `Measurement.color` to read. `lengthLabel` is the existing
length-formatting helper already used for committed measurements; extract it from the map
callback so both call sites share it rather than duplicating the conversion chain.

Mirror the same structure in `components/viewers/MeasureLayer.tsx`, where the preview is
already a dashed `THREE.Line` and gains the hover point plus a sprite label.

- [ ] **Step 3: Report hover from the PDF surface**

In `components/viewers/PDFKonvaViewer.tsx`, `handleStageMouseMove` currently early-returns for
measure tools. Replace that early return with hover reporting:

```ts
      if (isMeasureTool(activeTool)) {
        // Only while a gesture is pending: before the first click there is nothing to preview,
        // and reporting every idle mouse move would re-render the stage for nothing.
        if (!pendingMeasurement) { onMeasureHover?.(null); return; }
        const p = getPageCoords(stage);
        onMeasureHover?.(p ? [p.x, p.y] : null);
        return;
      }
```

Add `onMeasureHover` and `hoverPoint` to the props and pass `hoverPoint` into `<MeasureObjects>`.

- [ ] **Step 4: Report hover from the image surface**

In `components/markup/AnnotationCanvas.tsx`, the same shape in `handleMouseMove`, using
`stage.getPointerPosition()` rather than `getPageCoords`:

```ts
    if (isMeasureTool(activeTool)) {
      if (!pendingMeasurement) { onMeasureHover?.(null); return; }
      const p = stage.getPointerPosition();
      onMeasureHover?.(p ? [p.x, p.y] : null);
      return;
    }
```

- [ ] **Step 5: Report hover from the 3D surface**

In `components/viewers/ModelViewerInner.tsx`'s `SceneInteraction`, add a `pointermove` listener
beside the existing `pointerdown`/`pointerup` pair. It must use **the same** `pickModel` and the
same `nearestVertexSnap` the click uses:

```ts
    const handlePointerMove = (e: PointerEvent) => {
      if (!measureActive || !onMeasureHover) return;
      // Gated on a pending gesture: this raycasts, and doing that on every idle mouse move
      // over a large model is real work for no visible result.
      // `pendingMeasurement` is the prop the 3D viewer already receives — do not introduce a
      // second name for it.
      if (!pendingMeasurement) { onMeasureHover(null); return; }

      const model = modelRef.current;
      if (!model) return;
      const hit = pickModel(e);
      if (!hit) { onMeasureHover(null); return; }

      // The SAME snap the click uses. A preview that snaps differently makes the point jump
      // the moment you commit it.
      const snapped = nearestVertexSnap(hit, camera, gl);
      const local = snapped
        ? worldToModel([snapped.x, snapped.y, snapped.z], transform)
        : worldToModel([hit.point.x, hit.point.y, hit.point.z], transform);
      onMeasureHover([local[0], local[1], local[2]]);
    };
```

Register and clean it up alongside the existing listeners.

- [ ] **Step 6: Wire the portal**

In `app/portal/[id]/page.tsx`, pass `hoverPoint={measure.hoverPoint}`, `previewColor={drawingColor}`
and `onMeasureHover={setMeasureHoverPoint}` to all three surfaces, and `pendingMeasurement` where
a surface needs to know a gesture is live.

- [ ] **Step 7: Typecheck, lint, test**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx next lint` on each touched file — expected no warnings.
Run: `npm test` — expected 625 passing.

- [ ] **Step 8: Commit**

```bash
git add components/markup/useMeasurements.ts components/markup/MeasureObjects.tsx components/viewers/MeasureLayer.tsx components/viewers/PDFKonvaViewer.tsx components/markup/AnnotationCanvas.tsx components/viewers/ModelViewerInner.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx"
git commit -m "feat: live preview with a running value while measuring"
```

---

## Task 4: Shift snaps the 2D gestures to 15°

**Files:**
- Modify: `components/viewers/PDFKonvaViewer.tsx`
- Modify: `components/markup/AnnotationCanvas.tsx`

**Interfaces:**
- Consumes: `snapMeasureSegment` (Task 1); `hoverPoint` reporting (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Snap on the PDF surface**

In `components/viewers/PDFKonvaViewer.tsx`, add a helper above the handlers:

```ts
  /**
   * Shift constrains a measurement leg to 15 degrees about the point it starts from.
   *
   * Read fresh off each event rather than from held state, matching `updateGeometry`'s contract
   * for the drawing tools: pressing or releasing Shift mid-gesture takes effect on the next
   * move, not instantly. For an angular gesture the anchor is the previous point, so each leg
   * snaps about the vertex and the resulting angle always lands on a multiple of 15.
   */
  const applyMeasureSnap = useCallback(
    (point: number[], shiftKey: boolean): number[] => {
      const anchor = pendingMeasurement?.points[pendingMeasurement.points.length - 1];
      if (!shiftKey || !anchor) return point;
      const snapped = snapMeasureSegment(anchor[0], anchor[1], point[0], point[1]);
      return [snapped.x, snapped.y];
    },
    [pendingMeasurement]
  );
```

Apply it in **both** places, so the preview shows exactly what will commit — in the mousedown
measure branch:

```ts
        if (p) onMeasurePoint?.(applyMeasureSnap([p.x, p.y], e.evt.shiftKey), 3);
```

and in the hover branch added by Task 3:

```ts
        onMeasureHover?.(p ? applyMeasureSnap([p.x, p.y], e.evt.shiftKey) : null);
```

Import `snapMeasureSegment` from `@/lib/measure/snap`.

- [ ] **Step 2: Snap on the image surface**

Add the identical helper and the identical two call sites to
`components/markup/AnnotationCanvas.tsx`, using `stage.getPointerPosition()` for the raw point.

The two helpers are four lines each and read from different pending props on different
surfaces; sharing them through a module would mean threading the pending gesture through an
argument for no reduction in real duplication.

- [ ] **Step 3: Leave 3D alone — verify, do not implement**

Confirm by reading that `ModelViewerInner.tsx` never references `shiftKey` in any measure path.
Shift on a model must do nothing: a snapped direction pushes the endpoint off the geometry, and
a 3D reading is only trustworthy because its points lie on the model.

- [ ] **Step 4: Confirm the drawing tools still snap to 45°**

Confirm by reading that `lib/markup/draft.ts`'s `SEGMENT_SNAP_STEP` is still `Math.PI / 4` and
that nothing in this task imports it. The two rules are deliberately different.

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx next lint --file components/viewers/PDFKonvaViewer.tsx --file components/markup/AnnotationCanvas.tsx` — expected no warnings.
Run: `npm test` — expected 625 passing.

- [ ] **Step 6: Commit**

```bash
git add components/viewers/PDFKonvaViewer.tsx components/markup/AnnotationCanvas.tsx
git commit -m "feat: shift snaps measurement legs to 15 degrees on the 2D surfaces"
```

---

## Task 5: The eraser deletes measurements on the 2D surfaces

**Files:**
- Modify: `components/viewers/PDFKonvaViewer.tsx`
- Modify: `components/markup/AnnotationCanvas.tsx`

**Interfaces:**
- Consumes: `useMeasurements().remove` (shipped).
- Produces: `onEraseMeasurement?: (id: string) => void` on both surfaces.

**This is the riskiest task in the plan.** `eraseAt` is shared with markup erasing, which is
shipped and works. A mistake here breaks a feature people already use.

- [ ] **Step 1: Let the eraser see the measure layer**

In both files the measure `<Layer>` currently reads `listening={activeTool === 'pointer'}`.
Open it to the eraser:

```tsx
              <Layer ref={measureLayerRef} listening={activeTool === 'pointer' || activeTool === 'eraser'}>
```

- [ ] **Step 2: Put the id on the leaf shapes**

`eraseAt` reads `stage.getIntersection(p)?.id()`, which returns the **leaf** shape under the
cursor. Today the measurement id lives on the wrapping `Group` and the leaves carry none — one
of three accidental reasons measurements were eraser-proof.

In `components/markup/MeasureObjects.tsx`, add `id={m.id}` to every shape that should be
erasable — the leg `Line`, the arc `Line`, and the endpoint `Circle`s. Leave the halo shapes
without an id and `listening={false}`: a halo is a rendering detail, not a hit target.

- [ ] **Step 3: Route measurement ids to the right store**

In both surfaces, extend `eraseAt`:

```ts
  const eraseAt = (stage: Konva.Stage, p: { x: number; y: number }) => {
    const id = stage.getIntersection(p)?.id();
    // Konva returns the Transformer's own handles and any unnamed node too; only our objects
    // carry an id.
    if (!id) return;
    // The `obj-` / `measure-` id prefixes are now LOAD-BEARING. They used to be an accident
    // that merely stopped the two stores colliding; erasing depends on telling them apart.
    // Both prefixes are single-sourced — `useAnnotationObjects` and `useMeasurements` — and
    // must stay distinct.
    if (id.startsWith('measure-')) onEraseMeasurement?.(id);
    else ann.deleteObject(id);
  };
```

Drag-sweeping comes for free: `eraseAt` is already driven through `sweepPoints`, so a
measurement is swept exactly like a markup object once it is findable.

- [ ] **Step 4: Wire the portal**

In `app/portal/[id]/page.tsx`, pass `onEraseMeasurement={removeMeasure}` to both 2D surfaces
through `ViewerContainer`.

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx next lint` on each touched file — expected no warnings.
Run: `npm test` — expected 625 passing.

- [ ] **Step 6: Commit**

```bash
git add components/viewers/PDFKonvaViewer.tsx components/markup/AnnotationCanvas.tsx components/markup/MeasureObjects.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx"
git commit -m "feat: erase measurements with the eraser on the 2D surfaces"
```

---

## Task 6: An eraser mode in the live 3D viewport

**Files:**
- Modify: `components/viewers/MeasureLayer.tsx` (expose its group)
- Modify: `components/viewers/ModelViewerInner.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`, `app/portal/[id]/page.tsx`

**Interfaces:**
- Consumes: `sweepPoints` from `lib/markup/eraseSweep.ts`; `ERASER_CURSOR` from `lib/cursors.ts`.
- Produces: `eraserActive: boolean` and `onEraseMeasurement: (id: string) => void` on the 3D viewer.

The eraser has only ever been a markup-session tool running on a frozen snapshot. On a model,
measurements live in the live scene, so it becomes a viewport mode.

- [ ] **Step 1: Expose the measurement group**

In `components/viewers/MeasureLayer.tsx`, accept and attach a group ref so the eraser can
raycast against measurements alone:

```tsx
  /** The root group, so the 3D eraser can raycast against measurements and nothing else. */
  groupRef?: React.MutableRefObject<THREE.Group | null>;
```

Attach it to the existing root `<group>`, and give each measurement's child group
`userData.measurementId = m.id` so a hit can be traced back to a record.

- [ ] **Step 2: Stop the camera orbiting while erasing**

In `components/viewers/ModelViewerInner.tsx`, gate the controls:

```tsx
        <CameraControls
          makeDefault
          dollyToCursor
          smoothTime={0.15}
          draggingSmoothTime={0.08}
          enabled={!eraserActive}
        />
```

Without this the erase drag orbits the camera instead of erasing — `camera-controls` claims the
same left-drag and never calls `preventDefault()`.

- [ ] **Step 3: Sweep-erase on drag**

`SceneInteraction` has no erase state today — `erasingRef` and `lastErasePointRef` exist on the
Konva surfaces only. Declare both here, beside the existing `pointerDownPos` ref:

```ts
  const erasingRef = useRef(false);
  const lastErasePointRef = useRef<{ x: number; y: number } | null>(null);
```

Then add handlers that raycast against the measurement group only:

```ts
    const eraseMeasurementsAt = (clientX: number, clientY: number) => {
      const group = measureGroupRef.current;
      if (!group) return;
      const rect = gl.domElement.getBoundingClientRect();
      mouse.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(mouse.current, camera);
      // The measurement group ALONE. The model must never be an erase target.
      for (const hit of raycaster.current.intersectObject(group, true)) {
        let node: THREE.Object3D | null = hit.object;
        while (node && node.userData?.measurementId === undefined) node = node.parent;
        const id = node?.userData?.measurementId as string | undefined;
        if (id) { onEraseMeasurement?.(id); return; }
      }
    };
```

Drive it from pointer events, interpolating with `sweepPoints` so a fast drag does not skip
between mouse-move samples:

```ts
    const handleEraserDown = (e: PointerEvent) => {
      if (!eraserActive) return;
      erasingRef.current = true;
      lastErasePointRef.current = { x: e.clientX, y: e.clientY };
      // Erase on the press itself, so a single click erases without requiring a drag.
      eraseMeasurementsAt(e.clientX, e.clientY);
    };

    const handleEraserMove = (e: PointerEvent) => {
      if (!eraserActive || !erasingRef.current) return;
      const to = { x: e.clientX, y: e.clientY };
      for (const p of sweepPoints(lastErasePointRef.current, to)) eraseMeasurementsAt(p.x, p.y);
      lastErasePointRef.current = to;
    };
```

with a pointerup/pointerleave that clears `erasingRef` and `lastErasePointRef`.

- [ ] **Step 4: Show the eraser cursor**

Set the canvas cursor to `ERASER_CURSOR` while `eraserActive`, following however the viewer
already sets its crosshair for the measure tools.

- [ ] **Step 5: Confirm arming the eraser still does not freeze the viewport**

Confirm by reading that `eraser` is absent from `DRAW_TOOLS` in `app/portal/[id]/page.tsx` and
that the measure-tool session rule does not include it. Freezing the viewport would turn the
measurements the eraser is meant to remove into pixels in a snapshot.

- [ ] **Step 6: Wire the portal**

Pass `eraserActive={activeTool === 'eraser' && is3DFile}` and `onEraseMeasurement={removeMeasure}`
through `ViewerContainer` to the 3D branch.

- [ ] **Step 7: Typecheck, lint, test**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx next lint` on each touched file — expected no warnings.
Run: `npm test` — expected 625 passing.

- [ ] **Step 8: Commit**

```bash
git add components/viewers/MeasureLayer.tsx components/viewers/ModelViewerInner.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx"
git commit -m "feat: erase measurements in the live 3D viewport"
```

---

## Task 7: Verification

**Files:** none modified.

- [ ] **Step 1: Full suite, typecheck, build**

```bash
npx tsc --noEmit && npm test
AUTH_SECRET=x DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=d R2_SECRET_ACCESS_KEY=d \
R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=d npx next build
```
Expected: 0 errors, 625 passing, build compiles.

- [ ] **Step 2: Hand the browser checks to the user**

These cannot be run from this environment — there is no authenticated session. Report them:

1. Measure on each surface; the line and value track the cursor from the first click.
2. Set a colour, measure — the dimension draws in it. Select it, pick another colour.
3. Select a measurement whose colour **is** the old highlight blue; selected must still read as
   distinct from unselected.
4. Erase a measurement with a drag on a PDF, on an image, and on a live 3D model.
5. An erase drag on 3D does not orbit the camera.
6. **The eraser still deletes ordinary markup on both 2D surfaces** — the regression risk.
7. Hold Shift on a PDF: 15° increments. Shift on a model: nothing.
8. A line or arrow still snaps to 45°.

---

## A note on names in `app/portal/[id]/page.tsx`

The portal destructures the measurement store's callbacks rather than calling them through the
object, because the store's members go into effect dependency arrays and the object identity
changes every render. The existing destructure already yields `beginMeasure`, `addMeasurePoint`,
`cancelMeasure`, `removeMeasure` and `clearMeasure`. This plan adds `recolorMeasure` and
`setMeasureHoverPoint` to that same destructure — follow the pattern that is there rather than
introducing a second calling convention.

## Notes for the implementer

- **Shift is 2D only.** If you find yourself adding `shiftKey` to a 3D path, stop — a snapped
  direction pushes the endpoint off the geometry, which is the one thing that makes a 3D
  reading trustworthy.
- **Measurements gain colour, not stroke width**, and must still never reach `onSelectionChange`.
- **The `obj-` / `measure-` id prefixes are load-bearing after Task 5.** Keep them distinct.
- **A preview must snap exactly like the commit.** Any divergence makes the point jump on click.
