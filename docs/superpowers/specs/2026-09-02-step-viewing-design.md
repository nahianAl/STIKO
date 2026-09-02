# STEP files that open, and never freeze the tab

Date: 2026-09-02

## Why

A 13.7 MB STEP export from Rhino 8 (`Clamp 9inch reach.stp`) wedges the viewport
permanently. The file is valid. Stiko cannot open it, and fails in the worst possible way:
silently, forever.

`lib/STEPLoader.ts:61` calls `occt.ReadStepFile(buffer, null)`. Passing `null` selects
OpenCascade's defaults (`occt-import-js/src/importer.cpp:53-55`): linear deflection
`bounding_box_ratio` × `0.001`, angular deflection `0.5`. The meshed solid measures
322 × 53 × 610 mm, so the average bounding-box side is 328 mm and the requested chord error
is **0.33 mm**. 887 of the model's 1223 faces are NURBS patches — Rhino is a NURBS modeler,
so its STEP exports are overwhelmingly trimmed rational patches rather than analytic
surfaces, which are the most expensive input `BRepMesh` can receive.

Measured against the same WASM build the browser uses (a control `cube.stp` parses in
119 ms, so the parser itself is sound):

| linear deflection | time | triangles |
|---|---|---|
| 50 mm | 12.8 s | 28,685 |
| 10 mm | 19.7 s | 19,421 |
| 5 mm | 81.1 s | 44,407 |
| 2 mm | 138.3 s | 70,139 |
| 1 mm | >240 s, killed | — |
| **0.33 mm (current default)** | **never returns** | — |

Roughly double the cost per halving of deflection. Memory stays flat near 60 MB throughout,
so this is compute in `BRepMesh`, not an allocation failure and not a deadlock.

**The quality being bought is invisible.** Rendering each result from an identical camera
and diffing the pixels:

| comparison | mean difference | pixels differing >3% |
|---|---|---|
| 10 mm vs 5 mm | 0.09/255 | 0.31% |
| 10 mm vs 2 mm | 0.11/255 | 0.43% |
| 5 mm vs 2 mm | 0.05/255 | 0.14% |

Seven times the compute yields a 0.04% change in what a reviewer sees. Stiko is not slow
because fidelity is expensive here; it is slow because it requests detail far below the
threshold of visibility.

Three further findings shape the design:

**The failure is unreportable by construction.** `ReadStepFile` is a synchronous WASM call
on the main thread, so JS is wedged while it runs. The viewport overlay
(`app/portal/[id]/page.tsx:1031`) is `.stiko-cube`, a pure CSS transform animation that runs
on the compositor thread and keeps tumbling regardless. There is no timeout on the path. A
tumbling cube is not evidence of progress.

**There is no error boundary.** `ViewerContainer` sets `error` only when the presigned URL
fetch fails. A throw from `useLoader` inside `<Suspense>` has no boundary to catch it, so it
propagates past the viewer and `onReady` never fires — the overlay stays up even in the
cases that *do* fail fast today.

**The work is repeated per viewer.** Every reviewer who opens the same STEP re-tessellates it
in their own browser, and nobody keeps the result.

## Behaviour

### Converting at upload

A `.stp` / `.step` upload is tessellated to GLB in the uploader's browser, in a Web Worker,
before the upload completes — the same shape as the existing GLB optimization pass. The GLB
is stored beside the untouched original and becomes what every later viewer loads.

The uploader sees the existing upload progress. No new UI, no new waiting state: conversion
happens inside an upload that is already transferring megabytes, and measured at ~20 s for
this file it is not the long pole.

Conversion failing is never an upload failure. Every failure path — worker unavailable,
timeout exceeded, out of memory, malformed file — resolves to "upload the original", exactly
as `runOptimize` does today. The file still lands, still downloads, still appears in the
tree. Only the fast-viewing variant is missing.

### Opening a file

A STEP file that was converted at upload opens as a GLB, immediately.

A STEP file with no converted variant — uploaded before this change, or one whose conversion
failed — is tessellated in the viewer, in a worker, under a timeout. The viewport overlay
stays up while that runs, which is honest: it *is* still loading, and the tab stays
responsive throughout.

