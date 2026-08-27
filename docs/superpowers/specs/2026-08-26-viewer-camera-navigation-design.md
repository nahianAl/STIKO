# 3D Viewer Camera Navigation — Design

**Date:** 2026-08-26
**Status:** Approved. Implementation plan: `docs/superpowers/plans/2026-08-26-viewer-camera-navigation.md`
**Scope:** Replace the viewer's stock `OrbitControls` with drei's `CameraControls`, anchor the orbit pivot and the dolly step to the surface under the cursor, and remove the hard stop that makes pan and zoom crawl close to large models.

---

## Why

Two reported defects, one root cause.

> "Pan and zoom get really slow when I go close to the 3D models, especially for models that are large."

> "Orbiting a 3D model is very frustrating and unpredictable. I want to orbit the camera around the object as the centre, so that the object always stays within the field of view."

The viewer mounts a bare `<OrbitControls makeDefault />` (`ModelViewerInner.tsx:604`) and sets its `target` to the model's bounding-sphere centre exactly once, at load (`FitCameraToModel`, `ModelViewerInner.tsx:453-484`). Nothing ever revises that pivot.

OrbitControls scales **pan** and **dolly** steps by the camera-to-target distance, but **orbit** is angular and does not scale. That maps precisely onto the two reports: the two distance-scaled operations feel slow, the angular one feels unpredictable. It is a strong confirmation that this is camera arithmetic, not rendering performance — separately confirmed with the user, who reports the camera barely moves rather than the framerate dropping.

### Complaint 1: the pivot collapses

Dolly moves the camera toward the target — the model's abstract centre. To inspect a detail you must therefore travel deep inside the bounding sphere, where the pivot distance is small. Each subsequent scroll then moves 5% of that small distance, and pan moves proportionally less.

This is relative, so it should in principle affect all models equally. It does not, and the reason is absolute distance: on a large model the surfaces you actually want are still hundreds of units away while each gesture now moves a fraction of a unit. The ratio of *distance to the geometry you care about* over *step size* blows up with model size. On a small model the same relative crawl still gets you there.

Nothing arrests the collapse, either. `framingForRadius` sets `minDistance = near * 10`, and with `near = far / 1e5` and `far ≈ 40r`, that is about `0.004 × radius` — effectively zero.

### Complaint 2: the pivot strands

The target is set once at load and thereafter **dragged around by panning**. After a few pans it sits in empty space, and rotating swings the model out of frame. There is no mechanism anywhere that re-derives it.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Control library | **Replace `OrbitControls` with drei `CameraControls`** (camera-controls 2.10.1). |
| 2 | Orbit pivot | **The surface point under the cursor** on left pointer-down; **model centre** when the cursor is over empty background. |
| 3 | Dolly anchor | **`dollyToCursor` alone.** The wheel does **not** re-anchor the pivot — see "Why the wheel must not re-anchor". *(Revised during implementation; the original decision was wrong.)* |
| 4 | Dolly floor | **`infinityDolly`, enabled when zooming in only** — push the pivot forward rather than stopping at `minDistance`, while keeping the existing stop at `maxDistance`. Also cleared on pointer-down and on unmount. |
| 5 | `minDistance` | **`radius * 0.01`**, replacing today's `near * 10`. |
| 6 | Damping | Enabled via `smoothTime` / `draggingSmoothTime`. |
| 7 | Input mapping | **Unchanged** — left rotate, middle dolly, right pan, wheel dolly. |
| 8 | Reset affordance | **Not included.** Explicit non-goal — see below. |

### Why decision 1 is forced, not preferred

OrbitControls calls `object.lookAt(this.target)` on every `update()` (`OrbitControls.js:392`). Its pivot is therefore structurally pinned to the centre of the screen: any attempt to set an off-centre pivot re-aims the camera and jumps the view. **Decision 2 is not expressible in OrbitControls.**

camera-controls provides `setOrbitPoint(x, y, z)`, documented as *"Set orbit point without moving the camera"* — precisely the missing primitive.

