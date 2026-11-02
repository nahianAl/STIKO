# Markup Arrow Button + Multi-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Arrow tool its own toolbar button beside Freehand. Add multi-select to markup: Shift+click to toggle, a drag box that selects anything it touches, Shift+box to add, and group move/resize/rotate, delete and restyle.

**Architecture:**
- Selection becomes a list in the shared `useAnnotationObjects` hook, with pure set rules in `lib/markup/selection.ts`.
- A small `useMarqueeSelect` hook owns the box gesture and hit-tests Konva nodes.
- `AnnotationObjects` binds one Transformer to every selected node and draws the box.
- Both drawing surfaces (`PDFKonvaViewer`, `AnnotationCanvas`) route their Pointer handlers into it.

**Tech Stack:** React 18, react-konva / Konva 10.2.3, TypeScript, Tailwind, `node --test` (Node 25 type stripping).

**Spec:** `docs/superpowers/specs/2026-11-02-markup-multiselect-design.md`

## Global Constraints

- Branch `feature/markup-multiselect`, already created off `main` (c8b907f).
- **Never `git add -A` or `git add .`.** Add explicit paths only. Harness routes and files are never committed.
- `lib/markup/selection.ts` has **no imports** (loaded raw by `node --test`) and uses only erasable TS syntax.
- **Selection box:**
  - colour `#5B60FF`, dashed, with a faint fill;
  - selects objects whose bounding box **touches** it;
  - a drag under **3 screen pixels** is a click.
- **Keep the existing hook API working:** `selectedId` (first selected id), `setSelectedId(id | null)` (replaces the selection) and `selectedObject` (first selected object). `onSelectionChange` reports the first selected object, as today.
- **Measurements are not markup.** The box ignores them, and the existing markup/measurement mutual-exclusion stays.
- **Outside a markup session**, the PDF viewer's Pointer still pans the stage. Do not change that.
- **Do not change** `app/portal/[id]/page.tsx` or `components/viewers/ViewerContainer.tsx`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## File Map

| File | Status | Responsibility |
|---|---|---|
| `lib/markup/selection.ts` | create | Pure selection rules and box maths |
| `scripts/tests/markupSelection.test.mjs` | create | Tests for the above |
| `components/markup/useAnnotationObjects.ts` | modify | `selectedIds` list + pick/selectMany/deleteSelected/applyStyleToSelected |
| `components/markup/useMarqueeSelect.ts` | create | Box gesture + Konva hit test |
| `components/markup/AnnotationObjects.tsx` | modify | Multi-node Transformer, Shift-pick, group drag persistence, box rendering |
| `components/viewers/PDFKonvaViewer.tsx` | modify | Wire Pointer box gesture, Delete, style-to-selection |
| `components/markup/AnnotationCanvas.tsx` | modify | Same wiring |
| `components/markup/DrawingTools.tsx` | modify | Arrow out of Shapes into its own button |

---

### Task 1: Pure selection rules

**Files:**
- Create: `lib/markup/selection.ts`
- Test: `scripts/tests/markupSelection.test.mjs`

**Interfaces — Produces:**
- `interface Point { x: number; y: number }`
- `interface Box { x: number; y: number; width: number; height: number }`
- `pickId(ids: string[], id: string, additive: boolean): string[]`
- `mergeSelection(current: string[], hits: string[], additive: boolean): string[]`
- `normalizeBox(a: Point, b: Point): Box`
- `boxesTouch(a: Box, b: Box): boolean`
- `isTinyBox(box: Box, minSize: number): boolean`

