# Measure tool refinements — design

Date: 2026-09-16
Status: approved, not yet implemented
Follows: `docs/superpowers/specs/2026-09-16-measure-tool-design.md` (shipped as `ad3e39e`)

Four changes from testing the measure tool in production: a live preview while measuring,
measurement lines drawn in the markup palette, eraser support, and a 15° Shift snap.

## What this reverses from the original design

Two of these deliberately undo decisions in the original spec, and the reasons those decisions
were made still apply — they were simply outweighed.

**Measurements now carry colour.** The original spec said they must not, so they could never
reach the markup style model and the stroke picker could never relabel itself for an object
with no stroke. The counter-argument won: a measurement that draws in near-black next to
coloured markup doesn't read as something *you* put there. Colour only — measurements still
have no stroke width, and still never go through `onSelectionChange`.

**The eraser now deletes measurements.** The original spec made them immune so a drag-erase
sweeping the viewport couldn't take out a dimension you were about to snapshot. That risk is
real and is accepted: the eraser is how people expect to remove things, and requiring
click-then-Delete for measurements while everything else erases is the more surprising rule.

## Decisions

| Question | Decision |
| --- | --- |
| Colour | Follows the active markup swatch; a selected measurement is recoloured by the picker |
| Selection highlight | Heavier stroke over a white halo — **not** a fixed colour |
| Eraser scope | All three surfaces, including a new live-viewport mode on 3D |
| Shift snap | 15° on measure, **2D only**; line/arrow stay at 45° |
| Preview | Live from the first click; no pre-first-click snap indicator |

### Why Shift is 2D-only

A 3D measurement point is a raycast hit — it lies on the geometry, which is what makes the
reading trustworthy. Snapping the direction to 15° pushes the endpoint off the surface, so the
two constraints fight. Honouring the surface wins; Shift does nothing on a model rather than
silently measuring to a point that isn't on the part.

### Why 15° on measure but 45° on drawing

A dimension often has to follow a real edge at an odd angle — a 30° pitch, a 60° chamfer —
where 45° is too coarse. An annotation arrow usually just wants to be straight. Shift therefore
means two things in one toolbar, which is the accepted cost.

## Live preview

`useMeasurements` gains a `hoverPoint`: the cursor in surface space, set on pointermove while a
gesture is pending. It is cleared on commit, on cancel, on the tool being disarmed, and on a file
switch — anywhere the pending gesture itself is cleared, so a stale hover line can never outlive
the gesture that owns it. The renderers already draw
`pending.points`; they append the hover point as a provisional last point, giving a rubber-band
line with a running value — and for angular, an arc and a degree reading once the vertex is
down.

| Surface | How the hover point is produced |
| --- | --- |
| PDF | `handleStageMouseMove` currently early-returns for measure tools; it reports page coords instead |
| Image | Same, in `AnnotationCanvas` |
| 3D | `SceneInteraction` gains a pointermove path that raycasts with the **same** vertex snap and clipping guard the click uses |

The 3D path raycasts per mouse-move, so it is gated to fire **only while a gesture is pending** —
nothing runs until a first point is placed. Reusing the click's snap and guard is not optional:
a preview that snaps differently from the commit makes the point jump when you click.

**Deliberately not built:** a snap indicator on hover before the first click. It would make
vertex snapping visible instead of a surprise, but it doubles the raycast window and was not
asked for. Noted as the obvious next increment.

## Colour

`Measurement` gains `color: string`, taken from the toolbar's current colour at creation. All
three renderers use it in place of the `#1C2030` constant, including the 3D label's canvas
texture, whose text takes the measurement's colour.

**The selection highlight has to change.** It is currently `#5B60FF`, which is now a colour a
user can pick — a purple measurement would look identical selected and unselected. Selection
becomes a heavier stroke drawn over a wider halo, which reads against any measurement colour on
any background.

The halo colour differs by surface because "the background" does: on the two Konva surfaces it is
the stage's own matte, which those components already know. A 3D scene has no paper, so there the
line simply thickens and the label sprite gains a ring in the measurement's own colour against its
white plate. Do not invent a shared "paper" token for this — the two cases are genuinely different.

