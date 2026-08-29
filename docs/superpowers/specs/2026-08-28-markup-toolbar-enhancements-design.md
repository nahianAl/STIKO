# Markup toolbar enhancements — design

Date: 2026-08-28

Five independent enhancements to the portal markup tools: rotation snapping, two new
shapes, shift-constrained drawing, drag-to-erase, and an extended colour row with a
custom picker.

## Context

The markup stack is one shared object model behind two drawing surfaces:

- `components/markup/useAnnotationObjects.ts` — the object model and all draw-gesture
  state (`startDraw` / `moveDraw` / `endDraw`), shared by both surfaces.
- `components/markup/AnnotationObjects.tsx` — renders objects and owns the Konva
  `Transformer`, shared by both surfaces.
- `components/markup/AnnotationCanvas.tsx` — the untransformed surface (3D snapshots,
  images, picked attachments). Owns its own pointer handlers.
- `components/viewers/PDFKonvaViewer.tsx` — the PDF surface. Owns its own pointer
  handlers and a zoomed/panned stage, so it converts screen coords to stage coords
  before calling into the hook.
- `components/markup/DrawingTools.tsx` — the floating toolbar.
- `components/viewers/TransformGizmo.tsx` — the 3D drei `TransformControls`, a
  separate concern that shares only the word "rotate".

Anything touching draw gestures or rendering lands once in the shared files. Anything
touching pointer handling lands twice, once per surface.

## 1. Rotation snap — shift snaps to absolute 0/90/180/270

Applies to **both** rotate affordances: the Konva `Transformer` on a markup object, and
the 3D gizmo on the model or a cross-section plane.

Snapping is **absolute**, not incremental: an object at 7° goes to 0°, not 97°. Shift
therefore always produces an axis-aligned result, which is the point of the gesture.

### Markup Transformer

Konva's `rotationSnaps` are already absolute angles, so this is a prop swap in
`AnnotationObjects.tsx` gated on a shift flag tracked with `window` keydown/keyup
listeners:

```tsx
rotationSnaps={shiftHeld ? [0, 90, 180, 270] : []}
rotationSnapTolerance={45}
```

The default tolerance is 5°, which would snap only near-aligned rotations. 45° makes
every angle fall within reach of the nearest of the four.

### 3D gizmo

`TransformGizmo.tsx` gets the same shift ref plus an `onObjectChange` handler that, while
shift is held and `mode === 'rotate'`, rounds each component of the target's Euler
rotation to the nearest `Math.PI / 2`. `onMouseUp` already reads rotation off the target
to build the commit payload, so the persisted value is the snapped one with no further
plumbing.

Accepted consequence: rounding all three Euler axes means an object already at 7° on X
also straightens on X when you shift-rotate about Y. This is intended — "snap the object
to the nearest 90" is read as a statement about the object's final orientation, not about
the delta of one drag.

Note the existing lifecycle hazards in this file (the orbit-controls re-enable and the
`draggingRef` reset on unmount): the shift listener must be removed on unmount for the
same reason, or a stale listener keeps mutating a detached target.

## 2. Ellipse and cloud shapes

`'ellipse'` and `'cloud'` are added to `AnnotationObjectType`, `AnnTool`, and
`GESTURE_TOOLS`, and reuse the rect drag math verbatim:

- `startDraw` sets `x`, `y` from the press point.
- `moveDraw` sets `width`, `height` as deltas (either sign).
- `endDraw` normalises negative extents and applies the same `> 3px` validity test.

No new fields on `AnnotationObject`.

### Rendering

Both render as a Konva `<Shape sceneFunc>` drawing inside a box-local `(0,0) → (w,h)`
frame, **not** as `<Ellipse>`.

Konva's `Ellipse` is centre-origin. Using it would make `x` mean "centre" for ellipses and
"top-left" for rects, and `onDragEnd` in `AnnotationObjects.tsx` writes `e.target.x()`
straight back into the object — so the two conventions would quietly corrupt position on
the first drag. A box-local `sceneFunc` keeps one origin convention across every box
shape. The cloud needs a custom path regardless.

Each `Shape` sets explicit `width`/`height` props so the `Transformer` derives a correct
bounding box.

- **Ellipse**: one `ctx.ellipse` inscribed in the box. Stroke only, no fill.
- **Cloud**: a revision cloud — a closed path of outward scalloped arcs around the box
  perimeter. Scallop radius is derived from `min(w, h)` with a per-side minimum count, so
  a small cloud still reads as a cloud and a large one does not grow absurd bumps. Stroke
  only, no fill.

Hit-testing for stroke-only `Shape` nodes needs an explicit `hitFunc` (or a filled hit
path), or clicks inside an unfilled shape will pass through — the eraser and the pointer
both depend on hitting these.

### Toolbar

Two more entries in `SHAPE_TOOLS` in `DrawingTools.tsx`, with icons in the existing
hairline style, sized optically to match the row.

## 3. Shift-constrains the drawing gesture

`moveDraw` gains a `constrain: boolean` parameter, passed by both surfaces from
`e.evt.shiftKey`:

- **rect / ellipse / cloud** — both extents take the magnitude of the *larger* of the two,
  each keeping its own sign. A square box, so an ellipse becomes a perfect circle, the drag
  still tracks all four directions, and a mostly-vertical drag is not collapsed to the
  width it happens to have.
- **line / arrow** — snap the segment angle to the nearest 45°, preserving length along
  the snapped direction.