- [ ] **Step 1: Write the failing test** — create `scripts/tests/markupSelection.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickId, mergeSelection, normalizeBox, boxesTouch, isTinyBox } from '../../lib/markup/selection.ts';

test('pickId: plain click selects only the object, unless it is already selected', () => {
  assert.deepEqual(pickId([], 'a', false), ['a']);
  assert.deepEqual(pickId(['b', 'c'], 'a', false), ['a']);
  // Already selected: keep the group so a drag moves all of it.
  assert.deepEqual(pickId(['b', 'a'], 'a', false), ['b', 'a']);
});

test('pickId: shift-click toggles', () => {
  assert.deepEqual(pickId(['b'], 'a', true), ['b', 'a']);
  assert.deepEqual(pickId(['b', 'a'], 'a', true), ['b']);
  assert.deepEqual(pickId([], 'a', true), ['a']);
});

test('mergeSelection replaces, or adds without duplicates', () => {
  assert.deepEqual(mergeSelection(['x'], ['a', 'b'], false), ['a', 'b']);
  assert.deepEqual(mergeSelection(['x', 'a'], ['a', 'b'], true), ['x', 'a', 'b']);
  assert.deepEqual(mergeSelection(['x'], [], false), []);
  assert.deepEqual(mergeSelection(['x'], [], true), ['x']);
  assert.deepEqual(mergeSelection([], ['a', 'a'], false), ['a']);
});

test('normalizeBox works for a drag in any direction', () => {
  const want = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(normalizeBox({ x: 10, y: 20 }, { x: 40, y: 60 }), want);
  assert.deepEqual(normalizeBox({ x: 40, y: 60 }, { x: 10, y: 20 }), want);
  assert.deepEqual(normalizeBox({ x: 40, y: 20 }, { x: 10, y: 60 }), want);
});

test('boxesTouch: any overlap or shared edge counts; separation does not', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(boxesTouch(box, { x: 5, y: 5, width: 10, height: 10 }), true);   // partial overlap
  assert.equal(boxesTouch(box, { x: 2, y: 2, width: 2, height: 2 }), true);     // fully inside
  assert.equal(boxesTouch(box, { x: -5, y: -5, width: 30, height: 30 }), true); // fully around
  assert.equal(boxesTouch(box, { x: 10, y: 0, width: 5, height: 5 }), true);    // shared edge
  assert.equal(boxesTouch(box, { x: 11, y: 0, width: 5, height: 5 }), false);   // right of
  assert.equal(boxesTouch(box, { x: 0, y: -6, width: 5, height: 5 }), false);   // above
  // A zero-width box (a vertical line's bounds) still touches when it crosses.
  assert.equal(boxesTouch(box, { x: 5, y: -5, width: 0, height: 30 }), true);
});

test('isTinyBox: tiny only when BOTH sides are under the threshold', () => {
  assert.equal(isTinyBox({ x: 0, y: 0, width: 2, height: 2 }, 3), true);
  assert.equal(isTinyBox({ x: 0, y: 0, width: 2, height: 50 }, 3), false);
  assert.equal(isTinyBox({ x: 0, y: 0, width: 3, height: 0 }, 3), false);
  assert.equal(isTinyBox({ x: 0, y: 0, width: 0.5, height: 0.5 }, 0.75), true);
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run `node --test scripts/tests/markupSelection.test.mjs`. Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement** — create `lib/markup/selection.ts`:

```ts
// Pure selection rules for markup multi-select (spec: docs/superpowers/specs/2026-11-02-markup-multiselect-design.md).
// No imports: `node --test` loads this file directly (scripts/tests/markupSelection.test.mjs).

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The selection after a press on object `id`. Shift (`additive`) toggles it. A plain press
 * selects only it — unless it is already selected, in which case the group is kept so the drag
 * that follows moves all of it.
 */
export function pickId(ids: string[], id: string, additive: boolean): string[] {
  if (additive) return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
  return ids.includes(id) ? ids : [id];
}

/** The selection after a box: its hits replace the selection, or (Shift) join it. No duplicates. */
export function mergeSelection(current: string[], hits: string[], additive: boolean): string[] {
  const out = additive ? [...current] : [];
  for (const h of hits) if (!out.includes(h)) out.push(h);
  return out;
}