Recolouring routes through the portal's existing `selectedMeasurementId` rather than through
`onSelectionChange`. Measurements have no stroke width, so reporting them would make the stroke
picker relabel itself for an object that ignores it. The markup and measurement selections are
already mutually exclusive, so a single colour pick can only ever reach one of them.

## Eraser

### 2D surfaces

The measure layer's `listening` gate opens to the eraser as well as the pointer. Then `eraseAt`
has to be able to find a measurement: it reads `stage.getIntersection(p)?.id()`, and today the
id sits on the `Group` while the leaf shapes carry none. The leaves get the id, and a
`measure-` prefixed id routes to `removeMeasure` instead of `deleteObject`.

**The `obj-N` / `measure-N` id namespacing becomes load-bearing.** It was previously an
accident that happened to stop the two stores colliding; after this change, erasing depends on
it. Both prefixes are single-sourced and must stay distinct.

Drag-sweeping comes for free on the 2D surfaces: `eraseAt` is already driven through
`sweepPoints`, so once a measurement is findable it is swept exactly like a markup object.

**This is the riskiest change in the set.** `eraseAt` is shared with markup erasing, which is
shipped and works.

### Live 3D

The eraser has only ever been a markup-session tool running on a frozen snapshot. On a model,
measurements live in the live scene, so it becomes a viewport mode:

- arming it disables camera orbit — otherwise the erase drag orbits instead of erasing;
- the cursor becomes `ERASER_CURSOR` from `lib/cursors.ts`;
- pointerdown erases whatever is under the cursor immediately and starts a sweep, so a single
  click erases without requiring a drag;
- pointermove raycasts against **the measurement group only**, so the model itself is never a
  target, and pointerup ends the sweep;
- it reuses `sweepPoints` from `lib/markup/eraseSweep.ts`, so a fast drag does not skip between
  mouse-move samples.

Arming the eraser on a 3D file still must **not** start an annotation session. It does not today
(`eraser` is not in `DRAW_TOOLS`) and that must not change — freezing the viewport would make
the measurements it is meant to erase into pixels.

## Shift snap

A new `lib/measure/snap.ts`:

```ts
/** Shift snaps a measurement segment to 15 degrees. */
export const MEASURE_SNAP_STEP = Math.PI / 12;
export function snapMeasureSegment(x0: number, y0: number, x1: number, y1: number): { x: number; y: number };
```

Deliberately **not** placed beside `constrainSegment` in `lib/markup/draft.ts`, which owns the
45° drawing rule. Two different Shift rules in one module is how they get accidentally unified
later.

It applies to the hover preview as well as the committed point, so the snapped line is visible
before commit rather than jumping on click. It covers linear, angular — each leg snaps about
the vertex, so the angle always lands on a multiple of 15° — and calibrate. The 3D surface
ignores Shift entirely.

Shift is read fresh off each pointer event, matching `updateGeometry`'s existing contract:
pressing or releasing Shift mid-gesture takes effect on the next move, not instantly.

## Testing

`scripts/tests/measureSnap.test.mjs`, `node --test`, relative imports with the explicit `.ts`
extension:

- snaps to the nearest 15° from either direction, including across the ±180° wrap;
- preserves segment length exactly;
- leaves a zero-length segment alone rather than producing NaN;
- a 7° segment snaps to 0°, not to 15° — the snap is absolute, not a quantised delta.

Everything else is browser-verified. There is still no React testing library in this repo and
none is to be added.

## Verification

Beyond the existing checklist:

1. Measure on each surface and confirm the line and value track the cursor from the first click.
2. Set a colour, measure, confirm the dimension draws in it; select it and pick another colour.
3. Select a measurement whose colour **is** the old highlight blue and confirm selected still
   reads as distinct from unselected.
4. Erase a measurement with a drag on a PDF, on an image, and on a live 3D model.
5. Confirm an erase drag on 3D does not orbit the camera.
6. Confirm the eraser still deletes ordinary markup on both 2D surfaces — the regression risk.
7. Hold Shift on a PDF and confirm 15° increments; confirm Shift does nothing on a model.
8. Confirm a line or arrow still snaps to 45°.

## Rollback

All four changes are additive to a feature already in production. Reverting the merge restores
the shipped behaviour with no database involvement — none of this touches storage.
