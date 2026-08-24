# 3D Viewer Scene: Ground Plane & Axis Lines — Design

**Date:** 2026-08-13
**Status:** Approved (design), pending implementation plan
**Scope:** Replace the portal 3D viewer's fixed-size grid with a flat, slightly darker ground plane that fades at its edges, a soft contact shadow, and three muted brand-tinted axis lines. Everything sizes itself from the loaded model's bounding sphere, so the scene reads correctly from a 1-unit trinket to a 10,000-unit building.

---

## Why

Two problems, one cause.

The grid is hardcoded to 10 units with `fadeDistance={10}` (`ModelViewerInner.tsx`). On an 800-unit model it is already invisible; on a 5,000-unit one it is a speck. Once a model is any real size, the viewport has **no spatial reference at all** — you cannot tell where the object sits, which way is up, or how far the camera has orbited.

This is the same class of defect as the camera bug fixed in `0b831d6`: scene furniture authored for one scale, in a viewer whose models span four orders of magnitude. The fix is the same shape — derive everything from the model's bounding sphere.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Grid | **Removed entirely.** No cells, no sections. |
| 2 | Ground | Flat plane, slightly darker than the `#f0f0f0` background, **fading to nothing at its edges** — no visible boundary. |
| 3 | Model placement | **Rests on the ground.** `<Center top>` puts the model's base at y=0 instead of its centre. |
| 4 | Contact shadow | **Yes**, soft, where the object meets the ground. |
| 5 | Axis colours | **Muted, brand-tinted RGB** — X `#B5636B`, Y `#6E9178`, Z `#6B74A8`. |
| 6 | Y axis | Included, but only as tall as the model — not the full length of the ground axes. |
| 7 | Scaling | Every dimension derives from the model's bounding sphere radius. |

Decision 3 is what makes decision 2 viable. `<Center>` currently aligns the model's *centre* to y=0 (`Center.js:35` — `vAlign` is 0 unless `top`/`bottom` is passed), so half the geometry sits below the origin. A solid ground plane at y=0 would visibly bisect every model.

---

## Approach

Compose drei primitives, all sized from the bounding sphere. No new dependencies, no custom shaders.

- **Shadow:** drei `ContactShadows`.
- **Ground:** a circle mesh whose material uses a radial-gradient `CanvasTexture` as its alpha, giving the edge fade. Same canvas-texture technique drei already uses for the gizmo's face labels — works offline and under CSP, no asset to ship.
- **Axes:** drei `Line`, which wraps `Line2`/`LineMaterial` from three-stdlib and therefore supports a real **screen-space** `lineWidth`. A plain `THREE.Line` is locked to 1px on most platforms, and a world-space tube would be invisible on a 5,000-unit model.

Rejected:

- **`AccumulativeShadows`** — better-looking soft shadows, but needs a light rig and accumulates over many frames. Overkill for a review viewer where the object never moves.
- **A custom shader for the ground fade** — full control of the falloff curve, at the cost of the codebase's first custom shader. A canvas radial gradient is sufficient.
- **Keeping `Grid` with cells disabled** as a cheap fading plane — contradicts decision 1 and fights the component's purpose.

---

## Architecture

### One measurement, four consumers

`FitCameraToModel` (added in `0b831d6`) already computes the model's bounding sphere. The ground, axes, and shadow need exactly the same number. Rather than measuring four times, the measurement is hoisted.

A `MeasureModel` component publishes the bounds once per loaded model:

```ts
export interface ModelBounds {
  center: THREE.Vector3;  // world-space centre of the model
  radius: number;         // bounding-sphere radius
  height: number;         // bounding-box Y extent, for the Y axis and shadow depth
}
```

`ModelViewerInner` holds it in state; `FitCameraToModel`, `SceneGround`, and `SceneAxes` all read it. This keeps the invariant that the camera fix established — *everything derives from the bounding sphere* — true by construction rather than by four independent copies that can drift.

Consumers render nothing until bounds exist, so there is no frame where the ground is sized for the wrong model.

