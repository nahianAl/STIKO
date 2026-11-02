# Markup: standalone Arrow button + multi-select

Date: 2026-11-02
Branch: `feature/markup-multiselect` (off `main` at c8b907f)
Status: design approved in conversation

## 1. Arrow button

- The toolbar order becomes: Comment pin · Pointer · Freehand · **Arrow** · Shapes · …
- The Arrow tool **moves out** of the Shapes sub-bar. Shapes keeps Line, Rectangle, Ellipse
  and Cloud.
- The Arrow tool's id (`'arrow'`), icon, drawing and object type are unchanged. Only its
  position in `components/markup/DrawingTools.tsx` changes.

## 2. Multi-select

Applies whenever the **Pointer** tool is armed on a markup surface:
- the PDF viewer during a markup session;
- `AnnotationCanvas` (images, 3D snapshots, video frames).

The two surfaces share `useAnnotationObjects` and `AnnotationObjects`, so both get the
feature.

### Gestures

| Gesture | Result |
|---|---|
| Click an object | Select only that object. If it is **already** selected, the selection is kept, so a drag moves the whole group. |
| Shift+click an object | Toggle it in or out of the selection. |
| Click empty space | Clear the selection. |
| Drag on empty space | Dashed accent (`#5B60FF`) selection box. On release, every object the box **touches** (bounding boxes intersect) is selected, replacing the selection. |
| Shift+drag on empty space | Same, but the hits are **added** to the current selection. |
| A drag shorter than 3 screen pixels | Counts as a click (clears the selection, or keeps it with Shift). |

### What the selection does

- **One Transformer** wraps all selected objects.
  - Dragging any selected object moves them all (Konva's Transformer drags its other nodes
    along).
  - The handles resize and rotate the group. Shift snaps rotation as today.
  - Text in the group bakes its new scale into its font size, as a single text box does.
- **Delete/Backspace** removes every selected object (not while typing).
- **The colour and stroke chips** (`applyStyleToSelection`) restyle every selected object.
  Images ignore style; on text, width means font size, as today.
- **The toolbar** reflects the **first** selected object (`onSelectionChange` is unchanged).
- **Double-click on text** still opens the editor for that text.
- **Snapshots** clear the whole selection before capture, as today.

### Unchanged

- **Measurements** are not markup: the selection box ignores them. Selecting markup still
  clears a selected measurement, and vice versa.
- **The eraser** works as before. Erasing a selected object removes it from the selection.
- **Shift while drawing** still straightens shapes. Shift-select only applies to the Pointer.
- **Outside a markup session**, the PDF viewer's Pointer still pans.

## Architecture

- **`lib/markup/selection.ts`** (new, pure, no imports, unit-tested):
  - `pickId(ids, id, additive)`
  - `mergeSelection(current, hits, additive)`
  - `normalizeBox(a, b)`
  - `boxesTouch(a, b)`
  - `isTinyBox(box, minSize)`
- **`useAnnotationObjects`**: the single `selectedId` becomes `selectedIds: string[]`.
  - Kept for existing callers: `selectedId` (= the first selected id), `setSelectedId(id | null)` (replaces the selection) and `selectedObject` (the first selected object).
  - New: `selectedIds`, `pick(id, additive)`, `selectMany(ids, additive)`, `deleteSelected()` and `applyStyleToSelected(patch)`.
  - `deleteObject` also removes the id from the selection.
- **`components/markup/useMarqueeSelect.ts`** (new): the box gesture.
  - `begin(p, additive)`, `move(p)` and `end(stage, minSize): boolean` and `cancel()`, plus the live `box` for rendering.
  - `end` hit-tests each object's Konva node via `getClientRect({ relativeTo: node.getLayer() })`, which is the same space the pointer coordinates are in on both surfaces. It skips hidden nodes (the text being edited).
- **`AnnotationObjects`**:
  - takes `selectedIds` and `onSelect(id, additive)`;
  - binds the Transformer to every selected node;
  - renders the marquee `Rect` (`listening={false}`, `strokeScaleEnabled={false}`, dashed).
- **Both surfaces** route their Pointer handlers as follows:
  - **mousedown** on empty stage → `begin`;
  - **move** → `move`;
  - **mouseup/leave** → `end`;
  - **Delete** → `deleteSelected`;
  - **`applyStyleToSelection`** → `applyStyleToSelected`.

## Testing

- **Unit:** `scripts/tests/markupSelection.test.mjs` covers every export of `lib/markup/selection.ts`.
- **Static:** `npx tsc --noEmit`, lint, `npm test`, `npm run build`.
- **Browser** (production build plus a throwaway harness route; the dev server cannot load pdf.js):
  - the Arrow button position, and that it draws an arrow;
  - Shift+click toggling;
  - box select (touching) and Shift+box adding;
  - group drag persisting every object's position;
  - group resize and rotate;
  - Delete removing all selected;
  - colour applying to all selected;
  - measurement deselect interplay;
  - on both the PDF viewer and `AnnotationCanvas`.
