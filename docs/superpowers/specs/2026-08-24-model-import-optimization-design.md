# Model Import Optimization — Design

**Date:** 2026-08-24
**Status:** Approved (design), pending implementation plan
**Scope:** Two independent fixes for user-uploaded 3D models — collapsing draw-call explosion in fragmented CAD exports, and repairing materials that render black because the exporter omitted PBR factors.

---

## Why

Two bugs reported from testing the portal viewer, both reproduced and root-caused against a real Rhino export (`Rohit Resort Villas.glb`, 21.7 MB).

### The viewer is slow, and triangle count is not the reason

The reported symptom was "browser becomes really slow with 1 million+ triangles". The file that triggered it has **227,905 triangles** — trivial for any GPU. What it actually has:

| Measure | Value |
|---|---|
| Primitives (= draw calls per frame) | **7,995** |
| Median triangles per draw call | **2** |
| Primitives under 20 triangles | 5,489 |
| Nodes / meshes | 1,282 |
| Accessors / bufferViews | 30,451 / 30,466 |
| glTF JSON chunk | 6.5 MB, parsed on the main thread |

Rhino's exporter splits geometry per object and per material and merges nothing. GPUs are indifferent to 228k triangles; they are not indifferent to ~8,000 state changes per frame. The same stall would occur at 20k triangles.

Four factors compound it:

