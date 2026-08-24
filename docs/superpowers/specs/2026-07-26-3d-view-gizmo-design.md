# 3D View Gizmo — Design

**Date:** 2026-07-26
**Status:** Approved (design), pending implementation plan
**Scope:** A CAD-style view-orientation gizmo (navigation cube + axis triad) pinned to the bottom-right of the portal's 3D viewport. Composed from `@react-three/drei` primitives already installed, themed to the "1C Soft" stiko tokens, and integrated so it neither leaks into annotation snapshots nor steals comment-pin clicks.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Gizmo form | **Cube + axis triad.** Labelled cube with clickable faces/edges/corners, plus X/Y/Z axis lines, matching the reference screenshot. |
| 2 | Interaction | Clicking a cube face/edge/corner **tweens the camera** to that view (drei's built-in eased tween). The triad is **display-only**. |
| 3 | Appears in annotation snapshots | **No.** Markup images contain only the model, consistent with the toolbar and pins not being baked in. |
| 4 | Styling | **Match the stiko palette** — white faces, `#1C2030` ink labels, `#5B60FF` indigo hover, `#E4E5EC` stroke. Axes stay conventional X-red / Y-green / Z-blue, which is semantic rather than brand. |
| 5 | Position | Bottom-right of the 3D viewport. |
| 6 | Out of scope | The curved rotation arrows and the small cube dropdown visible in the reference screenshot. Separable follow-ups. |

---

## Approach

Compose drei's `GizmoHelper` + `GizmoViewcube` + `GizmoViewport` inside the **existing** `<Canvas>`, rather than overlaying a second canvas or writing a gizmo from scratch.

Facts that make this viable, all verified against the installed sources:

- `@react-three/drei@9.122.0` ships all three components (`node_modules/@react-three/drei/core/Gizmo*`).
- `GizmoHelper` requires the default controls to be registered; `ModelViewerInner.tsx` already renders `<OrbitControls makeDefault />`.
- Both `GizmoViewcube` and `GizmoViewport` draw their labels into a `CanvasTexture` with a plain 2D `context.font`. **No troika, no font file, no network fetch** — safe offline and under CSP.
- `GizmoHelper` accepts `alignment="bottom-right"` and a `margin`, so placement needs no manual math.

Rejected alternatives:

- **Second `<Canvas>` overlay.** Structurally immune to both integration seams below, but needs a camera bridge to mirror orientation and drive the main camera, consumes a second WebGL context, and requires hand-written click-to-snap. More code to avoid problems the chosen approach solves directly.
- **Fully custom gizmo.** Total visual control including the arrows, at the cost of reimplementing hit-testing and camera tweening. Not justified by the requested scope.

---

## Components

### `components/viewers/ViewGizmo.tsx` (new)

The single home for everything gizmo-related: composition, palette, and layout geometry. Keeping the layout constants here — rather than scattered across the viewer — is what lets the click guard stay correct as the gizmo's size or margin changes.

Exports:

- `ViewGizmo` — the composed gizmo. `GizmoViewcube` at drei's native 60-unit size with `faces` relabelled and the stiko palette applied; `GizmoViewport` scaled and positioned at the cube's front-lower-left corner, passed `disabled` so it is display-only. The triad's exact scale and offset are tuned visually against the reference screenshot rather than prescribed here.
- `GIZMO_MARGIN_PX`, `GIZMO_HALF_EXTENT_PX`, `isPointerOverGizmo(x, y, canvasWidth, canvasHeight)` live in `lib/gizmoLayout.ts`, not here. `ViewGizmo.tsx` imports React and drei, which Node's test runner cannot load, so the pure layout math moves to a dependency-free module and `ViewGizmo` imports the margin constant from it. All four arguments are **CSS pixels, not drawing-buffer pixels**, with the origin at the canvas's top-left: `canvas.width` is scaled by device pixel ratio, whereas drei's HUD camera is pixel-matched to React Three Fiber's `state.size`, which is the CSS size. Callers pass `getBoundingClientRect()` values, which is what `handlePointerDown` already computes.

Font: drei's `font` prop is a CSS font shorthand fed to `context.font`. Manrope is loaded through `next/font/google`, which generates a hashed family name, so `"Manrope"` will not resolve inside a canvas context. Use an explicit stack (`600 20px Inter, system-ui, -apple-system, sans-serif`) and accept the system fallback — the labels are short, uppercase, and small.

### `components/viewers/ModelViewerInner.tsx` (modified)

1. Render `<ViewGizmo />` inside the `<Canvas>`.
2. Add a `<CleanFrameRenderer>` child that exposes the capture handle (below).
3. Guard the comment-pin handler in `SceneInteraction` with `isPointerOverGizmo`.

### `components/viewers/ModelViewer.tsx`, `ViewerContainer.tsx`, `app/portal/[id]/page.tsx` (modified)

Thread the imperative handle from the page down to `ModelViewerInner`, mirroring how `pdfViewerRef` is already plumbed through `ViewerContainer`.

---

## Integration seam 1 — keeping the gizmo out of snapshots

`GizmoHelper` renders through drei's `Hud`, whose `RenderHud` `useFrame` draws the model scene and then the gizmo scene **into the same framebuffer**:

```js
gl.autoClear = true;  gl.render(defaultScene, defaultCamera);
gl.autoClear = false; gl.clearDepth(); gl.render(scene, camera);
```

So `canvas.toDataURL()` in `captureViewerSnapshot` would capture the gizmo along with the model.

**Unmounting the gizmo when annotation starts does not work.** `startAnnotationSession()` calls `setAnnotating(true)` and then captures synchronously in the same tick — before React commits and before WebGL draws another frame. Any state-driven hide would need a deferred capture and at least one animation frame of coordination, which is both fragile and a change to the session lifecycle.

**Chosen mechanism — imperative clean re-render.** `ModelViewerInner` exposes:

```ts
export interface ModelViewerHandle {
  renderCleanFrame: () => void;   // re-renders the model scene only, no HUD
}
```

Implemented by a component inside the `<Canvas>` that reads `gl`, `scene` and `camera` from `useThree()` and calls `gl.render(scene, camera)`. `captureViewerSnapshot` calls it immediately before reading pixels; the next animation frame restores the gizmo naturally.

Why the camera reference is correct: `GizmoHelper`'s `OrthographicCamera` sets `makeDefault` inside the `Hud`'s `createPortal` child store, so it never becomes the root store's camera. A component in the main tree reads the main perspective camera.

This stays fully synchronous, requires no change to the annotation session flow, and generalises to any future in-canvas overlay.

Non-3D files are unaffected: the handle is null for the image, video and PDF viewers, and `captureViewerSnapshot` falls through to its existing branches untouched.

---

## Integration seam 2 — gizmo clicks must not place comment pins

`SceneInteraction` places pins from a **native** `pointerdown` listener on `gl.domElement`:

```ts
canvas.addEventListener('pointerdown', handlePointerDown);
```

drei's cube calls `e.stopPropagation()` on React Three Fiber's *synthetic* event, which does not stop a native DOM listener. With the comment tool armed, clicking the cube would snap the view **and** drop a pin on whatever geometry sits behind the gizmo.

**Fix.** `handlePointerDown` returns early when the pointer is inside the gizmo's screen rect, via `isPointerOverGizmo`. The rect is stable arithmetic, not a guess: drei's `OrthographicCamera` defaults to a pixel-matched frustum (1 unit = 1 px), and `GizmoHelper` positions the group at `size.width / 2 - marginX`, `-size.height / 2 + marginY`. The cube's 60-unit box is therefore a 60px box, and the constants in `lib/gizmoLayout.ts` describe the combined cube-plus-triad radius.

---

## Testing

**Unit (node script, matching the repo's existing no-framework convention).** `isPointerOverGizmo` is pure and gets direct coverage: a point inside the gizmo, points in each of the other three corners, points just inside and just outside each boundary edge, and behaviour across two different canvas sizes.

**Visual.** A temporary dev-only route renders the model viewer against a locally generated sample model; screenshot it through Chrome DevTools to confirm bottom-right placement, theming, label legibility, and that the triad reads correctly while orbiting. The route is deleted before committing.

*Known risk:* `middleware.ts` may redirect unauthenticated requests, in which case the harness route needs a matcher exemption. Confirm rather than assume; if the harness proves impractical, fall back to verifying placement arithmetic through the unit test and reviewing the gizmo in the running app.

**Regression.** After wiring the capture handle, confirm an annotation snapshot of a 3D file contains the model and no gizmo, and that image, video and PDF captures are byte-path unchanged.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| `GizmoHelper` takes over the render loop (`renderPriority=1`), disabling R3F's automatic render | Existing setup has no custom render loop and already runs `frameloop="always"`; `SceneInteraction`'s `useFrame` is priority 0 and keeps running. No behavioural change expected — verify pin projection still tracks during orbit. |
| Cube and triad overlap creates ambiguous hit targets | Triad is `disabled`, so only the cube is interactive. |
| Gizmo obscures model geometry in the corner | It sits in the bottom-right margin, the same region already used by viewer chrome; the cube is small (60px) and the faces are opaque by design. |
| Layout constants drift from drei's internals on upgrade | Constants and the predicate live together in `lib/gizmoLayout.ts`; the unit test pins the expected rect. |
