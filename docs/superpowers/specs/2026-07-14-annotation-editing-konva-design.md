# Annotation Editing (Select / Move / Scale / Rotate / Erase) — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Scope:** The in-session annotation experience across all file types (image, video, 3D/CAD, PDF)

---

## Problem

Annotations today are draw-only. Once a freehand stroke, line, arrow, rect, or text is placed, it cannot be selected, moved, scaled, rotated, or deleted — the only recourse is Discard (throw away the whole session) and start over. The drawing surface is also split: image/video/3D annotate on a raw **SVG** overlay (`MarkupOverlay`), while PDF annotates on a **Konva** stage (`PDFKonvaViewer`). SVG has no built-in hit-testing or transform handles, so adding editing to it would mean hand-writing bounding boxes, resize/rotate handles, and transform math per shape type.

## Goal

Add a real editing layer to annotations — **object eraser** (click to delete) and **select → move + scale + rotate** — uniformly across every file type, by **unifying annotation objects onto Konva** (whose `Transformer` provides move/scale/rotate handles and whose nodes provide hit-testing and dragging for free).

Annotations remain **ephemeral**: they exist only during an annotation session and are flattened into a JPEG attached to a comment on **Done**. Editing therefore operates on in-session objects, before posting.

---

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Eraser | Object eraser — Eraser tool active, click an object → the whole object is removed |
| 2 | Transforms | Move + scale + rotate (Konva `Transformer`) |
| 3 | Selection | The **Pointer** tool is the select tool; selecting/transforming happens when no draw tool is active |
| 4 | Build approach | Unify annotation objects on **Konva** for all file types |
| 5 | Lifecycle | Pointer no longer ends a session; **Done/Discard are the only exits** |
| 6 | Styling scope | Color/stroke apply to **new** objects only (no re-styling existing objects this pass) |
| 7 | PDF | Annotation targets the **current page**; Done captures the current stage view |

---

## Session lifecycle (revised)

**Live view (no active session):**
- Viewers behave normally; `MarkupOverlay` shows comment pins and handles tag placement.
- **Pointer** navigates (image zoom/pan, 3D orbit, PDF pan/zoom). Draw tools are available in the toolbar.

**Starting a session:**
- Picking any draw tool (`freehand`/`line`/`arrow`/`rect`/`text`) starts a session.
- **Non-PDF**: the current viewer frame is captured to a frozen snapshot (`captureViewerSnapshot`, as today) and shown as the Konva background.
- **PDF**: no freeze — objects are drawn on the live Konva page.

**During a session** (the Done/Discard banner is shown):
- **Pointer** = **Select**: click an object → select it (Transformer handles appear); drag to move; corner handles scale; rotate handle rotates; click empty space deselects.
- **Draw tools** add new objects; **Eraser** click-deletes an object.
- Color/stroke set the style of *new* objects.

**Exiting a session:**
- **Done**: deselect (hide handles) → `stage.toDataURL({ pixelRatio: 2 })` → `dataUrlToFile` → append to the composer's pending files (unchanged downstream) → clear objects/snapshot → return to live view.
- **Discard**: clear objects/snapshot → return to live view.
- **File/version change**: same reset as Discard.
- Pointer does **not** exit or clear the session (removes the prior "stale strokes on pointer-exit" edge, which no longer applies because the pointer stays inside the session).

**Explicit session state.** The portal holds an `annotating: boolean`, the single source of truth for "a session is active" (and thus whether the Done/Discard banner shows and whether Pointer means select-vs-navigate):
- `annotating` becomes **true** when a **draw tool** is selected from a non-annotating state (the only session-starter). Non-PDF additionally captures the frozen snapshot at this moment.
- It stays **true** across switches to Pointer, Eraser, or other draw tools.
- It becomes **false** only on **Done**, **Discard**, or file/version change.
- Selecting **Pointer** or **Eraser** while not annotating does nothing (no session start, no freeze) — there is nothing to select or erase yet.

`activeTool` values usable in a session: `pointer` (select), `freehand`, `line`, `arrow`, `rect`, `text`, `eraser`.

---

## Unified annotation core (shared, Konva)

### Object model