1. `frameloop` is unset on the `Canvas` (`ModelViewerInner.tsx`), so those draw calls run at 60fps even when the scene is idle.
2. Every named material carries `KHR_materials_transmission: {}`, `KHR_materials_clearcoat: {}`, `KHR_materials_ior` and `KHR_materials_specular`. Any one of these promotes the material to `MeshPhysicalMaterial` (`GLTFLoader.js`, each extension's `getMaterialType`), three.js's most expensive shader. Four materials carry a real `transmissionFactor`, which additionally triggers a full extra scene render pass per frame. This is inherent to the file's authored materials and is **not** addressed by this work — see the note under the transform chain.
3. `makeDoubleSided` disables backface culling on every material, doubling fragment work.
4. Comment-pin raycasting walks all 7,995 meshes per click.

### One third of the model renders pitch black

Material 0 — **549 primitives, 76,017 triangles, 33.4% of the model** — is:

```
baseColorFactor: [0, 0, 0, 1]     black
metallicFactor:  absent            glTF spec default = 1.0
roughnessFactor: absent            glTF spec default = 1.0
```

`GLTFLoader.js` correctly applies the spec defaults, producing a fully metallic material. Metals have zero diffuse response — they show only reflections. `SceneLighting.tsx` sets `ENVIRONMENT_INTENSITY = 0.15` deliberately ("the headlight does the lighting"), so there is nothing to reflect. Black albedo + no diffuse + near-zero environment = pitch black. The comment on that constant predicted this exact failure.

It looks correct in Rhino because Rhino shades display colours through its own viewport pipeline rather than treating them as PBR metal.

**The discriminator:** materials 0–11 and 31 have **no `name` field** — they are auto-generated from Rhino display colours. Materials 12–30 are authored, named, and all carry explicit `metallicFactor: 0`. Absence of a name plus absence of PBR factors reliably identifies "the exporter did not mean this".

---

## Measured result

The proposed transform chain, run against the real file:

| | Before | After |
|---|---|---|
| Primitives (draw calls) | 7,995 | **26** |
| Nodes / meshes | 1,282 | 26 |
| Accessors | 30,451 | 74 |
| **Triangles** | **227,463** | **227,463** (unchanged) |
| File size | 21.7 MB | 9.4 MB |
| Wall time | — | 5.6 s |
| Peak RSS | — | 523 MB |

A **307× draw-call reduction with zero geometry loss.** Peak memory ran ~24× input size, which is what drives the size threshold below.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where geometry optimization runs | **Client-side, in a Web Worker, at upload time**, before the S3 PUT. No new infrastructure, no Vercel memory ceiling, no CloudConvert dependency. Cost is paid once per upload rather than once per view. |
| 2 | Lossy simplification | **Never.** Strictly lossless: merge, dedup, weld, prune. Triangle count is preserved exactly. Stiko is a review tool; people approve and measure against these meshes. |
| 3 | Where material repair runs | **At load, in the viewer.** Covers every format, including the non-glTF ones the optimizer cannot touch (STEP, OBJ, STL, PLY, DAE, 3DS), and leaves the stored asset faithful to what the designer exported. |
| 4 | Material repair aggressiveness | **Fix metalness *and* lift near-black albedo**, but only on unnamed materials matching the exporter-default signature. Metalness-only would leave the 76k black triangles black and would not fix the reported bug. |
| 5 | Existing uploaded files | **Not a concern — Stiko has no users yet.** No backfill script, no view-time fallback, no migration. |
| 6 | STEP files | **Left unoptimized this pass.** STEP never becomes glTF, so this chain cannot apply to it (see below). Material repair still applies at runtime. |
| 7 | Failure policy | **Optimization never blocks an upload.** Any failure uploads the original; worst case is current behaviour. |

---

## Architecture

### `lib/model/optimizeGlb.ts` (new)

Pure: `ArrayBuffer → { buffer: ArrayBuffer, stats: OptimizeStats }`. No DOM, no network, no worker API — so it is testable under `node --test` exactly as `lib/crossSection.ts` and `lib/focalLength.ts` are.

Transform chain. **The ordering is load-bearing** — `weld()` must precede `join()`, or `join` produces a primitive-restart state that `weld` then rejects:

```
dedup()     merge identical accessors / materials / textures
flatten()   bake node transforms, collapse hierarchy
dedup()     again — flatten exposes new duplicates
weld()      index and merge co-located vertices
join()      merge primitives by material        <- the 307x win
prune()     drop orphaned nodes / meshes / accessors
```

**No extension-stripping pass.** An earlier draft proposed removing no-op `KHR_materials_transmission` to demote materials from `MeshPhysicalMaterial` to `MeshStandardMaterial`. Measurement showed this does not work and the step was cut:

- Stripping succeeds mechanically — on the reference file, 8 of 12 no-op instances are removed and the 4 real ones retained.
- But `KHR_materials_clearcoat`, `KHR_materials_ior` and `KHR_materials_specular` **also** return `MeshPhysicalMaterial` from `getMaterialType`. The reference file's `ior: 1` and `specularFactor: 0.5` are both non-default, so those extensions are genuinely in use and the materials stay Physical either way.
- Three.js only collects an object into the transmission render pass when `material.transmission > 0`, so the extra pass this was meant to eliminate was never running for no-op materials to begin with.

The remaining benefit is a few unused uniforms. Not worth the code.

`OptimizeStats` carries before/after primitive, triangle, node and byte counts, so the upload path can log what happened and tests can assert on it.

**New dependencies:** `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`. These must be reachable **only from the worker entry point**, never from a module in the main bundle — they are substantial, and the viewer must not pay for them on every page load. The worker itself is loaded lazily, so a session that never uploads a model never fetches them at all.

### `lib/model/optimizeWorker.ts` (new)

Thin Web Worker wrapper. Exists for **crash isolation**, not just for keeping the main thread responsive: a 500 MB-scale allocation that OOMs kills the worker, leaving the tab alive to fall back to uploading the original.

Guards:

- `MAX_OPTIMIZE_BYTES` — skip entirely above roughly 100 MB input (~2.4 GB projected peak at the measured 24× ratio). A tunable exported constant, not a literal.
- A wall-clock timeout, after which the worker is terminated and the original uploaded.

### `lib/model/repairMaterials.ts` (new)

`repairExporterDefaults(root: THREE.Object3D): THREE.Object3D` — traverses and mutates in place, returning `root`, matching the existing shape of `makeDoubleSided` and `setClippingPlanes` in `lib/threeMaterials.ts`.

A material is repaired only when **all** of the following hold:

- `material.name` is empty
- `metalness === 1 && roughness === 1`
- no `map`, `metalnessMap` or `roughnessMap`

That combination describes a perfectly rough mirror, which is physically meaningless and never authored deliberately, so it matches exporter defaults and nothing else. Repair applies:

- `metalness = 0`
- `roughness = 0.8`
- if base-colour luminance is below a near-black epsilon, replace with neutral grey

Named materials, textured materials, and explicitly-authored metals are all left untouched — intentional black stays black.

Called from `Model` in `ModelViewerInner.tsx`, in the same `useMemo` that already calls `makeDoubleSided`, so it applies to every `Object3D`-rooted format rather than glTF alone.

### Upload path — `lib/useUpload.ts`

Between file selection and the presign call: if the file is a model format under the size threshold, run the worker, and on success upload the optimized buffer as a second S3 object.

This requires two small API changes:

- `/api/files/upload` must presign a second key for the optimized object.
- `/api/files/complete` currently inserts without `converted_storage_key`; it gains an **optional** `convertedStorageKey` parameter, defaulting to `null`.

`conversion_status` is left **`NULL`** on this path. `'completed'` means "a CloudConvert job finished" and is read that way by the STEP flow; every non-STEP file today already carries `NULL`, so this is the well-trodden path and needs no UI change. `converted_storage_key` is populated independently of it.

### Storage semantics

No schema change. `converted_storage_key` already means "the artifact the viewer should load", which extends cleanly:

| Upload | `storage_key` | `converted_storage_key` |
|---|---|---|
| Direct GLB / glTF | original, untouched | optimized GLB |
| STEP, OBJ, STL, PLY, DAE, 3DS | original | `null` — loaded directly, see below |
| Optimization skipped or failed | original | `null` |

### Why only GLB and glTF

`gltf-transform` operates on glTF documents, so the chain applies to `.glb` and `.gltf` only. Every other model format Stiko accepts is parsed straight into three.js objects by its own loader and never becomes glTF:

- **STEP** is parsed **client-side** by `lib/STEPLoader.ts` via `occt-import-js` (the wasm binary copied by the `postinstall` script). It is never converted to GLB on the live path.
- OBJ, STL, PLY, DAE and 3DS each use their own three.js loader in `ModelViewerInner.tsx`.

`lib/cloudconvert.ts` does export `createStepToGlbJob`, but it is referenced **only** from `/api/conversions/retry` and is not wired into the upload flow — no code path calls it for a new upload. It is vestigial with respect to this work and must not be assumed live.

Because material repair runs at load rather than at import, **all** of these formats still get the black-material fix. Only the geometry chain is GLB-scoped.

Downloads continue to serve `storage_key`, so an uploader always gets their own file back byte-for-byte.

### Viewer — `ViewerContainer.tsx`

Currently requests a presigned URL for `file.storageKey` directly. Must prefer `convertedStorageKey` when present and fall back to `storageKey`. The `convertedStorageKey` field already exists on the client types (`lib/types.ts`, `FileList.tsx`, `FileTreeSidebar.tsx`) and is already returned by `/api/files`.

### Idle rendering — `ModelViewerInner.tsx`

`frameloop="demand"` and `dpr={[1, 2]}` on the `Canvas`. Landed as a **separate, independently revertable step**: `gl.preserveDrawingBuffer` and `CleanFrameRenderer` both exist to serve snapshot capture, and demand-mode rendering interacts with both. If verification shows snapshots or the headlight misbehave, this step reverts without touching anything else.

---

## Failure modes this design has to handle

### Optimization must never cost an upload

Worker throw, OOM, timeout, or over-threshold input all resolve the same way: upload the original, leave `converted_storage_key` null, let the viewer fall back. A user with a pathological model gets today's slow viewer, not a failed upload.

### `conversion_status` and `converted_storage_key` must decouple

The column and the `/api/files/[id]/conversion-status` endpoint exist for the STEP→CloudConvert flow and drive a "converting" state; `FileList.tsx` and `FileTreeSidebar.tsx` both type it as `'pending' | 'processing' | 'completed' | 'failed' | null`.

The direct-upload path writes `converted_storage_key` while leaving `conversion_status` at `NULL`, so a client-optimized GLB is never mistaken for a CloudConvert job in any state. The viewer's key selection must therefore branch on `convertedStorageKey` being non-null **alone**, never on `conversionStatus`.

### Merging discards per-object identity

`join()` collapses 1,282 nodes into 26. Verified safe against current behaviour: the transform gizmo targets the model root via `transformRef`, not sub-meshes, and comment-pin placement uses only `hit.point` converted to model-local space (`ModelViewerInner.tsx`), never object identity. `flatten()` bakes transforms into vertex data, so world positions — and therefore stored pin coordinates — are preserved.

This does foreclose future per-object selection, isolation or per-part metadata on optimized models. Accepted deliberately; the original file is retained at `storage_key` if that is ever needed.

---

## Testing

`scripts/tests/optimizeGlb.test.mjs`:

- A synthetic fragmented GLB collapses to one primitive per material
- **Triangle count is identical before and after** — the lossless guarantee, asserted directly
- Node transforms are baked correctly: a translated child's vertices land at the same world positions after `flatten()`

`scripts/tests/repairMaterials.test.mjs`:

- Unnamed, `metalness: 1`, `roughness: 1`, untextured → repaired
- Near-black albedo on such a material → lifted to grey
- Named material with the same factors → untouched
- Textured material with the same factors → untouched
- Authored `metalness: 1, roughness: 0.2` → untouched

Manual verification: load `Rohit Resort Villas.glb` in the local viewer and confirm the previously black third of the model shades correctly, orbit is smooth, comment pins land where clicked, and cross-section still cuts.

---

## Out of scope

- Lossy simplification / decimation / LOD (decision 2). A genuinely heavy single mesh — photogrammetry, dense scans — is not helped by this work and remains a known limitation.
- Geometry optimization for non-glTF formats — STEP, OBJ, STL, PLY, DAE, 3DS (decision 6). `occt-import-js` output in particular is likely fragmented per solid and may need its own merge pass later, but that is a three.js-side problem, not a glTF one.
- Backfill of existing files (decision 5).
- Draco / meshopt compression. The chain already takes 21.7 MB to 9.4 MB; further transfer-size work is a separate concern from draw calls.
- Texture compression and resizing.

---

## Risks

| Risk | Mitigation |
|---|---|
| Worker OOM on large models in low-memory browsers | Size threshold plus worker isolation; failure falls back to the original upload |
| Albedo lifting alters a deliberately black material | Signature requires an unnamed material with no maps and physically meaningless factors; authored materials are never matched |
| `frameloop="demand"` breaks snapshot capture | Landed as an isolated, revertable step and verified against snapshot flow before merge |
| No staging environment — production is the only environment | Every change is additive with a null-safe fallback path; the viewer behaves as it does today whenever `converted_storage_key` is absent |
