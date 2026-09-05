# Colouring the parts of a 3D model

Date: 2026-09-04

## Why

Every 3D model in Stiko renders as one undifferentiated grey mass unless the uploaded file
happens to carry authored materials. A reviewer opening a valve assembly sees a valve-shaped
silhouette; they cannot tell the bonnet from the body, or a flange from the pipe it bolts to.
Onshape, SolidWorks and every other CAD reviewer solve this the same way: parts are
individually addressable, and you can colour them.

Stiko cannot do that today, and the reason is not that the information is missing. It is that
the import pipeline destroys it — twice, in two different places, for two different reasons.

### The assembly tree is discarded on import

**STEP.** `occt-import-js` returns a `root` node carrying `name`, `meshes` and `children` —
the assembly hierarchy read out of the STEP product structure. A car's
`Wheel_FL > { Rim, Tire }` is in the file. `types/occt-import-js.d.ts` does not declare
`root`, and `lib/model/stepToGlb.ts:138` writes a **flat** list of sibling nodes:

```js
scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive)));
```

One node per solid, no nesting. The tree is read, ignored and dropped.

**GLB.** `lib/model/optimizeGlb.ts:129` runs `flatten()` — which bakes node transforms and
collapses the hierarchy to a flat scene — and then `join({ keepNamed: false })`, which merges
every primitive sharing a material into one. Measured against a synthetic export of six named
parts (`Body`, `Flange_A`, `Flange_B`, `Bonnet`, `Stem`, `Handwheel`) sharing two materials:

```
BEFORE nodes/prims: 6 / 6
AFTER  nodes/prims: 2 / 2
```

Names gone, geometry fused by colour. This is the same transform that took a real Rhino
export from 7,995 primitives to 26 draw calls, so it is doing valuable work — but what
survives it is *material groups*, not parts.

### Naive fixes trade one of the two requirements away

Two constraints govern this work, and they are in tension under any obvious approach:

1. **Performance must not visibly regress.** The 7,995-draw-call problem must not come back.
2. **Parts must be semantic.** A wheel rim is one part. Not 200 fragments, not "everything
   that happens to be grey".

Keeping parts as separate meshes satisfies (2) and breaks (1): draw calls return to roughly
the part count. Keeping the aggressive join satisfies (1) and makes (2) impossible.

Both are satisfiable at once, because three.js r169 — the version in `package.json` — ships
`BatchedMesh`, and because the semantic grouping the feature needs is already sitting in the
files.

## What is being built

A **Parts** panel in the 3D viewport listing the model's parts. Each part card carries an eye
that hides it and a colour pill that opens the existing custom colour picker. Colours are
saved on the version and seen by everyone; visibility is a session-only way of looking.
Models arriving with no authored colours get a restrained automatic colouring so an assembly
reads as an assembly on open.

## Design

### 1. What a part is

**A part is a node in the model's own assembly tree.** Not a primitive, not a material group,
not a connected component. A rim modelled as 200 fragments under one node is one part.

The tree is derived at **load** time by walking the loaded `THREE.Object3D` graph. There is no
sidecar manifest and nothing extra written into the GLB: the hierarchy *is* the manifest, and
the import work below exists purely to stop destroying it.

A part's stable key is its **index path from the scene root** — `0/2/1` — with the node name
carried alongside for display only. Names are unreliable (absent in many exports, duplicated
in others); index paths are not.

> **Invariant.** This key is stable only because an uploaded file's bytes never change after
> upload. Re-running optimization over an already-stored file would renumber every part and
> silently reassign every saved colour. If a future change ever needs to re-optimize existing
> files, part colours must be migrated in the same operation or dropped deliberately.

Formats that carry no hierarchy at all — STL, PLY, a single-node soup — yield no parts. The
panel says so plainly rather than inventing fragments to fill itself.

### 2. Import — preserve the tree

**`lib/model/optimizeGlb.ts`** — remove `flatten()` and `join()`. In their place, merge
primitives *within* each part using `joinPrimitives` (`@gltf-transform/functions` 4.4.2), so
the rim's 200 fragments become one geometry while the rim itself stays a distinct node.
`dedup()`, `weld()` and `prune()` stay.