/** The box between two drag points, whichever way the drag went. */
export function normalizeBox(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** True when two boxes overlap or share an edge — the "touching" rule the selection box uses. */
export function boxesTouch(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** A drag this small in both directions was meant as a click. `minSize` is in the box's units. */
export function isTinyBox(box: Box, minSize: number): boolean {
  return box.width < minSize && box.height < minSize;
}
```

- [ ] **Step 4: Run the tests.** Run `node --test scripts/tests/markupSelection.test.mjs`, expecting 6/6 PASS, then `npm test`, expecting everything to pass.

- [ ] **Step 5: Commit**

```bash
git add lib/markup/selection.ts scripts/tests/markupSelection.test.mjs
git commit -m "feat(markup): pure selection rules for multi-select

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Selection list in the markup model

**Files:** Modify `components/markup/useAnnotationObjects.ts`

**Interfaces:**
- Consumes `pickId` and `mergeSelection` (Task 1).
- Produces, on the hook's return value (all existing fields kept):
  - `selectedIds: string[]`
  - `selectedId: string | null`, the first selected id
  - `setSelectedId(id: string | null): void`, which replaces the selection
  - `pick(id: string, additive: boolean): void`
  - `selectMany(ids: string[], additive: boolean): void`
  - `deleteSelected(): void`
  - `applyStyleToSelected(patch: { color?: string; strokeWidth?: number }): void`
  - `selectedObject`, the first selected object

- [ ] **Step 1: Edit the hook.**
  1. Add `import { pickId, mergeSelection } from '@/lib/markup/selection';` below the existing imports.
  2. Replace `const [selectedId, setSelectedId] = useState<string | null>(null);` with:

```ts
  // Ordered; the first id is the "primary" the toolbar reflects. A list rather than one id so
  // Shift+click and the selection box can hold several objects at once.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds[0] ?? null;
  /** Replace the selection with one object, or clear it. The single-object API every caller had. */
  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  /** A press on an object with the Pointer: see pickId. */
  const pick = useCallback((id: string, additive: boolean) => setSelectedIds((ids) => pickId(ids, id, additive)), []);
  /** The selection box's hits: see mergeSelection. */
  const selectMany = useCallback((ids: string[], additive: boolean) => setSelectedIds((cur) => mergeSelection(cur, ids, additive)), []);
```

  3. In `endDraw`, `addText` and `addImage`, replace each `setSelectedId(obj.id)` / `setSelectedId(o.id)` with `setSelectedIds([obj.id])` / `setSelectedIds([o.id])`. These callbacks have `[]` deps and the state setter is stable.
  4. In `deleteObject`, replace `setSelectedId((s) => (s === id ? null : s));` with `setSelectedIds((ids) => ids.filter((i) => i !== id));`.
  5. In `clear`, replace `setSelectedId(null)` with `setSelectedIds([])`.
  6. After `applyStyle`, add:

```ts
  /** Restyle every selected object (images ignore it; on text a width is a font size — see applyStyle). */
  const applyStyleToSelected = useCallback((patch: { color?: string; strokeWidth?: number }) => {
    for (const id of selectedIds) applyStyle(id, patch);
  }, [selectedIds, applyStyle]);
```

  7. After `deleteObject`, add:

```ts
  /** Delete every selected object. */
  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const drop = new Set(selectedIds);
    setObjects((prev) => prev.filter((o) => !drop.has(o.id)));
    setSelectedIds([]);
  }, [selectedIds]);
```

  8. Leave `selectedObject` as `objects.find((o) => o.id === selectedId) ?? null`.
  9. Add `selectedIds, pick, selectMany, deleteSelected, applyStyleToSelected` to the returned object, next to `selectedId, setSelectedId, selectedObject`.

- [ ] **Step 2: Type-check.** Run `npx tsc --noEmit`, expecting exit 0. Existing callers compile unchanged because the old fields keep their types. If tsc fails only in stale `.next/types/...` for routes not in `app/`, delete that folder and re-run.

- [ ] **Step 3: Commit**

```bash
git add components/markup/useAnnotationObjects.ts
git commit -m "feat(markup): markup selection is a list (pick, selectMany, deleteSelected, applyStyleToSelected)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Selection box hook + multi-node Transformer

**Files:**
- Create: `components/markup/useMarqueeSelect.ts`
- Modify: `components/markup/AnnotationObjects.tsx`

**Interfaces:**
- Consumes `normalizeBox`, `boxesTouch`, `isTinyBox`, `Box`, `Point` (Task 1) and `ann.objects` / `ann.selectMany` (Task 2).
- Produces:
  - `useMarqueeSelect(ann: { objects: { id: string }[]; selectMany(ids: string[], additive: boolean): void })`, returning `{ box: Box | null; begin(p: Point, additive: boolean): void; move(p: Point): void; end(stage: Konva.Stage | null, minSize: number): boolean }`.
  - `AnnotationObjects` props change:
    - `selectedId: string | null` → `selectedIds: string[]`;
    - `onSelect: (id: string) => void` → `onSelect: (id: string, additive: boolean) => void`;
    - new optional `marquee?: Box | null`.

- [ ] **Step 1: Create `components/markup/useMarqueeSelect.ts`:**

```ts
'use client';

import { useCallback, useRef, useState } from 'react';
import type Konva from 'konva';
import { boxesTouch, isTinyBox, normalizeBox, type Box, type Point } from '@/lib/markup/selection';

interface Selectable {
  objects: { id: string }[];
  selectMany: (ids: string[], additive: boolean) => void;
}

/**
 * The drag-on-empty-space selection box. Points are in the surface's own drawing space (page
 * pixels on the PDF viewer, stage pixels on AnnotationCanvas) — the same space each object's
 * node lives in, which is why the hit test measures nodes relative to their LAYER (untransformed)
 * rather than the stage (which carries the PDF zoom and pan).
 */
export function useMarqueeSelect(ann: Selectable) {
  const startRef = useRef<{ p: Point; additive: boolean } | null>(null);
  const boxRef = useRef<Box | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  const begin = useCallback((p: Point, additive: boolean) => {
    startRef.current = { p, additive };
    boxRef.current = null;
    setBox(null);
  }, []);

  const move = useCallback((p: Point) => {
    const s = startRef.current;
    if (!s) return;
    const b = normalizeBox(s.p, p);
    boxRef.current = b;
    setBox(b);
  }, []);

  /**
   * Finish the gesture. Applies the selection and returns true when a real box was drawn; false
   * for no gesture or a click-sized one. `minSize` is 3 SCREEN pixels expressed in drawing units.
   */
  const end = useCallback((stage: Konva.Stage | null, minSize: number): boolean => {
    const s = startRef.current;
    const b = boxRef.current;
    startRef.current = null;
    boxRef.current = null;
    setBox(null);
    if (!s || !b || !stage || isTinyBox(b, minSize)) return false;
    const hits: string[] = [];
    for (const o of ann.objects) {
      const node = stage.findOne(`#${o.id}`);
      // Hidden = the text box open in the editor; missing = an image still decoding.
      if (!node || !node.isVisible()) continue;
      const layer = node.getLayer();
      if (!layer) continue;
      if (boxesTouch(b, node.getClientRect({ relativeTo: layer }))) hits.push(o.id);
    }
    ann.selectMany(hits, s.additive);
    return true;
  }, [ann]);

  return { box, begin, move, end };
}
```

- [ ] **Step 2: Update `components/markup/AnnotationObjects.tsx`.**
  1. Add `import type { Box } from '@/lib/markup/selection';`.
  2. In `AnnotationObjectsProps`:
     - replace `selectedId: string | null;` with `selectedIds: string[];`;
     - replace `onSelect: (id: string) => void;` with `/** Shift (additive) toggles; see pickId. */ onSelect: (id: string, additive: boolean) => void;`;
     - add `/** The live selection box, in the same drawing space as the objects. */ marquee?: Box | null;`.
  3. In the destructuring, replace `selectedId` with `selectedIds` and add `marquee = null`.
  4. Replace the Transformer binding effect body and deps with:

```tsx
  // Bind the Transformer to every selected node — except one open in the text editor, where
  // resize handles would fight the caret and sit over the textarea.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const stage = tr.getStage();
    const nodes = stage
      ? selectedIds
          .filter((id) => id !== editingId)
          .map((id) => stage.findOne(`#${id}`))
          .filter((n): n is Konva.Node => !!n)
      : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, objects, activeTool, imgLoadTick, editingId]);