### Files

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/sceneScale.ts` | Create | Pure scale derivation: ground radius, axis length, stacking offsets, shadow extents — all as multiples of the model radius. Dependency-free so Node can test it. |
| `scripts/tests/sceneScale.test.mjs` | Create | Unit tests for the above. |
| `components/viewers/SceneGround.tsx` | Create | Fading ground plane + `ContactShadows`. Owns the gradient texture and the ground colour. |
| `components/viewers/SceneAxes.tsx` | Create | The three axis lines and their colours. |
| `components/viewers/ModelViewerInner.tsx` | Modify | Drop `Grid`; add `<Center top>`, `MeasureModel`, `SceneGround`, `SceneAxes`; `FitCameraToModel` consumes bounds instead of measuring. |

---

## Scale derivation

All in `lib/sceneScale.ts`, all proportional to the bounding radius `r`. Starting constants below; the visual pass may adjust the multipliers, not the proportionality.

- **Ground radius** — `4r`. Wide enough that the fade completes well outside the framed view rather than ending abruptly at the viewport edge.
- **Ground axis half-length** — `2r`. The X and Z lines are drawn **through** the origin, spanning `-2r` to `+2r`, so they read as extending past the object on both sides without reaching the ground's transparent rim.
- **Y axis length** — the model's bounding-box height, drawn from the origin **upward only** (`0` to `height`). It marks how tall the object is rather than continuing below the ground.
- **Surface offset** — `5e-3 · r`, used to stack coplanar surfaces. (Raised from `1e-3` during
  the visual pass: the camera's far/near ratio of 1e5 puts depth precision near 15 world units
  on a radius-8660 model, and the smaller factor left the axis lines visibly dashed.) **Proportional, not fixed**: a constant offset disappears into z-fighting on a 5,000-unit model and becomes a visible floating gap on a 1-unit one.
- **Shadow extent** — `2.5r`, a little wider than the model's footprint. Shadow `far` derives from the model height so the depth pass covers the object without wasting precision.

**Placement.** `<Center top>` guarantees the model is centred on the world origin in X and Z with its base at y=0, so the ground and both ground axes sit at the world origin — they do not need re-centring on `bounds.center`. Note that `bounds.center.y` is therefore `height / 2`, not 0; consumers must not shift by it a second time.

### Stacking order at the ground

Three coplanar-ish surfaces sit at the origin plane. Bottom to top:

1. Ground plane — two surface offsets BELOW the model's base
2. Contact shadow — one surface offset below the base
3. Axis lines — one surface offset ABOVE the base

The whole stack sits below y=0 rather than above it, which the visual pass established is
load-bearing: drei's `ContactShadows` aims an orthographic camera straight UP from its own
position, so it only captures geometry above itself. With the shadow at or above the model's
base, the underside falls behind that camera and **no shadow renders at all**. The axes go
above the base instead, or the ground draws over them.

The ground's material writes no depth (`depthWrite: false`) with an explicit `renderOrder`, so the transparent fade composites correctly against the background rather than punching a hole in it.

---

## Colours

| Element | Value | Note |
|---|---|---|
| Background | `#f0f0f0` | Unchanged, set on the `<Canvas>`. |
| Ground | `#E4E7F0` starting value | Slightly darker than the background and cool enough to sit under the `#8899aa` model. This is the one value **tuned against a screenshot** before committing — "slightly darker" is a judgement only the eye settles. Any adjustment stays within the stiko neutrals, between `sheet` `#EAEDF6` and `divider` `#E4E5EC`. |
| X axis | `#B5636B` | Dusty red. |
| Y axis | `#6E9178` | Dusty green. |
| Z axis | `#6B74A8` | Dusty indigo-blue; nods to the brand `#5B60FF` while staying readably "blue". |

The ground material sets `toneMapped={false}`. React Three Fiber applies ACES filmic tone
mapping by default, which lifts light colours toward white — with it on, the ground was
indistinguishable from the background at every value in the sanctioned range, and the
temptation was to keep darkening the colour to compensate. Turning tone mapping off for this
one flat, unlit surface makes it render exactly as authored, at which point `#E4E5EC` reads
correctly. drei's own gizmo materials do the same.

The axis colours stay hue-correct so the conventional X/Y/Z reading survives, but desaturated so they recede behind the model rather than competing with it. They intentionally do **not** match the view gizmo's saturated triad (`#E5484D` / `#30A46C` / `#3E63DD`): the gizmo is a foreground control the user clicks, the ground axes are background reference.

---

## Testing

**Unit** (`node --test`, the repo's existing runner): `lib/sceneScale.ts` is pure and gets direct coverage — proportionality across radii spanning 1 to 10,000, ordering of the stacking offsets (ground < shadow < axes), non-zero separation at both extremes, and degenerate zero/negative/NaN radii producing finite positive values.

**Visual**, via the dev harness described in the local-verification notes (`/portal/dev-gizmo` under `AUTH_SECRET` + a dummy `DATABASE_URL`, samples served from `public/uploads/`): at radii 1, 100, 800 and 5,000 confirm the ground fades with no visible edge, the model rests on it rather than intersecting, the shadow lands under the object, the axes are legible without dominating, and no z-fighting appears at any scale or camera angle. The harness is deleted before committing.

**Regression:** the ground, shadow and axes are model-scene content, so they correctly appear in annotation snapshots and in `renderCleanFrame()` output — unlike the view gizmo, which must stay out. Confirm a snapshot still excludes the gizmo but now includes the ground.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Z-fighting between ground, shadow and axes | Proportional stacking offsets, verified visually at both scale extremes. |
| `ContactShadows` cost | `frames={1}` renders the shadow map once instead of every frame. The model never moves and the shadow is camera-independent, so a per-frame pass would be pure waste. |
| `<Center top>` shifts every model up so its base is at y=0 | Intended, and the camera fit reads the post-`Center` world bounds, so framing follows automatically. Comment pins are stored in world space and are placed after load, so existing pins are unaffected. |
| Ground colour too subtle or too heavy | Tuned against screenshots at multiple scales before committing. |
| Fade radius too small on wide, flat models | Ground radius derives from the bounding sphere, which already accounts for the widest axis. |
