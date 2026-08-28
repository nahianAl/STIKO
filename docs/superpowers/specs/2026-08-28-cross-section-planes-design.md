# Cross-section: visible, movable clip planes

Date: 2026-08-28
Supersedes the interaction model in `2026-08-14-cross-section-tool-design.md`.

## Why

The cross-section tool cuts with one axis-aligned plane positioned by a slider. You cannot
see the plane, cannot tilt it, and cannot have more than one. Reviewing a design means
asking for a cut through a particular feature at a particular angle, which the slider
cannot express.

This replaces the slider with up to three planes that exist in the scene as objects you
grab and move.

## Behaviour

### The master toggle

The cross-section button is unchanged in position and meaning: on means the tool is open,
off means the model is whole. Turning it off discards every plane, every cut and any
selection, and re-enables Move and Rotate on the object. There is no other way to return
the model to its uncut shape.

### The Planes panel

While the tool is on, a panel sits inline in the bottom-right row, immediately left of the
cross-section button and at the same height as it: the word `Planes`, then three buttons
`1 2 3`. The panel replaces the old popover — the axis picker, the offset slider and the
flip button that used to float above the row are all gone.

Each numbered button toggles the **visibility** of its plane. The first time a button is
switched on, that plane starts cutting. It keeps cutting for as long as the tool is open,
whether or not it is visible. Switching a button off therefore hides the plane and its
gizmo so the cut can be seen unobstructed; it does not restore the geometry.

That produces a state — cut, but with an unlit button — which needs to be legible. An
unlit button whose plane is still cutting carries a small filled dot. Lit means visible
and cutting; dotted means cutting but hidden; plain means neither.

Planes 1, 2 and 3 are three fixed slots. There is no fourth. Their starting orientations
are perpendicular to X, Y and Z respectively, centred on the model — a starting pose only,
with no lasting axis identity, since a rotated plane is not axis-aligned in any case.

### Selection, move and rotate

While the cross-section tool is on, Move and Rotate act on planes and never on the object.
The object's saved placement is editable only with the tool off. With the tool on and
nothing selected, both buttons are disabled and say so on hover.

Clicking a plane in the scene selects it and arms Move on it. With a plane selected,
clicking Rotate switches to the rotate gizmo on that same plane. Clicking a different
plane moves the selection. Clicking the model or empty space deselects and dismisses the
gizmo. Hiding a selected plane deselects it.

A flip button appears in the Planes panel only while a plane is selected, and reverses
which half of the model that plane keeps. Without it the only way to change sides is a
180-degree gizmo rotation, which is unreasonably fiddly.

### Frame

Planes are children of the model's transform group. A model with a saved placement carries
its cuts with it, which is the property the current single-plane tool already has and must
not lose.

### Persistence

None. Like the focal length, a cut is a way of looking at the model rather than a property
of the design. All plane state is session-only and resets when the selected file changes,
matching the current `setCrossSection(null)` reset.

## Architecture

### Where a plane's pose lives

The scene graph owns it. React state holds only the flags:

```ts
type PlaneId = 1 | 2 | 3;

interface PlaneSlot {
  /** The 1/2/3 button: whether the plane and its gizmo are drawn. */
  visible: boolean;
  /** True from the first time this slot is switched on. Only the master toggle clears it. */
  cutting: boolean;
  /** Which half survives. */
  flipped: boolean;
}
```

plus `sectionActive: boolean` and `selectedPlane: PlaneId | null`.

Position and rotation live only on each plane's `Object3D`. Nothing reads them out into
React, and nothing writes them back in.

The alternative — holding poses in React state and committing on drag release, the way the
object transform works — was rejected. `TransformControls` mutates its target directly
while dragging and R3F's prop diffing compares against the previous prop rather than the
object's real state, which is why `ModelViewerInner` already carries a hand-written
re-apply effect for the object transform. Three planes would mean three of those. Since
the poses are never persisted and never displayed, React does not need the numbers at all,
and the frame loop that builds the clipping planes already reads world matrices.

The cost is that a plane's pose cannot be persisted or shown numerically later without
adding that synchronisation back. Accepted: the feature is explicitly session-only.

### New files

`components/viewers/section/` — extracted from `ModelViewerInner.tsx`, which is 719 lines
before any of this lands.

- **`SectionPlaneWidget.tsx`** — one plane. A translucent quad about 2.2x the model radius
  so it always spans the model, with hover and selected states and a click handler that
  selects. Sets `userData.excludeFromSnapshot`, matching `TransformGizmo`, so plane
  widgets never appear in an annotation snapshot.

- **`ApplyCrossSection.tsx`** — replaces the single-plane component of the same name. Holds
  an array of up to three `THREE.Plane` instances and rewrites them in place each frame
  from the widgets' world matrices, flipping the normal per `flipped`. Mutating per frame
  rather than reacting to prop changes is required for the same reason as today: a gizmo
  drag does not go through React.

  The array is rebuilt only when the set of cutting planes changes, never per frame.
  Changing the *number* of clipping planes on a material recompiles its shader; changing a
  plane's values does not. The count genuinely varies here, unlike today, so this is a real
  rebuild on a real event rather than the invariant `setClippingPlanes` documents.

  The existing unmount cleanup is preserved verbatim in intent: STL and PLY render with
  module-level singleton materials shared by every STL/PLY opened in the session, so a
  missed cleanup clips unrelated models later with no control on screen to explain it.