```

  5. In `handleObj`, replace `else if (activeTool === 'pointer') { e.cancelBubble = true; onSelect(id); }` with `else if (activeTool === 'pointer') { e.cancelBubble = true; onSelect(id, e.evt.shiftKey); }`.
  6. Replace the `onDragEnd` line in `common` with:

```tsx
      // Konva's Transformer drags the other selected nodes along with this one. Persist every
      // selected position here rather than trusting each node to report its own dragend, so a
      // group move can never leave state behind the canvas. Writing the same value twice is harmless.
      onDragEnd: isDraft ? undefined : (e: Konva.KonvaEventObject<DragEvent>) => {
        const stage = e.target.getStage();
        const ids = selectedIds.includes(obj.id) ? selectedIds : [obj.id];
        for (const sid of ids) {
          const n = sid === obj.id ? e.target : stage?.findOne(`#${sid}`);
          if (n) onChange(sid, { x: n.x(), y: n.y() });
        }
      },
```

  7. In the returned fragment, after `<Transformer … />`, add:

```tsx
      {marquee && (
        <Rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.width}
          height={marquee.height}
          stroke="#5B60FF"
          strokeWidth={1}
          dash={[4, 4]}
          fill="rgba(91, 96, 255, 0.08)"
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
```

- [ ] **Step 3: Type-check.** Run `npx tsc --noEmit`. Expected: it FAILS only in `PDFKonvaViewer.tsx` and `AnnotationCanvas.tsx`, at their `<AnnotationObjects selectedId=… onSelect=…>` usage. Task 4 fixes those, so don't commit a broken tree on its own: continue straight into Task 4 and commit Tasks 3 and 4 together at the end of Task 4.

---

### Task 4: Wire both surfaces

**Files:** Modify `components/viewers/PDFKonvaViewer.tsx` and `components/markup/AnnotationCanvas.tsx`, and commit with Task 3's files.

**Interfaces:** Consumes `useMarqueeSelect` (Task 3) and `ann.selectedIds`, `ann.pick`, `ann.deleteSelected`, `ann.applyStyleToSelected` (Task 2).

Make the same six changes in each surface. Below, `P` is the PDF viewer and `C` is AnnotationCanvas. Locate each anchor by its text; line numbers drift.

- [ ] **Step 1: Import and create the box hook.** Add `import { useMarqueeSelect } from '@/components/markup/useMarqueeSelect';`. Directly after `const ann = useAnnotationObjects();` add `const marquee = useMarqueeSelect(ann);`.

- [ ] **Step 2: Pointer press on empty space starts the box.**
  - **P:** in `handleStageMouseDown`, replace the body of the `if (activeTool === 'pointer') { … }` branch (the one with the "Empty sheet clears the markup selection" comment) with:

```tsx
        // A press on a dimension clears the markup selection (one Delete key answers to both
        // selections, so at most one may be live — see the comment this replaced in git history).
        if (e.target.getLayer() === measureLayerRef.current) {
          ann.setSelectedId(null);
          return;
        }
        // Empty sheet: start a selection box. A plain press also clears the selection (a click
        // that never becomes a box is exactly the old "click empty space to deselect"); Shift
        // keeps it, so a Shift+box adds.
        if (e.target === stage) {
          if (!e.evt.shiftKey) ann.setSelectedId(null);
          marquee.begin(coords, e.evt.shiftKey);
        }
        return;
```

    Keep the original long comment above the branch if one sits there, trimmed to match. Confirm `coords` is the page-space point this handler already computed with `getPageCoords`. Add `marquee.begin` to the `useCallback` deps.
  - **C:** in `handleMouseDown`, make the same replacement in its `if (activeTool === 'pointer') { … }` branch, using `p` in place of `coords`.

- [ ] **Step 3: Pointer move grows the box.**
  - **P:** in `handleStageMouseMove`, insert directly before the final `const coords = getPageCoords(stage);` / `ann.moveDraw` lines:

```tsx
      if (activeTool === 'pointer') {
        const c = getPageCoords(stage);
        if (c) marquee.move(c);
        return;
      }
```

    Add `marquee.move` to its deps.
  - **C:** in `handleMouseMove`, insert `if (activeTool === 'pointer') { marquee.move(p); return; }` directly before the final `ann.moveDraw(...)` line.

- [ ] **Step 4: Release or leave ends the box.** On the `<Stage>`, change the two inline handlers.
  - **P:** `3 / stageScale` is 3 screen pixels in page units:
    - `onMouseUp={() => { stopErasing(); marquee.end(stageRef.current, 3 / stageScale); if (ann.endDraw()) onObjectCreated?.(); }}`
    - `onMouseLeave={() => { stopErasing(); marquee.end(stageRef.current, 3 / stageScale); if (ann.endDraw()) onObjectCreated?.(); onMeasureHover?.(null); }}`
  - **C:** use the same handlers with `marquee.end(stageRef.current, 3)`. Check the Stage ref's name in AnnotationCanvas (it may not be `stageRef`) and use it.

- [ ] **Step 5: AnnotationObjects props.** In both surfaces' `<AnnotationObjects …>`:
  - replace `selectedId={ann.selectedId}` with `selectedIds={ann.selectedIds}`;
  - replace `onSelect={ann.setSelectedId}` with `onSelect={ann.pick}`;
  - add `marquee={marquee.box}`.

- [ ] **Step 6: Delete and restyle act on the whole selection.** In both surfaces:
  - **Delete/Backspace effect:** replace `if (ann.selectedId) { e.preventDefault(); ann.deleteObject(ann.selectedId); }` with `if (ann.selectedIds.length) { e.preventDefault(); ann.deleteSelected(); }`. Update that effect's deps from `ann.selectedId, ann.deleteObject` to `ann.selectedIds, ann.deleteSelected`, and keep `annotating` first on P.
  - **Handle:** in `useImperativeHandle`, replace `applyStyleToSelection: (patch) => { if (ann.selectedId) ann.applyStyle(ann.selectedId, patch); },` with `applyStyleToSelection: (patch) => ann.applyStyleToSelected(patch),`.

- [ ] **Step 7: Gate.** Run `npx tsc --noEmit && npm run lint && npm test`, all clean.

- [ ] **Step 8: Commit Tasks 3 and 4 together.**

```bash
git add components/markup/useMarqueeSelect.ts components/markup/AnnotationObjects.tsx components/viewers/PDFKonvaViewer.tsx components/markup/AnnotationCanvas.tsx
git commit -m "feat(markup): shift+click and drag-box multi-select with group move, resize, delete and restyle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Arrow gets its own toolbar button

**Files:** Modify `components/markup/DrawingTools.tsx`

- [ ] **Step 1: Move the arrow out of the Shapes menu.**
  1. Cut the `{ id: 'arrow', label: 'Arrow', icon: (…) }` entry out of `SHAPE_TOOLS`.
  2. Turn its icon into a module constant next to the other icon constants (where `FreehandIcon` is defined):

```tsx
const ArrowIcon = (
  <svg {...ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="13" x2="13" y2="3" />
    <polyline points="7.5,3 13,3 13,8.5" />
  </svg>
);
```

  3. Directly after `{pickTool('freehand', 'Freehand', FreehandIcon)}`, add `{pickTool('arrow', 'Arrow', ArrowIcon)}`.
  4. Update the comment `{/* Shapes — folds line/arrow/rect into one slot */}` to `{/* Shapes — folds line/rect/ellipse/cloud into one slot */}`, and any doc comment near line 242 that lists the Shapes contents.
  5. `shapeActive` derives from `SHAPE_TOOLS`, so the Shapes button no longer lights up for the arrow, which is correct now that the arrow has its own button.

- [ ] **Step 2: Gate.** Run `npx tsc --noEmit && npm run lint`, both clean.

- [ ] **Step 3: Commit**

```bash
git add components/markup/DrawingTools.tsx
git commit -m "feat(markup): Arrow gets its own toolbar button beside Freehand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Browser verification and cleanup

`npm run dev` cannot load pdf.js on this checkout, a pre-existing problem. Verify on `npm run build` plus `npx next start -p 3000`.

- [ ] **Step 1: Harness (never committed).** Create `app/portal/harness-markup/page.tsx`, a `'use client'` page under `/portal/` so the middleware lets it through, with no leading underscore. It renders:
  1. `PDFKonvaViewer` via `next/dynamic` with `ssr:false` on a multi-page PDF in `public/uploads/harness-markup.pdf`. Generate it with a small raw-PDF script in the session scratchpad. It needs `annotating`, `activeTool`, `color` and `strokeWidth` from harness state, and a `handleRef` so the harness can call `applyStyleToSelection`.
  2. The real `DrawingTools` toolbar wired to that state. Read its props in `DrawingTools.tsx` and pass harmless values for anything unrelated.
  3. `AnnotationCanvas` with a static background image from `public/uploads/` (`AnnotationCanvas` is used for image markup; read its props).
  4. A small button bar: annotating on/off, and "apply red" (calls `applyStyleToSelection({ color: '#FF0000' })` on the active surface's handle).

- [ ] **Step 2: Checks.** Record pass/fail with evidence; prefer evaluate-based state over screenshots. Run each on BOTH the PDF viewer (annotating on) and AnnotationCanvas unless noted:
  1. **Toolbar:** Pointer · Freehand · **Arrow** · Shapes (DOM order). The Shapes sub-bar has no Arrow. The Arrow button draws an arrow, and the toolbar marks Arrow active, not Shapes.
  2. **Shift+click:** draw a rect, an arrow and a text. Click rect, then Shift+click arrow: the Transformer has 2 nodes. Shift+click arrow again: 1 node.
  3. **Box selects touching:** a box from empty space that partly overlaps the rect and the arrow selects both, not the text. A box over nothing clears the selection.
  4. **Shift+box adds:** with the text selected, a Shift+box over the rect leaves 2 selected.
  5. **Group drag:** with 3 selected, drag one. All three move on the canvas, and state agrees: deselect and reselect each; the Transformer box sits on the moved object. Or read node positions after a re-render.
  6. **Group resize/rotate:** drag a Transformer corner with 2+ selected. Both scale, and text font size grows (it bakes).
  7. **Delete:** Delete with 3 selected removes all 3. It does nothing while typing in the text editor.
  8. **Restyle:** "apply red" with 2 selected recolours both. An image in the selection is unchanged.
  9. **Click-size drag:** a press-and-release on empty space without moving clears the selection, as before.
  10. **PDF only:** with annotating OFF, Pointer drag still pans the page.
  11. **Measurement interplay:** if a measure tool is easy to reach in the harness, check that a selected dimension is cleared by a markup selection and vice versa. Otherwise note it as not checked.
  12. The console has no errors apart from known harness noise.

- [ ] **Step 3: Clean up and final gate.** Delete `app/portal/harness-markup`, `.next/types/app/portal/harness-markup` and the harness files in `public/uploads/`. Run `npx tsc --noEmit && npm run lint && npm test && npm run build`, all clean. Use the env-var fallback for the build if needed: `AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build`. `git status --short` must show only the five long-lived untracked dirs.