The dependency is already present: `camera-controls@2.10.1` ships as a dependency of `@react-three/drei@9.122.0`, and drei's `CameraControls` wrapper handles the required `install()` call with a tree-shaken THREE subset. It will nonetheless be added to `package.json` explicitly rather than relying on a transitive hoist.

### Why decision 8 is a non-goal

A double-click-to-re-frame escape hatch was proposed and **declined by the user** to keep the change small. The existing view cube (`ViewGizmo`) remains the only re-orientation aid. Worth revisiting if cursor-anchored navigation proves easy to get lost in on large models.

---

## Approach

### Zoom that does not stall

Three settings working together:

- **`dollyToCursor`** — the dolly runs along the cursor ray instead of toward the pivot.
- **Letting `dollyToCursor` migrate the target on its own.** Every orbit library sizes the dolly step as a percentage of the pivot distance; before this change that distance meant "how far to the model's abstract centre", and it collapsed. `dollyToCursor` slides the target along the cursor ray as the camera advances, so the distance instead tracks what the user is pointing at. Measured in the browser: the step ratio is a constant **0.598737**, and **identical to six decimal places** on a model 500x smaller. Scale-free by construction rather than by tuning.
- **`infinityDolly`** — when the distance would fall below `minDistance`, hold the distance and push the pivot forward instead. This removes the hard stop: the camera can approach a surface and keep going rather than freezing asymptotically.

#### `infinityDolly` must be directional

Reading the implementation revealed that the flag removes **both** stops, not just the near one. `camera-controls.module.js:2154-2155` computes an `isMax` case alongside `isMin` and pushes the pivot on either:

```js
const isMin = this._lastDollyDirection === DOLLY_DIRECTION.IN  && this._spherical.radius <= this.minDistance;
const isMax = this._lastDollyDirection === DOLLY_DIRECTION.OUT && this.maxDistance <= this._spherical.radius;
if (this.infinityDolly && (isMin || isMax)) { /* push the pivot */ }
```

Left enabled permanently, zooming out would push the pivot away from the model without limit: the model shrinks to nothing and eventually clips through the far plane, which is sized as `maxDistance + 2r`. With no reset control (decision 8) there would be no way back.

The flag is therefore **set per wheel event from the scroll direction** — on when zooming in, off when zooming out. Zoom-out keeps exactly today's hard stop at `maxDistance`, and the far-plane guarantee in `framingForRadius` continues to hold.

The direction test is a named, tested function rather than an inline `deltaY < 0`. camera-controls derives its dolly direction through `delta = deltaY / (deltaYFactor * 10)` with `deltaYFactor` negative, then `_dollyInternal(-delta)`, which scales by `0.95 ** -param` and so, in terms of the `delta` defined above, by `0.95 ** delta` — a sign convention that is invisible in review and infuriating when inverted.

#### Why the wheel must not re-anchor

The original design had the wheel raycast and `setOrbitPoint` on the hit before each dolly, so the step would scale to the real surface rather than to the cursor plane. **Implementation proved that wrong**, and it is the most important finding of this work.

`setOrbitPoint` mutates `_spherical.radius` but never updates camera-controls' private `_lastDistance`, which is written only at `camera-controls.module.js:638` and `:2257` — the very end of `update()`. The next frame's `dollyToCursor` correction computes `dollyControlAmount = _spherical.radius - _lastDistance` (`:2139`) and therefore attributes the entire anchor snap to the dolly, dragging `_targetEnd` — and the camera — toward the cursor plane.

Measured against the installed library, tracking the world point that started under the cursor: it should stay pinned at NDC 0.500, and instead went 0.500 → 0.161 on the first frame and → −0.282 by frame 40. On screen, the thing you point at pops toward screen centre and then slides out the far side — the exact inverse of the feature.

The trigger is not damping, as the method's "SHOULD NOT RUN DURING ANIMATIONS" docblock suggests; it is `dollyToCursor`'s `_changedDolly` deferred-correction state, which persists for the whole scroll.

So the wheel leaves the pivot alone and `dollyToCursor` migrates the target natively, which the browser pass confirmed pins the cursor point exactly. `setOrbitPoint` is kept only for orbit, where no dolly correction is pending.