Consequences worth naming:

- Files still shrink, and they parse far faster than 7,995 loose primitives — `GLTFLoader`
  allocating one `BufferGeometry` per primitive is a real load-time cost, which is why
  per-part merging must happen at import and cannot be left to the runtime.
- The `KHR_mesh_primitive_restart` trap documented at `optimizeGlb.ts:94` was a property of
  `join()`, and leaves with it. The mode normalization and the `listExtensionsRequired()`
  guard **stay anyway** — `weld()` is still in the chain, and the guard costs nothing.
- `measure()` gains a **part count**, and the lossless test gains a third assertion beside
  triangles and line indices: parts in equals parts out. This is the direct lesson of the
  primitive-restart regression — a conservation check that does not count a thing cannot
  protect it.

**`lib/model/stepToGlb.ts`** — read `result.root` and rebuild its `children` as real glTF
nodes instead of a flat sibling list. Mesh-to-node assignment comes from each node's `meshes`
index array. `types/occt-import-js.d.ts` gains the `root` declaration it is missing.

**`lib/model/partTree.ts`** *(new)* — a pure function from a loaded `THREE.Object3D` to a
`PartNode` tree, assigning index-path keys. Pure and unit-testable; no three.js rendering, no
DOM.

```ts
interface PartNode {
  key: string;          // index path from scene root, e.g. "0/2/1"
  name: string;         // display name; may be empty or duplicated
  children: PartNode[];
  meshes: THREE.Mesh[]; // geometry owned directly by this node
}
```

### 3. Render — `BatchedMesh`

At load, group parts by material appearance and build one `THREE.BatchedMesh` per group via
`addGeometry` / `addInstance`. Each batch material is set to white with **`vertexColors` left
off**, and each part's original colour is baked in through `setColorAt`.

> **Corrected during implementation.** This section originally specified `vertexColors: true`.
> That is wrong and renders every batched model **black**: the vertex prefix defines `USE_COLOR`
> from `vertexColors` alone (`WebGLProgram.js:632`), which declares `attribute vec3 color` and
> runs `vColor *= color` — but the batched geometry never carries a `color` attribute, so it
> reads WebGL's generic default `(0,0,0,1)` and zeroes the surface. `USE_BATCHING_COLOR` is
> derived automatically from `_colorsTexture !== null` and *already* declares and initialises
> `vColor` on its own (`color_vertex.glsl`). Neither `BatchedMesh` nor `InstancedMesh` sets
> `vertexColors` anywhere in three — the per-instance colour path deliberately does not use it.

**"Material appearance" means every property of a material except its base colour** —
roughness, metalness, any map, `side`, transparency, `opacity`. Two materials differing only
in `color` share a batch, because colour is exactly what `setColorAt` now carries. Two
differing in anything else get separate batches. Textured materials are therefore never
merged with untextured ones, and are rare enough in CAD exports not to matter.

That last detail is what makes the draw-call count *fall*: `setColorAt` writes into a
`batchingColorTexture` sampled per part in the vertex shader (`color_vertex.glsl`,
`USE_BATCHING_COLOR`, enabled automatically by `WebGLProgram.js:550`), and the shader
multiplies it into `vColor`. Since most CAD materials differ only in base colour, folding
colour out of the material collapses a model that needs 26 draw calls today to one or two.

What this buys, all natively:

| Need | Mechanism | Cost |
|---|---|---|
| Colour a part | `setColorAt(instanceId, color)` | one texel write |
| Hide a part | `setVisibleAt(instanceId, false)` | skipped in the multi-draw |
| Pick a part | `intersect.batchId` from the existing raycast | none |
| Cull | per-instance frustum culling | better than today |

No shader authoring, no geometry rebuild, no recompile on colour change.

Where `WEBGL_multi_draw` is unavailable, three falls back to a per-instance draw loop
(`WebGLRenderer.js:871`). The program, uniforms and buffers still bind once, so this remains
far cheaper than separate meshes — the fallback is a smaller win, not a regression.