If viewer-side tessellation exceeds its budget or fails, the viewport shows:

> **This 3D file could not be prepared for viewing.**
> It is too complex to display in the browser. You can still download it.

That message is a finished state and releases the loading indicator. The failure is now
visible, bounded and explained, which is the single most important change in this document.

### Tessellation settings

| parameter | value | rationale |
|---|---|---|
| `linearDeflectionType` | `bounding_box_ratio` | scale-invariant; screen-space error tracks model size |
| `linearDeflection` | `0.03` | ≈10 mm on this model; visually identical to 0.006 at a seventh of the cost |
| `angularDeflection` | `0.5` | the knee — see below |

Angular deflection, not linear, is what preserves small curved features: it forces a minimum
segment count around a cylinder regardless of the linear setting, which is why the 200 mm
handle stays smooth at a 10 mm linear deflection. Holding linear at 10 mm and varying
angular:

| angular | time | triangles | vs `0.5` |
|---|---|---|---|
| 1.0 | 12.8 s | 14,069 | 0.89% of pixels differ — visible faceting on the handle |
| **0.5** | **19.7 s** | **19,421** | — |
| 0.3 | 24.5 s | 23,927 | 0.24% of pixels differ — no visible gain |

So `0.5` is kept and the linear term is relaxed. Both live as named constants in one module;
they are tuned against one real file and are expected to be revisited when a model
contradicts them.

## Architecture

### New files

**`lib/model/stepToGlb.ts`** — the conversion itself, and the only module that knows OCCT
exists. Takes STEP bytes, returns GLB bytes. Initializes the WASM singleton, calls
`ReadStepFile` with the settings above, builds a glTF `Document` via `@gltf-transform/core`
(one node/mesh/primitive per solid, POSITION + NORMAL + indices, per-solid material with
`metallic=0`, `roughness=0.6`, double-sided), and writes a GLB. Holds the deflection
constants. No DOM, no worker API, no React — callable from a worker or a test.

Solid identity is preserved: OCCT returns 11 meshes for this file and each becomes its own
node, so per-part selection and cross-sectioning keep working.

**`lib/model/stepWorker.ts`** — worker entry. Receives an `ArrayBuffer`, calls `stepToGlb`,
transfers the result back. Mirrors `optimizeWorker.ts`, including the comment that this
module is the only door through which OCCT may enter the bundle graph — the WASM is 7.6 MB
and a reviewer who never opens a STEP must not download it.

**`lib/model/runStepConvert.ts`** — browser-side front door, modelled directly on
`runOptimize.ts`: spawns the worker, enforces a timeout, terminates on expiry, and resolves
`null` on every failure. Shares `runOptimize`'s single-slot queue so a multi-file upload
never runs two tessellations at once.

Terminating the worker is what makes the timeout real. A wedged synchronous WASM call cannot
be interrupted on the main thread; in a worker it can be killed outright. This is the
mechanism that retires the infinite spinner.

**`components/viewers/ModelErrorBoundary.tsx`** — a React error boundary wrapping the model
viewer. Renders the failure message above, and calls `onReady` so the viewport overlay comes
down. Without this, a loader throw still hangs the indicator.

### Changed files

**`lib/STEPLoader.ts`** — no longer calls OCCT on the main thread. Fetches the URL and
delegates to `runStepConvert`, then parses the returned GLB with `GLTFLoader` and resolves
the scene. A `null` result throws, which the new boundary catches. The class keeps its
`THREE.Loader` shape so `useLoader` and the loader-by-extension table are untouched.

**`lib/storageKeys.ts`** — `OPTIMIZABLE_EXTENSIONS` stays `{glb}` and keeps its existing
meaning. Adds `TESSELLATABLE_EXTENSIONS = {stp, step}` and a combined
`producesViewerVariant(filename)`. The `.optimized.glb` suffix and `optimizedVariantKey` are
reused unchanged, so there is one variant key scheme rather than two, and the existing
derived-never-supplied security property is preserved verbatim.