#### `setOrbitPoint` leaves a focal offset that must be cleared

A second trap in the same method, and one that only shows on the **second** model loaded into a canvas. `setOrbitPoint` keeps the camera still by setting a persistent focal offset (`camera-controls.module.js:1873`) — and `setLookAt`, which `FitCameraToModel` uses to frame each model, does **not** clear it. Only `fitToBox`, `fitToSphere` and `reset` do.

`ViewerContainer` puts no `key` on `<ModelViewer>`, so the Canvas, camera and controls survive a model switch and the stale offset survives with them. Measured: orbit a 5,000-radius model once, then open a 1-radius model, and the camera lands 5,339 units from a model whose far plane is 42.08 — a blank viewport, unrecoverable without a page reload, because the background-drag fallback recomputes the offset to keep the camera exactly where it is.

`FitCameraToModel` therefore zeroes the focal offset before every `setLookAt`.

**Pan requires no custom code.** Truck speed is already proportional to pivot distance, so once the pivot rides the surface under the cursor, pan is correctly scaled as a consequence.

### Orbit around what you point at

On the pointer-down that begins a rotate drag, raycast under the cursor:

- **Hit** → that world point becomes the orbit point.
- **Miss** (empty background) → the model's bounding-sphere centre becomes the orbit point.

`setOrbitPoint` moves the pivot without moving the camera, so there is no jump and no re-aim: the view is untouched and only the centre of rotation changes. Pointing at a detail nails it in place while the camera swings around it; dragging from empty background gives whole-object orbit with the model locked in frame.

Panning can no longer strand the pivot, because it is re-derived at the start of every orbit rather than inherited from wherever pan left it.

### Raycast scoping

There is exactly one raycast, on **orbit**, once per drag at pointer-down. The wheel does not raycast at all — see below — so the per-frame throttle the original design called for was removed along with it.

The raycast is scoped to the model alone, not the scene, for the same reason `SceneInteraction` scopes its own (`ModelViewerInner.tsx:222-225`): the ground disc, contact shadow and axis lines are all `Mesh`-derived and large enough to fill the viewport, so an unscoped raycast would treat empty background as a hit and defeat the fallback in decision 2.

The raycast also skips hits the active cross-section has clipped away, mirroring the guard `SceneInteraction` already applies for comment pins. Without it, orbiting into an opened cavity anchors the pivot on the invisible near shell.

`three-mesh-bvh` is available (a drei dependency) and would accelerate this raycast, but it is **out of scope** — one raycast per drag is cheap, and adopting BVH would also change the existing comment-pin raycast path.

---

## Components

### `lib/viewerNavigation.ts` (new)

Pure decision arithmetic, no THREE scene access, unit-testable under node:

- `pivotForPointer(hit: Vec3 | null, fallback: Vec3): Vec3` — decision 2's hit/miss rule. Orbit, the only caller, passes the model centre as the fallback.
- `clampAnchorDistance(hitDistance, minDistance, maxDistance)` — guards the degenerate case. A grazing hit reported a hair in front of the camera would anchor the pivot almost at the eye, and every subsequent dolly step (a percentage of that distance) would be effectively zero — reintroducing the original defect at a new location. Clamping the anchor distance into the framing limits keeps the step usable no matter what the raycast returns.

- `isZoomingIn(deltaY)` — the scroll-direction test behind directional `infinityDolly`.

Distance limits are **not** duplicated here; they stay in `cameraFraming.ts`, which already owns them. `ViewerNavigation` reads the live values off the controls object, which `FitCameraToModel` has already assigned, so there is a single source of truth and no props to keep in sync.

### `components/viewers/ViewerNavigation.tsx` (new)

Owns the pointer-down and wheel listeners, the throttled raycasts, and the `setOrbitPoint` calls. Kept out of `ModelViewerInner.tsx`, which is already 617 lines.

Mounted inside `<Canvas>`, reading `controls` from `useThree`. Takes `modelRef` and `bounds`. Excludes the view-gizmo rect via `isPointerOverGizmo`, as `SceneInteraction` does — the gizmo is a HUD layer whose R3F `stopPropagation` does not reach native listeners.