**`lib/model/buildBatches.ts`** *(new)* — takes the loaded scene and the part tree, returns
the `BatchedMesh` set plus a `Map<partKey, { mesh, instanceId, originalColor }>`. Models with
no part tree return `null` and render exactly as they do today.

### 4. Persistence

```sql
CREATE TABLE IF NOT EXISTS part_colors (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  part_key TEXT NOT NULL,
  color TEXT NOT NULL,
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_id, part_key)
);
```

A table rather than a JSONB column on `files`, specifically so two reviewers colouring
different parts of the same model cannot clobber one another's writes.

`PATCH /api/files/[id]/part-colors` with `{ partKey, color }`, or `color: null` to clear an
override and return the part to its original appearance. Gated on **`canTransform`**, already
defined in `lib/capabilities.ts:16` as "May move or rotate a 3D object for everyone.
Deliberately not an alias for canUpload" — colouring is the same class of shared-scene edit,
and reuses the distinction rather than inventing a parallel one. The server remains the
authority; the client hides the control, it does not enforce the rule.

**Auto-colours are never stored.** They are a deterministic pure function of the part tree, so
every viewer computes the same result. Only deliberate overrides become rows.

### 5. The Parts panel

A `Parts` pill in the row at `app/portal/[id]/page.tsx:1329`, beside `FocalLengthControl`,
**collapsed by default**. It copies that component's popover behaviour exactly: opens
**upward** (the row is `items-end` precisely because its panels open upward), closes on
outside pointer-down or Escape. Same render conditions as the focal pill — 3D file only,
hidden during a markup session and while an attachment fills the viewport.

The panel lists part cards. Each card carries:

- **An eye** — toggles the part's visibility via `setVisibleAt`. **Session-only, available to
  every role.** Hiding is a way of *looking* at a model, which is the argument
  `app/portal/[id]/page.tsx` already makes for cross-section planes: "a plane's pose is
  exactly that too: session-only, never persisted, discarded the moment the tool closes."
  Nothing is written, and one reviewer cannot make geometry vanish for the designer.
- **A colour pill** — shows the part's *effective* colour (its override if set, otherwise its
  original), so an unpainted part reads correctly rather than showing an empty chip. Clicking
  it opens `components/markup/ColorPickerPopover.tsx` unchanged; its API is already exactly
  `{ color, onChange }`. The popover carries a **Reset** action that clears the override.

Nested files render as indented, collapsible assembly rows with children beneath. Eye and
colour pill on an assembly row apply to its whole subtree. A flat file — the common case, and
what a typical valve export looks like — shows no nesting affordance at all.

The list is virtualized with a search field, because part counts are unbounded. Hovering a row
highlights its part in the viewport; clicking a part in the viewport reveals and selects its
row. That second direction reuses the raycast already dropping comment pins at
`ModelViewerInner.tsx:246` and is what keeps the panel navigable when a file's names are poor.

Roles without `canTransform` see the tree, the colours and the eye, but the colour pill is
inert.

### 6. Automatic colouring

**`lib/model/autoColor.ts`** *(new)* — pure function from a part tree to
`Map<partKey, string>`.

The rule, deliberately restrained: **top-level assemblies only, colours used sparingly**.
Rank the root's direct children by triangle count, descending. The largest keeps the neutral
base grey — it is almost always the main body, and it is the surface a viewer reads as "the
object". The next **four** at most take muted accent colours from a fixed ordered palette;
every remaining assembly stays grey. A model with one top-level assembly gets no colour at
all, which is correct: there is nothing to differentiate.

Ranking by triangle count rather than bounding volume is deliberate — volume would rank a
large hollow shell above the dense mechanism inside it, which is the opposite of what reads
as the main body.

This mirrors how a real CAD assembly reads: a valve is mostly grey steel with brass flanges
and a copper stem, not a rainbow.