- **freehand** — ignored.

The constraint is evaluated per mousemove. Pressing or releasing shift mid-drag takes
effect on the next pointer move rather than instantly; that matches every other design
tool and does not justify a keyboard listener.

`endDraw` needs no changes — it reads `draftRef`, which already holds constrained values.

## 4. Drag to erase

Dragging with the eraser active deletes every object the drag path crosses. Erasure is
object-level: objects are atomic in this model, so there is no partial or pixel erase.

In each surface's pointer handlers:

- **mousedown** with `activeTool === 'eraser'` sets an `erasingRef` and records the point.
- **mousemove** while `erasingRef` is set: interpolate a handful of points between the
  previous and current pointer position, and for each call `stage.getIntersection(pt)`,
  resolve the hit node's owning object id, and `deleteObject` it. Interpolation is what
  stops a fast flick from skipping objects between frames.
- **mouseup / mouseleave** clears `erasingRef`.

`stage.getIntersection` takes container-space coordinates, which is exactly what
`getPointerPosition()` returns on both surfaces — so Konva's own hit graph handles
rotation, scale, and the PDF stage's zoom/pan for free. This is the one place where the
PDF surface must **not** convert to stage coordinates first.

The existing per-object mousedown erase handler in `AnnotationObjects.tsx` stays as-is and
covers the click/tap case.

Guards: the background layer is already `listening={false}` on `AnnotationCanvas`, and the
`Transformer` is not selectable while the eraser is active (the tool-change effect clears
the selection), so neither can be hit. A hit node with no resolvable object id is ignored
rather than assumed.

This is the one item duplicated across both surfaces rather than shared. Extracting it
would require a hook that knows about two different coordinate spaces to do one thing;
~15 duplicated lines is the cheaper trade.

## 5. Colours — black, and a custom picker

### Black

New `lib/markup/colors.ts` exporting `MARKUP_COLORS`: the five existing pastels
**re-exported from `PALETTE`** (not copied — one source of truth for the shared five) plus
one entry:

```ts
{ name: 'black', swatch: '#9AA1AC', accent: '#111111' }
```

Grey chip, black stroke — the swatch row's colour language is "chip is a pastel hint of
the stroke", and a black chip in a row of pastels reads as a hole rather than a colour.

`lib/commentColors.ts` keeps exactly five entries. Adding a sixth would change
`paletteForKey`'s modulus and silently reshuffle the pin and avatar colour of every
existing comment, and a black comment pin reads as a rendering bug. `drawingColor` only
feeds markup stroke — pins derive their colour from the author hash — so the two lists can
diverge safely.

`DrawingTools.tsx` renders the swatch row from `MARKUP_COLORS` instead of `PALETTE`.

### Gradient picker

The last chip in the toolbar. It shows a rainbow gradient and opens a Stiko-styled
popover in the existing `SUB_BAR` language — hue strip, saturation/value area, hex field.
It is a third `menu` value alongside `'shapes'` and `'stroke'`, so the existing
single-open-sub-bar rule and outside-click dismissal cover it with no new machinery.

The picker calls the same `onColorChange`, so it restyles a selected object exactly as a
swatch does. Once a custom colour is chosen the chip shows a ring of that colour over the
gradient, so the current selection is visible without opening the popover.

The row goes from five chips to seven. The bar has room at the current 20px chip size.

## Testing

`npm test` runs `node --test scripts/tests/*.mjs`. The established pattern in this repo is
to extract pure logic into a self-contained `lib/` module and unit-test that, leaving the
React component as thin wiring — see `lib/markup/text.ts` with
`scripts/tests/markupText.test.mjs`, and `lib/crossSection.ts` with
`scripts/tests/crossSection.test.mjs`.

Every piece of arithmetic here follows that pattern. New pure modules, each with its own
test file:

- `lib/markup/draft.ts` — draft geometry for every gesture tool, including both shift
  constraints and box normalisation.
- `lib/markup/rotationSnap.ts` — the snap angle set, the Konva tolerance, and Euler
  right-angle rounding.
- `lib/markup/cloud.ts` — the scallop arc geometry for the cloud path.
- `lib/markup/eraseSweep.ts` — interpolation of sample points along an eraser drag.
- `lib/markup/colors.ts` — the markup colour list.
- `lib/markup/color.ts` — hex/HSV conversion for the picker.

These modules must stay import-clean for the node runner: no `@/` alias imports, since
the test runner resolves neither the alias nor JSX. `colors.ts` reaches `PALETTE` by
relative path.

The component wiring on top of those modules is verified manually in a browser, per
`stiko-local-visual-verification`, exercising each item on **both** surfaces (a 3D snapshot
session and a PDF session):

1. Shift-rotate a markup object → lands on 0/90/180/270. Shift-rotate the 3D model and a
   cross-section plane → same.
2. Draw an ellipse and a cloud; select, move, scale, rotate, and erase each.
3. Shift-drag each box shape → square/circle. Shift-drag line and arrow → 45° steps.
4. Drag the eraser across several objects, fast and slow → all crossed objects vanish.
5. Pick black → black stroke, grey chip. Pick a custom colour → chip reflects it, and
   picking it with an object selected restyles that object.
6. Confirm comment pin and avatar colours are unchanged.

## Out of scope

- Persisting custom colours as recent swatches.
- Pixel-level erasing.
- Shift-snapping the 3D translate gizmo.
- Any change to comment pin or avatar colours.
