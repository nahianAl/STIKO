# Cross-Section Tool — Design

**Date:** 2026-08-14
**Status:** Approved (design), pending implementation plan
**Scope:** A cross-section tool for 3D files in the portal viewer — one axis-aligned clipping plane, swept by a slider, with a flip control.

---

## Why

Reviewers judging a design routinely need to see inside it: whether a seat shell has ribs, how thick a wall is, what the join looks like where two parts meet. Today the only way is to orbit until an opening happens to line up, which most models never offer. A section plane answers "what is in there" directly.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Cut shape | **One axis-aligned plane.** Pick X, Y or Z; a slider sweeps it; a button flips which half is kept. |
| 2 | Cut face | **Open, not capped.** The plane hides one half; nothing fills the cut surface. |
| 3 | Persistence | **Session only.** Resets on file switch and reload. No column, no endpoint, no permission, no migration. |
| 4 | Who can use it | **Everyone**, including viewers and commenters — it changes nothing for anyone else. |
| 5 | Default on first enable | Axis **X**, offset at the model's **centre**, not flipped. |
| 6 | Toggling off and on | **Keeps the axis, offset and flip** you had. The defaults apply once per file, not on every enable — re-defaulting would throw away a cut you had just positioned. |

### Why open rather than capped

Capping — filling the cut face so the slice reads as solid — needs stencil-buffer passes and, more importantly, is only defined for closed manifold solids. `lib/threeMaterials.ts` already documents this codebase's actual asset mix as "routinely thin-walled or open — mesh seats, perforated shells, lofted surfaces, unclosed CAD solids". Capping those produces leaks and artefacts rather than a clean slice.

The open cut also costs nothing to make legible here: every material is forced to `THREE.DoubleSide` by `makeDoubleSided`, so a cut reveals the model's interior walls rather than a black void. The feature that fixed hollow models is what makes this one look right.

---

## Architecture

### `lib/crossSection.ts` (new)

Pure. Given an axis, a normalised offset, a flip flag and the model's bounding box, it returns a `THREE.Plane` in the model's own frame. All the arithmetic lives here so it can be tested without a renderer, exactly as `lib/focalLength.ts` is.

The offset is normalised (0–1) rather than in world units: the control's slider then has a fixed, model-independent range, and the module owns the mapping onto the model's actual extent along the chosen axis.

### Clipping is per-material, never global

Setting `gl.clippingPlanes` would clip **everything the renderer draws** — the ground disc, the axis lines, and the navigation cube, which renders through drei's `Hud` on the same renderer. So the Canvas gains `localClippingEnabled: true` and the plane is written onto the model's materials only.

That is a natural extension of `lib/threeMaterials.ts`, which already traverses a loaded root and mutates its materials for `makeDoubleSided`.

### The plane lives in model space and is pushed to world space each frame

three's clipping planes are world-space, but the object can be moved and rotated by the transform gizmo. The plane is therefore built in the model's frame and transformed by the object group's world matrix.

**Per frame, not on prop change.** `TransformControls` mutates the target group directly during a drag rather than going through React props — this is established, and it is what corrupted pin placement in the transform work. A change-driven sync would leave the cut visibly lagging behind the object mid-drag.

### `ModelBounds` gains the bounding box

It currently publishes `center`, `radius` and `height`. A slider driven from the bounding **sphere** would behave badly on anything flat: on a wide, thin tabletop the radius is large but the vertical extent tiny, so most of the slider's travel would sit outside the geometry and do nothing visible.

The box is already computed at `ModelViewerInner.tsx:317` and simply not published. It is also measured in frame S — the model as loaded and centred, **before** the placement transform — which is precisely the frame the plane wants.

---

## Two failure modes this design has to handle

### Cached materials outlive the viewer

`useLoader` caches loader results, so materials are shared and survive the viewer unmounting. A material left with `clippingPlanes` set renders clipped the next time that file is opened — with no control visible to explain why, and no way to clear it short of a reload.

Clearing on unmount and on disable is part of the work, not a tidy-up.

### Comment pins can be dropped on geometry nobody can see

`THREE.Raycaster` ignores clipping planes entirely: the hidden half stays fully raycastable. Without a guard, clicking into an opened cavity places a pin on the invisible near half rather than on the interior surface being aimed at — and the pin then appears to float in space when the section is cleared.

Intersections falling on the clipped side of the active plane must be rejected, so a click lands on the first surface that is actually visible.

---

## UI

A second pill in the bottom-left row, beside the focal-length control. Both are session-only view state available to everyone, which keeps "how I am looking at this" on the left and the permission-gated move/rotate on the right.

`FocalLengthControl` currently owns its own `absolute bottom-3 left-3` positioning, so a sibling pill cannot simply be dropped next to it — the two would stack on top of each other. The corner positioning moves up into one flex row that holds both, and each control becomes a plain in-flow pill. This is a small, contained change to an existing component, and it is the alternative to hand-tuning a second `left-` offset that would silently break the moment either pill changes width.

- **Collapsed:** a single icon button. Clicking it enables sectioning.
- **Active:** a row opens above it — `[X][Y][Z]`, the slider, and a flip button — matching how the focal control's preset list opens upward.
- **Gating:** identical to the focal control — 3D files only, and hidden while an annotation session is active or an attachment is open in the viewport. Resets on file switch.

Defaulting to a centred cut on enable matters: an offset at the model's edge would clip nothing, and the tool would look broken on first use.

### What needs no work

The annotation snapshot is a read of the canvas, so a section appears in it for free. `CleanFrameRenderer` hides objects flagged `excludeFromSnapshot`; clipping is a material property and is unaffected by that pass.

---

## Testing

**Unit** (`node --test`, the repo's runner), against `lib/crossSection.ts`:

- A point on the kept side of the plane has non-negative distance; a point on the hidden side is negative.
- Flipping inverts exactly that, for the same axis and offset.
- The offset extremes behave: one end keeps the whole model, the other keeps none of it.
- Each of X, Y and Z cuts along its own axis and leaves the other two unconstrained.
- A plane built for a model, once transformed by a rotation matrix, still cuts the same part of the model — the property that makes the per-frame world-space sync correct.

**Browser pass:** the clipping itself, that the ground/axes/navigation cube are *not* clipped, that a pin cannot be placed on the hidden half, and that reopening a file after sectioning shows it uncut.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Global clipping silently cuts the scene furniture and the gizmo | Per-material clipping with `localClippingEnabled`; the browser pass checks the furniture explicitly. |
| A cached material stays clipped after unmount | Cleared on unmount and on disable; the browser pass reopens a file to confirm. |
| Pins land on invisible geometry | Intersections on the clipped side are rejected; covered in the browser pass. |
| The cut lags the object during a transform drag | The plane is synced per frame, not on prop change. |
| Slider travel does nothing on flat models | The range comes from the model's AABB along the chosen axis, not its bounding sphere. |