It runs **only when the model arrives carrying no authored colours**. A file with real
materials is left exactly as its designer made it — the same principle
`lib/model/repairMaterials.ts` already follows in only ever repairing the exporter-default
signature and never touching a named, authored material.

Being deterministic, this needs no storage and no migration; a user's overrides simply
displace it per part.

## Scope boundaries

**Existing uploads will show no parts.** Their stored GLB was flattened and joined at upload
time; the hierarchy is not in the bytes any more. The untouched original is still in S3 beside
it, but that is the 7,995-primitive version, slow to parse — loading it silently would trade a
visible feature for an invisible stall. Legacy files therefore render as they do today, and the
Parts panel renders nothing for them — not a "this file has no separable parts" message. That is
a deliberate simplification made once batching started gating on `hasMarkers`, not an oversight:
a legacy/OBJ/STL upload is the common case here, not the exception, and a permanent notice on
every one of them would be noise with no action behind it. Re-uploading produces parts.

**STL and PLY will never have parts.** They are single geometries. This is a property of the
formats, not a limitation to be worked around.

**Not building:** connected-component analysis to invent parts where a file has no hierarchy;
per-face colouring (`brep_faces` from OCCT would allow it, and it is not what was asked for);
transparency or material property editing; per-part colour history or attribution UI.

## Testing

Pure functions under `node --test` in `scripts/tests/`, matching existing practice:

- `partTree.test.mjs` — tree construction, index-path key stability, empty/flat/deep inputs,
  duplicate and absent names.
- `autoColor.test.mjs` — top-level-only selection, the largest assembly staying grey,
  determinism across runs, the no-op on models with authored colours.
- `optimizeGlb.test.mjs` — extended: part count preserved alongside triangles and line
  indices; the six-part-two-material fixture from *Why* asserted to survive as six parts.
- `stepToGlb.test.mjs` — extended: `root` hierarchy reproduced as nested glTF nodes.

**Browser verification is mandatory, not optional.** `BatchedMesh` replaces the object graph at
the heart of the viewer, and the following each touch it and must be exercised by hand before
merge: cross-section clipping and `SectionCaps`; comment-pin raycasting and pin projection;
snapshot capture; `<Center>` framing and bounding-radius measurement; move/rotate transforms;
`makeDoubleSided` and `repairExporterDefaults`, which traverse `.material` and must be
confirmed to behave on a `BatchedMesh`. `lib/model/repairMaterials.ts` in particular runs on
the loaded tree *before* batching and must keep doing so.

This is called out explicitly because the markup enhancement work shipped without ever being
opened in a browser, and there is no staging environment to catch what that misses.

## Risks

| Risk | Mitigation |
|---|---|
| `BatchedMesh` breaks viewer machinery in ways unit tests cannot see | The verification list above, by hand, before merge |
| A pathological file has thousands of top-level parts | Batching makes draw calls independent of part count; the panel is virtualized and searchable |
| Fixed `BatchedMesh` capacity (`maxInstanceCount`/`maxVertexCount`/`maxIndexCount`) | Sized from measured counts at build time, not guessed |
| `BatchedMesh.optimize()` has a known id/index mismatch (`BatchedMesh.js:780`) | Never call it |
| Removing `join()` regresses draw calls for files with many small parts | Per-part `joinPrimitives` at import plus runtime batching; the extended lossless test measures the outcome |
| Part keys shift if a stored file is ever re-optimized | Documented as an invariant above; any future re-optimization must migrate or drop colours deliberately |

## Rollback

Production is the only environment (`stiko-no-staging-environment`), so this ships behind a
clean revert path:

- Migration `009-part-colors.sql` is additive — a new table only, no column changes to `files`.
  Dropping it loses saved colours and nothing else.
- The import changes affect only files uploaded after deploy. Files uploaded before it are
  untouched and unaffected by a revert.
- `buildBatches` returning `null` is already the legacy render path, so disabling batching is
  a one-line change rather than a rewrite.

Migrations are applied manually and have been forgotten twice (`stiko-migration-deploy-ordering`);
check `schema_migrations` before deploying.