```ts
type AnnotationObjectType = 'freehand' | 'line' | 'arrow' | 'rect' | 'text';

interface AnnotationObject {
  id: string;                       // `obj-${counter}` (session-local; counter, not time-based)
  type: AnnotationObjectType;
  // geometry in stage/pixel space
  points?: number[];                // freehand/line/arrow: flat [x1,y1,x2,y2,...]
  x?: number; y?: number;           // rect/text origin
  width?: number; height?: number;  // rect
  text?: string; fontSize?: number; // text
  // node transform (written back on drag/transform end)
  rotation: number; scaleX: number; scaleY: number;
  // style
  color: string; strokeWidth: number;
}
```

Rendered as: `freehand`/`line` → Konva `Line`, `arrow` → `Arrow`, `rect` → `Rect`, `text` → `Text`. Each node carries `id={obj.id}`, `draggable={activeTool === 'pointer'}`, and `x/y/rotation/scaleX/scaleY` from the object.

Note on ids: use a monotonically increasing per-session counter (`useRef`), not `Date.now()`/`Math.random()`, so ids are stable and deterministic within a session.

### Shared logic — `useAnnotationObjects`

A hook owning:
- `objects: AnnotationObject[]`, `selectedId: string | null`.
- Stage event handlers driven by `activeTool`:
  - **draw tools**: `onStageMouseDown/Move/Up` build a new object (start point → drag → commit), mirroring the current PDF/SVG drawing flow, then append to `objects`.
  - **pointer**: `onObjectClick(id)` selects; `onStageClickEmpty` deselects; on node `dragEnd`/`transformEnd`, write the node's `x/y/rotation/scaleX/scaleY` back into the object.
  - **eraser**: `onObjectClick(id)` removes the object.
- `clearObjects()`, `hasObjects()`.
- `captureSnapshot(stage)`: set `selectedId = null` (so the Transformer detaches), then `stage.toDataURL({ pixelRatio: 2, mimeType: 'image/jpeg', quality: 0.88 })`.

### Shared rendering

- An **objects renderer** mapping `AnnotationObject → Konva shape` (used by both surfaces).
- A **`SelectionTransformer`**: a Konva `Transformer` bound to the currently-selected node (looked up by `selectedId`), with `rotateEnabled`, corner resize anchors, kept in a layer that is excluded from capture (detached before `toDataURL`).

The Transformer must be detached (or its layer hidden) during capture so handles never appear in the flattened image.

---

## Per-file-type integration

### Image / video / 3D-CAD — new `AnnotationCanvas` component

- A Konva `<Stage>` sized to the viewer area, mounted by the portal when `annotating && !isPDFFile`. It **replaces** both the SVG markup layer (`MarkupOverlay` drawing) and the portal's frozen `viewerSnapshot` `<img>` — the frozen snapshot becomes this stage's Konva background image instead of a separate DOM `<img>`.
- Layers: **background** (Konva `Image` from the frozen snapshot dataURL loaded into an `HTMLImageElement`), **objects** (shared renderer), **transformer**.
- Hosts `useAnnotationObjects`; wires stage events; exposes an imperative handle `{ captureSnapshot(), clearObjects(), hasObjects() }`.
- Objects live in stage pixel space (the snapshot is a fixed frame at viewer-area size — no percent conversion needed).

### PDF — extend `PDFKonvaViewer`

- Reuse `useAnnotationObjects` + the shared objects renderer + `SelectionTransformer` inside the existing PDF stage, alongside the page image and comment-pin layers.
- Drawn objects are session-ephemeral in stage/page-pixel space (drop the percent conversion used for the old persisted markups — persistence is gone).
- `draggable`/selection is enabled only when `activeTool === 'pointer'`; stage pan is disabled while a draw/eraser tool is active (as today) and while transforming.
- `captureSnapshot()` already exists at `pixelRatio: 2`; add the deselect-before-capture step.

---

## Toolbar (`DrawingTools`)

Add an **Eraser** tool. Final standalone set: `pointer`, `freehand`, `text`, `eraser`, plus the shapes dropdown (`line`/`arrow`/`rect`) and the color/stroke pickers. The comment tool stays removed; the `'comment'` `ToolType` literal stays (unused).

