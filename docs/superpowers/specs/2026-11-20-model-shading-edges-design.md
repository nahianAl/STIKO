# Model shading & edges — design

**Date:** 2026-11-20
**Status:** approved by the user, not yet planned
**Goal:** 3D models in the viewer look flat. A countersunk screw is near-white on near-white,
and its head face, chamfer and hex socket all render at the same brightness. Make models read
the way they do in Onshape: crisp, thin, dark edges and shading that separates faces by angle.

## Why it looks flat today

1. **Headlight-only lighting** (`components/viewers/SceneLighting.tsx`). One directional light
   copies the camera position, so every face turned towards the viewer gets the same light. This
   was a deliberate SketchUp-style choice, documented in that file's header. This design
   reverses it.
2. **No edge lines.** This is Onshape's main legibility cue, and the main thing the user wants.
3. Nothing darkens recesses, and pale part colours sit on a pale `#f0f0f0` background. Both are
   **out of scope** (see below).

## Decisions (made by the user)

- Edge lines: **yes**, and **not thick**. They are 1 px; WebGL ignores `linewidth`, so 1 px is
  also the floor.
- Lighting: **directional key/fill/hemisphere rig**, still camera-relative.
- Edges are **precomputed crease edges** (option A), not a screen-space post-process (option B).
  B was rejected because it adds a composer stage that touches snapshots
  (`preserveDrawingBuffer`), stencil section caps, measurement sprites and highlight.
- Not in this change: ambient occlusion, a new default part colour, an edges on/off toggle.

## 1. Edge lines

### New module: `lib/model/buildEdges.ts`

It is a pure function that has no React and no `@/` alias, so it stays runnable under
`node --test` (see the node-test import rules).

```ts
export interface ModelEdges {
  lines: THREE.LineSegments;          // one object, one draw call for the whole model
  ranges: Map<string, EdgeRange[]>;   // part key -> its slices of the full index buffer
  setHidden(hidden: (key: string) => boolean): void;  // rebuilds the index from visible ranges
  dispose(): void;
}
export function buildEdges(parts: PartNode[], opts?: { thresholdDeg?: number; maxTriangles?: number }): ModelEdges | null;
export function buildEdgesForObject(root: THREE.Object3D, opts?): ModelEdges | null; // legacy/unbatched + STL/PLY
```

- **Per part:** run `THREE.EdgesGeometry(geometry, thresholdDeg)` on each part mesh's geometry,
  using the same visible meshes and material groups `buildBatches` uses. Then bake the edge
  positions with the same `mesh.updateWorldMatrix(true, false); mesh.matrixWorld` that
  `buildBatches` puts on the instance matrix. The lines and the batches then share one frame,
  and the merged lines render as a sibling of the batch meshes.
- **Threshold:** default **30°**. A smooth cylinder or fillet tessellation gives no lines on its
  sides, while chamfers, socket corners and rims do get lines. Make it a named constant.
- **Merge:** concatenate every part's segments into one `BufferGeometry` with an index. Record
  each part's index range under its part key.
- **Hide:** `setHidden` rewrites the index to contain only the ranges of visible parts. It uses
  the same cascaded hidden map that drives `applyPartVisibility`, so assembly-row hiding
  cascades to edges exactly as it does to faces. It costs O(edges) per toggle and nothing per
  frame. Don't use `drawRange`, because hidden parts are not contiguous.
- **Budget:** if the total triangle count exceeds **1.5 M** (`maxTriangles`), return `null` and
  render no edges. Heavy files must never stall the main thread; see the 200 MB audit. Make it a
  named constant.
- **Skip:** geometry that is already lines or points (curve-only STEP, glTF LINES). It already
  draws as lines.

### Material

- `LineBasicMaterial`, colour **`#2b2f36`**, opaque, depth-tested and depth-writing. Edges
  behind faces stay hidden.
- Edges keep this colour regardless of `partColors` or highlight, as in Onshape.

### Faces sit behind their own edges