**`lib/model/runOptimize.ts`** — `shouldOptimize` becomes extension-aware and routes GLB to
the optimizer and STEP to `runStepConvert`. Size caps stay separate: `MAX_OPTIMIZE_BYTES`
(100 MB) is sized for the optimizer's ~24× memory peak, which does not describe OCCT.
`MAX_STEP_BYTES` is 50 MB, present only to reject absurd inputs — for STEP the real guard is
the timeout, because cost tracks surface complexity, not file size.

**`lib/useUpload.ts`** — the converted STEP takes the existing optimized-variant path. The
`model/gltf-binary` content type at line 101 is already correct for the GLB.

**`types/occt-import-js.d.ts`** — `ReadStepFile` is currently typed
`(buffer: Uint8Array, params: null)`, which makes the settings above unrepresentable. Widen
`params` to an optional `OcctImportParams` (`linearUnit`, `linearDeflectionType`,
`linearDeflection`, `angularDeflection`, all optional) and add the `name` field the mesh
results carry. The declaration is hand-written, so it is the only thing enforcing this
shape.

**`components/viewers/ViewerContainer.tsx`** — wraps the `ModelViewer` branch in
`ModelErrorBoundary`, passing `onReady` through.

Not changed: `app/api/files/complete/route.ts` already derives `converted_storage_key` from
`hasOptimizedVariant`, and `ViewerContainer` already prefers `convertedStorageKey` while
`ModelViewerInner` picks its loader from the URL extension. A converted STEP therefore
arrives at `GLTFLoader` with no routing changes.

### Timeouts

| path | budget | basis |
|---|---|---|
| upload-time conversion | 120 s | measured 19.7 s; ~6× headroom; matches existing `TIMEOUT_MS` |
| viewer-time conversion | 60 s | a reviewer waiting on a file needs an answer sooner than an uploader does |

The viewer budget is deliberately tighter than the uploader's. A file that cannot make 60 s
in the viewer is one that should have been converted at upload, and the message says so.

### Not running `optimizeGlb` on STEP output

OCCT emits one primitive per solid — 11 draw calls for this file — so the draw-call merging
that takes a Rhino GLB from 7,995 primitives to 26 has nothing to do here. Adding it would
cost the `@gltf-transform/functions` chain for no measurable gain. Revisit if a STEP file
ever arrives with hundreds of solids.

## Testing

**Unit** — `producesViewerVariant` across `glb`/`stp`/`step`/`STP`/`pdf`/extensionless;
`optimizedVariantKey` on a `.stp` key, on a key already carrying the suffix, and on a
directory containing a dot.

**Conversion** — `stepToGlb` against a small STEP fixture committed to the repo: asserts
success, a plausible triangle count, one node per solid, and non-zero bounds. The clamp is
13.7 MB and stays out of git; it is the manual case below.

**Timeout** — `runStepConvert` against a stub worker that never replies, asserting it
resolves `null` at the budget and that `terminate` was called. This is the regression test
for the actual bug and must not be skipped.

**Boundary** — `ModelErrorBoundary` renders the message and calls `onReady` when its child
throws.

**Manual, with the clamp** — upload it and confirm: the upload completes, a
`.optimized.glb` appears beside it, opening it is immediate, all 11 parts are present and
separately selectable, and cross-section still cuts. Then open the original `.stp` directly
with no variant present and confirm the tab stays responsive throughout and ends in either a
model or the failure message — never an indefinite cube.

The pre-change behaviour is the baseline: it never finished.

## Out of scope

**Server-side conversion.** CloudConvert is live and paid, and roughly 70% wired
(`lib/cloudconvert.ts`, the webhook, the retry route, all three DB columns). It is
unreachable: `createStepToGlbJob` is called only from the retry route, which requires
`conversion_status = 'failed'`, while `files/complete` deliberately writes `NULL`. That gap
is left in place. It becomes the right fix when a file is measured to exceed what a browser
can do — and it is worth knowing then that CloudConvert exposes no tessellation controls, so
it trades the deflection settings above for a vendor default.

**Other heavy formats.** IGES, and large OBJ/STL, are untouched.

**Progress reporting.** OCCT gives no progress callback; a percentage would be fabricated.