`ToolType` gains `'eraser'` in every file that declares the union (portal, DrawingTools, MarkupOverlay, PDFKonvaViewer, ViewerContainer, AnnotationCanvas). `DRAW_TOOLS` (the set that starts/holds a session) is `freehand/line/arrow/rect/text`; `pointer` and `eraser` are session tools but not session-starters (eraser only makes sense once a session exists).

---

## What gets removed / slimmed

- **`MarkupOverlay`** loses drawing: SVG markup rendering, the drawing preview, the text popup, `saveMarkup`, and the `getSvgElement`/`clearDrawings` handle. It keeps **comment pins** (2D + 3D-projected) and **tag placement** for live view. This is a significant, healthy shrink of an over-loaded component.
- **`compositeSnapshotWithMarkup`** (portal) is removed — capture is now a single Konva `toDataURL`.
- The portal's snapshot-capture effect changes: it still captures the frozen frame for non-PDF on session start, but no longer clears on pointer; clearing happens on Done/Discard/file change.

---

## Data flow (Done)

```
User draws/edits objects on the Konva surface (AnnotationCanvas or PDF stage)
  → clicks Done
  → portal calls the active surface's captureSnapshot()  (deselect → stage.toDataURL @2×)
  → dataUrlToFile(dataUrl, `annotation-<counter>.jpg`)
  → setComposerFiles([...prev, file])         (existing composer pipeline)
  → session cleared, return to live view
  → user adds optional text → Send  → attachment uploaded as an image (existing flow)
```

No API or schema changes. Downstream (attachment upload, inline display, open-in-viewport) is unchanged.

---

## Files affected

**Create:**
- `components/markup/useAnnotationObjects.ts` — shared object model + interaction logic + capture.
- `components/markup/AnnotationObjects.tsx` (or a render helper) — shared Konva object renderer + `SelectionTransformer`.
- `components/markup/AnnotationCanvas.tsx` — non-PDF Konva editing surface over the frozen snapshot.

**Modify:**
- `components/markup/DrawingTools.tsx` — add the Eraser tool; `ToolType` += `'eraser'`.
- `components/markup/MarkupOverlay.tsx` — remove drawing; keep pins + tagging.
- `components/viewers/PDFKonvaViewer.tsx` — replace ephemeral per-page markups with the shared object model + Transformer + eraser; deselect-before-capture.
- `components/viewers/ViewerContainer.tsx` — `ToolType` += `'eraser'` (thread-through only; the non-PDF `AnnotationCanvas` is mounted by the portal, not here).
- `app/portal/[id]/page.tsx` — session lifecycle (pointer no longer clears; explicit "annotating" state); mount `AnnotationCanvas` for non-PDF during a session; route Done/Discard capture to the active surface; remove `compositeSnapshotWithMarkup`; `ToolType` += `'eraser'`.

---

## Scope boundaries (out of scope this pass)

- Re-styling an existing object's color/stroke after it's drawn (style applies to new objects only).
- Editing an already-posted annotation (posted snapshots are flat images).
- Multi-select / group transform (one selected object at a time).
- PDF multi-page annotation in a single session (current page is the target; Done captures the current view).
- Undo/redo history.

---

## Testing notes (no test runner in this repo)

Gate: `npx tsc --noEmit` + `npm run lint` + `npm run build`. Behavioral checks (manual, per file type where applicable):

- **Draw** each object type (freehand/line/arrow/rect/text) on image, video, 3D, PDF.
- **Select** (Pointer): click an object → handles appear; drag moves it; corner handle scales; rotate handle rotates; click empty deselects.
- **Erase**: Eraser tool → click an object → it's removed; other objects untouched.
- **Done**: the flattened JPEG reflects the final edited positions/rotations/scales and contains **no transform handles**; it attaches to the composer.
- **Discard**: objects dropped, live view restored.
- **Lifecycle**: switching to Pointer mid-session keeps the session (does not clear); switching between draw tools keeps objects; file/version change clears the session.
- **Capture fidelity**: PDF capture crisp at 2×; non-PDF snapshot matches what was on screen.
- **Regression**: comment pins + tag placement still work in live view; posted image attachments still open in the viewport; PDF page nav + zoom still work outside a session.