- Coplanar lines z-fight with the faces they bound. Give every face material in the model
  `polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1`. That covers the batch
  materials in `batchMaterialFrom`, the legacy primitive tree (traverse it when edges are built),
  and `DEFAULT_MATERIAL` / `VERTEX_COLOR_MATERIAL`.
- Section caps (`SectionCaps`) must keep working with the offset. **Verify in the browser.**

### Wiring in `ModelViewerInner.tsx`

- **Batched path:** `useMemo(() => buildEdges(parts), [parts])`. Render `<primitive>` next to
  the batch meshes, inside the same `modelRef` subtree. Dispose it in the same effect shape as
  `batches`.
- **Hiding:** extend the existing `hiddenParts` effect to call `edges.setHidden(...)` from the
  same `cascadedHidden` map.
- **Legacy `<primitive object={root ?? data} />` path and STL/PLY:** `buildEdgesForObject`.
  There are no part keys here, so there is no hiding (none exists today on these paths either).
- **Picking:** set `lines.raycast = () => {}`. Measurement snapping, comment pins and part
  clicks must not change at all.
- **Clipping:** the edges are under `modelRef`, so `ApplyCrossSection` should give their
  material the same `clippingPlanes`. **Verify** that its traversal visits `LineSegments`, not
  only `isMesh`. `SectionCaps` must **not** treat the lines as cap geometry. **Verify** it
  filters on `isMesh`.
- **Bounds:** the edges are a subset of the model's own vertices, so `Center`,
  `FitCameraToModel` and ground placement are unchanged.

## 2. Lighting (rewrite `SceneLighting.tsx`)

The rig stays camera-relative, so no side of the model is ever dark. Each light's direction is
recomputed every frame from the camera basis (right, up, forward) around the orbit target:

| Light | Direction (camera space) | Starting intensity |
|---|---|---|
| Key, directional | up + left of the view direction (≈ 35° up, 30° left) | 1.4 |
| Fill, directional | opposite side, slightly low | 0.45 |
| Hemisphere | sky `#ffffff` / ground `#b8bcc4`, world-up | 0.5 |
| Environment (`studio`) | unchanged preset | 0.15 → 0.3 |

- Drop the separate `ambientLight`; the hemisphere replaces it.
- The intensities are starting points. Tune them against screenshots of the countersunk screw
  (the user's complaint) and `public/jet_engine.glb`. Target: head face, chamfer and socket
  walls read as three distinct tones from the default view.
- The header comment's "a headlight deliberately flattens form" reasoning is replaced with the
  new rationale. `repairMaterials.ts` quotes the environment intensity of 0.15 in a comment;
  update that comment. The metal repair logic itself stays.

## Error handling

- `buildEdges` must never throw into render. Wrap the work, log once, and return `null`. A model
  with no edges is the same as today.
- Large models fall back to no edges through the budget, not through a timeout.

## Testing

**Unit (`node --test`, `lib/model/buildEdges.test.ts`):**
- A unit box gives 12 segments.
- A 64-segment cylinder gives only its two rim loops: zero side segments at 30°.
- Two parts, one hidden through `setHidden`, leave an index that covers only the visible
  part's range. Showing it again restores the full count.
- A geometry over `maxTriangles` returns `null`.
- A part with a non-identity `matrixWorld` gets baked positions.

**Browser (harness recipe from the seamless-ground memory: temporary
`app/portal/harness-3d/page.tsx`, Playwright + swiftshader):**
- Before/after screenshots of the screw (STEP) and `jet_engine.glb`.
- Hide a part: its edges go.
- A cross-section clips the edges, and caps still render.
- Measure snapping and part click still hit faces.
- No z-fighting shimmer while orbiting.

## Out of scope

Ambient occlusion, a default part colour change, an edges toggle, silhouette lines on smooth
curves, and per-part explode.

## Rollback

The change is front-end only, with no migration and no env. Rollback is
`git revert -m 1 <merge>`.
