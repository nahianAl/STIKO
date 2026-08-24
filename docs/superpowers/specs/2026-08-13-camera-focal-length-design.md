# Camera Focal Length Control — Design

**Date:** 2026-08-13
**Status:** Approved (design), pending implementation plan
**Scope:** A drop-up control at the bottom-left of the 3D viewport — eye icon, editable value, up arrow — that sets the camera's focal length in millimetres, either by typing or by choosing a photographic preset.

---

## Why

The viewer opens on a fixed 50° field of view, roughly a 26mm lens. That is wide, and wide lenses exaggerate near-far difference: a chair's front legs look much larger than its back ones, and a long object appears to taper. Reviewers judging proportion are judging the lens as much as the design. Letting them pick a longer lens removes that distortion; letting them pick a wider one is useful for a large object in a tight space.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | On change | **The camera stays put; the view zooms.** Like changing the lens on a tripod. No dolly-zoom. |
| 2 | Persistence | **Session only.** Not saved — a lens is how you are looking at something, not a property of the design. Resets on file switch and reload. |
| 3 | Presets | **15 / 24 / 35 / 50 / 85 / 135mm**, with any value typeable in between. |
| 4 | Default | **35mm.** |
| 5 | Range | Typed values clamped to **8–300mm**. |
| 6 | Scope | 3D files only. |

Decision 2 is what keeps this small: no column, no endpoint, no permission, no migration. It is deliberately unlike the object transform, which everyone reviewing must see.

---

## Focal length is the source of truth

three's `PerspectiveCamera.setFocalLength(mm)` derives the field of view from the focal length, a fixed film *width* (`filmGauge = 35`) and the current aspect ratio — which means the same lens gives a different fov on a differently-shaped viewport. That is photographically correct for an actual film camera, but it is wrong for this control: it would mean collapsing a side panel *zooms the model*, because the aspect ratio changing narrows the vertical fov. Nobody wants a panel toggle to zoom the model.

Instead, this module fixes the 35mm-format frame *height* at 24mm and derives fov from the focal length alone:

```
fov = 2 · atan( 24 / (2 · focalLength) )
```

Two consequences:

- **The lens has one fixed angle of view, whatever shape the viewport is.** Resizing — including collapsing or restoring a side panel — reveals or hides scene rather than zooming, exactly as it behaved before this control existed. The number on the control always describes what is on screen, in every viewport shape, not just the one it happened to be set in.
- **fov is derived, never stored.** Nothing should set `camera.fov` directly once this ships.

### The default does not change how big anything looks

`framingForRadius(radius, fov, aspect)` computes the camera's distance *from* the fov, so a longer lens produces a proportionally larger fit distance and the object still fills the frame identically. Moving the default from today's 50° to 35mm therefore changes the perspective and the camera's distance, **not** the apparent size of the model on load.

This only holds if the focal length is applied **before** the camera fit runs. `FitCameraToModel` reads `cam.fov` at effect time, so `ApplyFocalLength` must be rendered earlier in the tree — React fires sibling effects in mount order. Getting this backwards would frame every model with the wrong lens on first paint, in a way that looks like a framing bug rather than an ordering one.

---

## Components

### `components/viewers/FocalLengthControl.tsx` (new)

The pill, as DOM rather than 3D: `[ 👁 | 35mm | ▲ ]`, absolutely positioned at the bottom-left of the viewer area.

- **Typing:** clicking the value turns it into a text input. Enter commits, Escape reverts, blur commits. Non-numeric input reverts to the current value rather than doing something surprising.
- **The menu:** the arrow opens the preset list *upward*, so it never runs off the bottom of the viewport. Clicking outside or pressing Escape closes it. Choosing a preset commits immediately.
- **Clamping:** committed values are clamped to 8–300mm. Below 8 the distortion is fisheye; above 300 the projection is nearly orthographic and orbiting feels broken.
- Being DOM chrome outside the `<canvas>`, it is automatically absent from annotation snapshots — no exclusion machinery needed, unlike the transform handles.
- **Hidden while an annotation session is active.** During markup the live viewer is replaced by a frozen snapshot, so the control would sit on top of the drawing surface and change a camera nobody is looking at. It renders only when the viewer itself is showing.
- It is one of several absolutely-positioned overlays in the viewer area (the markup overlay, the annotation canvas, the attachment lightbox). It sits above the live viewer and below the lightbox, which is what the hidden-while-annotating rule already implies — no new stacking layer is introduced.

### `ApplyFocalLength` (inside the Canvas, in `ModelViewerInner`)

Calls `setFocalLength` and `updateProjectionMatrix` whenever the focal length **or the viewport size** changes. Rendered before `FitCameraToModel` for the ordering reason above.

### State

Lives in `app/portal/[id]/page.tsx` alongside `transformMode`, resets in the existing effect keyed on the selected file, and threads down through `ViewerContainer` → `ModelViewer` → `ModelViewerInner` as a single `focalLength` prop. The control itself is rendered by the page in the viewer area, not by the viewer, so it sits in normal DOM stacking alongside the other overlays.

---

## Deliberately not doing

**No re-fit on change.** Decision 1 means changing the lens zooms the view. The OrbitControls dolly limits computed at load stay as they are — they are a 10× band around the initial fit distance and remain usable at any lens. Stated here because it is exactly the kind of thing a later change could "fix" into a dolly-zoom by accident, silently reversing an explicit decision.

---

## Testing

**Unit** (`node --test`, the repo's runner). The conversion is pure and gets its own module so it can be tested without a camera:

- A known value pinned against three's own formula, so a change to the frame-height assumption fails loudly. three is still the independent oracle: setting `filmGauge = 24` and any aspect ≤ 1 makes three's own `getFilmHeight() = filmGauge / max(aspect, 1)` equal 24, exactly our fixed frame, so its `setFocalLength` result must agree with ours at every preset.
- The fov is provably independent of viewport shape: `fovForFocalLength` takes no aspect parameter, so this holds by construction rather than by re-testing every shape.
- The relationship is monotonic — a longer lens is always a narrower fov.
- Clamping: values below 8 and above 300 come back at the bounds; `NaN`, `Infinity`, empty string and non-numeric text all return the previous value rather than a bad number.

There is no round-trip test. The earlier design had one (`fovForFocalLength` composed with an inverse `focalLengthForFov`), but a round-trip only proves the two functions are mutual inverses of *each other* — a wrong frame height would round-trip perfectly, so it can't catch the thing it looks like it catches. `focalLengthForFov` had no production caller and was deleted along with it; the three.js cross-check above is what actually pins the arithmetic.

**Visual pass** via the dev harness: the pill sits bottom-left and opens upward; typing a value changes the perspective without moving the camera; the presets work; resizing the viewport — including collapsing a side panel — leaves the displayed number and the apparent size of the model unchanged; and the initial framing at the 35mm default matches today's apparent size.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Resizing the viewport zooms the model | Fixed by construction: fov is derived from the focal length alone (a fixed 24mm frame height), never from the viewport aspect, so `ApplyFocalLength` has nothing to re-run on resize. A unit test asserts `fovForFocalLength` takes exactly one argument, guarding against an aspect parameter creeping back in. |
| Ordering against the camera fit | `FitCameraToModel` reads `cam.fov` at effect time and is gated on `bounds`, which starts `null` and is reset on every url change — so it can never mount in the same commit as `ApplyFocalLength`, guaranteeing the fov is set first regardless of JSX sibling order. |
| A typed value breaks the projection | Clamped and validated; invalid input reverts rather than propagating. |
| Extreme lenses make orbiting feel wrong | Bounded to 8–300mm, which keeps the projection sane at both ends. |