- **`SectionCaps.tsx`** — stencil capping, described below, behind a single flag.

### Changed files

- **`lib/crossSection.ts`** — `CrossSection` and `planeForSection` are replaced by
  `PlaneId`, `PlaneSlot`, `SECTION_PLANE_IDS`, `MAX_SECTION_PLANES = 3`, `emptySlots()`, a
  `defaultPoseFor(id, box)` returning the starting position and rotation for a slot,
  `writePlaneFromMatrix(target, matrix, flipped)` rewriting a `THREE.Plane` in place from a
  widget's world matrix, and `isClipped(planes, point)` for the raycast guards. `ModelBox`
  stays.

- **`ModelViewerInner.tsx`** — `clipPlaneRef: MutableRefObject<THREE.Plane | null>` becomes
  `clipPlanesRef: MutableRefObject<THREE.Plane[]>`. Mounts the widgets and the caps.
  Retargets `TransformGizmo` at the selected plane instead of the transform group while the
  tool is on.

- **`ViewerNavigation.tsx`** and the `SceneInteraction` raycast guard — both reject a hit
  when *any* clipping plane puts it behind, instead of consulting one plane. Both guards
  exist because three's raycaster ignores clipping entirely, so the hidden half stays
  hittable; that reason is unchanged and the guards must additionally ignore the plane
  widgets themselves, which are hittable geometry sitting in the middle of the model.

- **`TransformGizmo.tsx`** — takes an arbitrary `Object3D` target and an optional commit.
  With a plane target there is no commit, since nothing is persisted. The existing unmount
  work stays: re-enabling orbit controls (drei never fires a final `dragging-changed:
  false`) and disposing the instance (R3F never auto-disposes a `<primitive>`).

- **`TransformTools.tsx`** — gains a disabled state with an explanatory title.

- **`CrossSectionControl.tsx`** — loses the popover; becomes the master chip alone. A new
  sibling `PlanesPanel.tsx` renders the inline `Planes 1 2 3` chip plus the conditional
  flip button, styled to match the row.

- **`app/portal/[id]/page.tsx`** and **`ViewerContainer.tsx`** — state and prop plumbing.
  Fewer props than today, since poses do not cross the canvas boundary.

## Capping

Where a plane cuts, the model reads hollow. Caps fill the cut with a solid face so it
reads as a real section, using the standard three.js stencil technique: for each plane,
render back and front faces of the model into the stencil buffer, then draw a plane-sized
quad clipped by the *other* planes, then clear the stencil.

**Known limitation.** The technique is correct only on closed manifold geometry. This
viewer renders everything `DoubleSide` on purpose because, as `lib/threeMaterials.ts`
records, uploaded models are "routinely thin-walled or open — mesh seats, perforated
shells, lofted surfaces, unclosed CAD solids". Those are precisely the shapes that cap
wrong, producing stray filled regions or flicker rather than a clean face. Capping will
look right on solid CAD parts, STEP especially, and unreliable on open shells.

**Cost.** Two extra stencil draw calls per mesh per plane: three planes over N meshes is
6N additional calls. GLB import already merges draw calls, which keeps N low for the
common case.

Both are accepted, and the mitigation is isolation: all of it lives in `SectionCaps.tsx`
behind one flag, so it can be switched off in a single line if it misbehaves on real
models without touching the clipping path.

The stencil groups are built from the model's geometry and must be rebuilt when the model
changes. `SectionCaps` is keyed off the url, like `ApplyCrossSection` — and with a distinct
key prefix, since `MeasureModel` is a sibling keyed off the same url and a bare `key={url}`
previously collided.

## Testing

Unit, under node, no THREE in the test path where avoidable:

- `defaultPoseFor` returns three distinct poses, each centred on the box.
- `planeFromMatrix` produces the expected normal and constant for an identity matrix, for a
  translated matrix, for a rotated matrix, and with `flipped` both ways.
- Slot reducer: first toggle-on sets `cutting`; toggle-off leaves `cutting`; master-off
  clears every slot; hiding the selected slot clears the selection.

Manual, in the browser, since none of the rendering is unit-testable:

- All three planes on, moved and rotated, cutting simultaneously.
- Hide a cutting plane; the cut stays and the button shows the dot.
- Master toggle off; the model is whole and no plane remains.
- Select a plane, Move it, switch to Rotate, confirm the gizmo stays on that plane.
- Drop a comment pin near a cut; it must not land on the hidden half.
- Orbit into a cut cavity; the pivot must not anchor on hidden geometry.
- Take an annotation snapshot with planes visible; no plane or gizmo appears in it.
- Switch to another file and back; nothing carries over.
- STL and PLY specifically: open one, section it, switch to another STL, confirm the second
  is not clipped.

## Out of scope

Persisting plane poses. More than three planes. Numeric pose entry. Capping colour or
material controls. Any change to the object transform's own behaviour with the tool off.