### `components/viewers/ModelViewerInner.tsx` (modified)

`<OrbitControls makeDefault />` → `<CameraControls makeDefault ... />` with the settings above; mount `ViewerNavigation`; `FitCameraToModel` switches from mutating `orbit.target` to `controls.setLookAt(...)` plus the new distance limits.

### `lib/cameraFraming.ts` (modified)

`minDistance` stops deriving from `near` and becomes `radius * 0.01`. **`near` and `far` are unchanged** — they size the clipping planes and are unrelated to this defect.

Under `infinityDolly` this constant does double duty: it is both the closest the pivot may sit and the distance held in front of the camera while pushing through geometry. At 1% of the radius that is 50 units on a 5,000-unit building and 0.01 on a 1-unit part — proportionate at both ends.

The existing invariant `near < minDistance` (`cameraFraming.test.mjs:52`) still holds with roughly 24× margin, since `near ≈ 4.2e-4 × radius`.

---

## Integration points

| Consumer | Interaction | Status |
|----------|-------------|--------|
| `ViewGizmo` (drei `GizmoHelper`) | Reads default controls to tween the camera | **Supported**, with a caveat. `GizmoHelper.js:20` branches on `getTarget`, the CameraControls path. But its per-frame `setPosition` is `setLookAt` underneath, so a stale focal offset from a previous orbit displaces the snap — measured at ~one model diameter on a radius-100 model. The cube must clear the offset when it tweens. |
| `TransformGizmo` | Sets `defaultControls.enabled` during a drag | **Supported.** camera-controls exposes `.enabled`. |
| `CleanFrameRenderer` (snapshots) | Renders scene + camera directly | Unaffected. |
| `SceneInteraction` (comment pins) | Own raycast on `pointerdown` | Unaffected; new listener is additive and does not consume the event. |

A pre-existing drei quirk is worth recording but **not fixing here**: `GizmoHelper.tweenCamera` computes its radius against a module-level `target` fixed at the origin rather than the resolved `focusPoint`. Because `<Center>` places the model at the origin, `bounds.center` is approximately the origin and the error is benign.

---

## Testing

**Node tests** in `scripts/tests/viewerNavigation.test.mjs`, following the existing `cameraFraming.test.mjs` pattern, covering `pivotForPointer` (hit, and miss falling back to the centre), `clampAnchorDistance` (below-floor, above-ceiling, in-range, and degenerate) and `isZoomingIn` (both directions). `cameraFraming.test.mjs` gains a case asserting `minDistance` stays proportionate across the 1-to-10,000 radius range the viewer must support, and its existing `near < minDistance` assertion is re-run against the new value.

**Browser verification** is required — the camera behaviour itself cannot be asserted in node. Per the project's local-verification notes, against both a large model and a small one:

1. Zoom in close on a large model; confirm scroll and pan keep a usable step size all the way in, and that approaching a surface does not stall.
2. Confirm zoom feels equivalent on a small model.
3. Scroll out continuously; confirm the camera still stops at the framing limit rather than pushing the model past the far plane — the directional `infinityDolly` check.
4. Orbit with the cursor on a detail; confirm the detail stays put.
5. Orbit with the cursor over empty background; confirm the whole model stays in frame.
6. Pan away, then orbit; confirm the pivot re-derives rather than swinging around empty space.
7. **Open a large model, orbit once, then open a small one.** The small model must be framed normally. This is the focal-offset regression above, and no other check catches it — it needs two models in one canvas.
8. Click each view-cube face after orbiting off-centre; confirm the camera re-centres on the model rather than keeping the previous anchor's offset.
9. Confirm the transform gizmo, comment pins, cross-section and snapshot capture still work.

---

## Rollback

The change is confined to two new source files, two modified ones, `package.json` and the tests — no schema, no migration, no API surface. `camera-controls` is a type-only import, so removing it from `package.json` has no runtime consequence. Production is the only environment, so rollback is a revert of the whole branch (several commits, not one) — no migration ordering or data concerns.
