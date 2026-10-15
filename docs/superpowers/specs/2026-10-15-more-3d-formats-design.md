# More 3D formats — design

**Date:** 2026-10-15
**Status:** Draft for review

## Goal

Let Stiko open more of the 3D files its audiences already have, at $0 running cost, without
sending files to a third party. Native CAD files that nothing free can read are refused with
specific export advice, not silently. Every refused extension is counted so demand is visible.

| | Before | After |
|---|---|---|
| 3D extensions Stiko can show | 9 | 15 |
| All viewable extensions | 22 | 28 |
| Native CAD upload | Silently refused | Refused with export advice |
| Data on refused uploads | None | Count per extension |

New viewable formats: **FBX, 3MF, 3DM (Rhino), IGS/IGES, BREP**.

## Background and decisions already made

- Paid converters were evaluated and rejected: Autodesk APS, convert3d, CAD Exchanger and
  others. The budget is at most $30 a month and must be monthly.
- **SolidWorks and other native CAD files are deferred.** Their formats need a licensed
  kernel. Users can export STEP, which Stiko already opens.
- **assimpjs was evaluated and rejected.** It was run on Assimp's own test models: production
  3MF files came out empty, external textures are never embedded, X3D/VRML/USD/IFC all
  failed, and the package has not been updated since July 2023. The formats it adds beyond
  three.js are legacy game formats that Stiko's audience does not use.
- **IFC is out of scope** at the user's request. web-ifc did convert a sample house model
  (110 products, about 36k triangles, 117 ms), so it remains a viable later addition.
- **Upload-time conversion stays off.** The kill switch in `app/api/files/upload/route.ts`
  (2026-09-03) disabled STEP tessellation during upload because it killed in-flight PUTs.
  STEP converts in the viewer today, and the new CAD formats follow that live path.

## Design

### 1. How each new format opens

| Format | Extensions | Opened by | Thread |
|---|---|---|---|
| FBX | `.fbx` | three.js `FBXLoader` | main, like OBJ/DAE |
| 3MF | `.3mf` | three.js `3MFLoader` | main |
| Rhino | `.3dm` | three.js `3DMLoader` (uses rhino3dm) | rhino3dm runs its own worker |
| IGES | `.igs`, `.iges` | `STEPLoader` → `runStepConvert` → `stepWorker` (occt `ReadIgesFile`) | worker |
| BREP | `.brep` | same path, occt `ReadBrepFile` | worker |

IGES and BREP reuse the STEP pipeline unchanged except for format dispatch. That keeps the
`STEP_TESSELLATION` parameters, the 60 s viewer timeout, worker termination,
`ModelErrorBoundary` and the GLB build in `stepToGlb.ts`. occt's `linearUnit` has no effect
on BREP (per the occt-import-js README), so BREP renders in its native units.

### 2. Components

**`lib/fileFormats.ts`: the single model-format list.**
- Add `fbx`, `3mf`, `3dm`, `igs`, `iges`, `brep` to `MODEL`.
- Export a `MODEL_EXTENSIONS` constant.
- `components/viewers/ViewerContainer.tsx` (its `MODEL_EXTENSIONS`) and
  `app/portal/[id]/page.tsx` (`MODEL_3D_EXTENSIONS`) import it instead of keeping their own
  copies. Their dotted form (`.glb`) is derived, not re-listed.
- Add `NATIVE_CAD_ADVICE: Record<extension, { app: string; advice: string }>` and
  `adviceFor(filename)`. See section 3.

**`lib/storageKeys.ts`.** Rename the concept "tessellatable" to cover the occt family:
`TESSELLATABLE_EXTENSIONS = {stp, step, igs, iges, brep}`. Variant production is unaffected
because the upload route only presigns variants for GLB (kill switch).

**`lib/model/stepWorker.ts` and `lib/model/stepToGlb.ts`.**
- The message carries `{ bytes, format: 'step' | 'iges' | 'brep' }`.
- `stepToGlb` selects `ReadStepFile` / `ReadIgesFile` / `ReadBrepFile`.
- The wireframe path (`stepWireframe.ts`) stays STEP-only; it parses STEP text.

**`lib/model/runStepConvert.ts` and `lib/STEPLoader.ts`.** Pass the format, derived from the
file extension, through to the worker. The loader is selected for all three formats.

**`components/viewers/ModelViewerInner.tsx`: `getLoaderForExt`.**
- Add `.fbx` → `FBXLoader` and `.3mf` → `ThreeMFLoader`.
- Add `.3dm` → `Rhino3dmLoader`, configured with `setLibraryPath('/rhino3dm/')`.
- Add `.igs`, `.iges`, `.brep` → `STEPLoader`.

The existing root extraction handles all of them: 3DMLoader and 3MFLoader return an
`Object3D`, and FBXLoader returns a `Group`.

**Self-hosted rhino3dm.**
- `postinstall` copies three's bundled `node_modules/three/examples/jsm/libs/rhino3dm/`
  `rhino3dm.js` and `rhino3dm.wasm` to `public/rhino3dm/`, following the existing
  occt-import-js.wasm line. Using three's own copy guarantees it matches the 3DMLoader that
  calls it, and adds no dependency.
- `middleware.ts` matcher adds `rhino3dm/` to its exemption list. Otherwise unauthenticated
  fetches 307 to `/login` and the loader compiles HTML. This is the same trap
  `occt-import-js.wasm` hit.

**Copy.** Update the `FileDropzone` hint to name FBX, 3MF, Rhino and IGES.

### 3. Refused uploads: advice and counting

**Advice.** `FileDropzone`'s "can't add" panel shows one line per refused file. When
`adviceFor` matches, the line reads `<filename> — <app>. <advice>`. Otherwise the current
generic text stays.

| Extensions | App | Advice |
|---|---|---|
| `sldprt`, `sldasm` | SolidWorks | Save As STEP, then upload. |
| `ipt`, `iam` | Inventor | Export STEP, then upload. |
| `f3d` | Fusion | Export STEP, then upload. |
| `catpart`, `catproduct` | CATIA | Export STEP, then upload. |
| `prt`, `asm` | NX / Creo / Solid Edge | Export STEP, then upload. |
| `par`, `psm` | Solid Edge | Export STEP, then upload. |
| `x_t`, `x_b` | Parasolid | Export STEP from your CAD tool, then upload. |
| `jt` | JT | Export STEP from your CAD tool, then upload. |
| `rvt` | Revit | Export FBX from a 3D view, then upload. |
| `skp` | SketchUp | Export FBX or OBJ, then upload. |
| `pln` | ArchiCAD | Export OBJ, then upload. |
| `vwx` | Vectorworks | Export FBX or OBJ, then upload. |
| `ifc` | IFC | IFC isn't supported yet. Export FBX or OBJ from your BIM tool. |
| `c4d` | Cinema 4D | Export FBX or GLB, then upload. |
| `ma`, `mb` | Maya | Export FBX or GLB, then upload. |
| `blend` | Blender | Export GLB, then upload. |
| `max` | 3ds Max | Export FBX, then upload. |
| `usdz`, `usd`, `usda`, `usdc` | USD | Export GLB, then upload. |

**Counting.**
- **Table:** migration `lib/migrations/017-rejected-uploads.sql` creates
  `rejected_uploads (extension text primary key, count integer not null, last_seen timestamptz not null)`.
- **Route:** `POST /api/uploads/rejected` takes `{ extensions: string[] }` and
  upserts `count = count + 1, last_seen = now()` per extension. It requires a signed-in
  user, the same as uploading.
- **Input validation:** at most 20 extensions per call, each matching `^[a-z0-9_]{1,10}$`;
  anything else is dropped. A file with no extension is sent as the empty string, and the
  server stores it as `(none)` after validation.
- **Privacy:** filenames are never sent or stored.
- **Missing table:** the route catches `undefined_table` (Postgres 42P01) and returns 204.
  Forgetting the migration loses counts, never uploads.
- **Client:** `FileDropzone` fires the request without awaiting it, and failure is ignored.
- **Reading the data:** a SQL query in the Neon console. No admin UI.

### 4. Failure behaviour

- Any load or convert failure shows the existing `ModelErrorBoundary` message. The original
  stays downloadable.
- **Rhino file with no render meshes:** 3DMLoader returns an object with no meshes. The
  viewer detects an empty mesh set for `.3dm` and shows: *"This Rhino file has no display
  meshes. Open it in Rhino, turn off Save Small, and save again."*
- **IGES/BREP** inherit STEP's 60 s timeout and termination.

### 5. Testing

**Fixtures.**
- **IGES and BREP:** read straight from the installed package, as `stepToGlb.test.mjs` already
  does for its cube: `node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.igs`
  and `.../cax-if-brep/as1_pe_203.brep`.
- **Other formats:** committed under `scripts/tests/fixtures/models/`, all small:
  - one FBX (`phong_cube.fbx`) and two 3MF (`box.3mf`, `production_components.3mf`) from the
    assimp test suite (BSD-3-Clause; licence noted in a README beside them). assimp's `box.fbx`
    was dropped: three's FBXLoader throws on it.
  - a 3DM generated by a committed script with rhino3dm, containing a mesh object
  - a second generated 3DM containing a Brep with no render mesh

**Unit tests (`node --test`):**
- `fileFormats`: membership of the new formats; `adviceFor` for every advice row,
  case-insensitively; unknown and no-extension files.
- Worker dispatch: `stepToGlb` produces a valid non-empty GLB for the IGES and BREP fixtures.
- **Rejected-uploads validation** lives in a pure function in `lib/rejectedUploads.ts`
  (normalise, cap at 20, regex, `(none)`) with its own tests.
- **The route's SQL** (the upsert and the 42P01 path) is executed once against the PGlite
  harness. That harness is rebuilt per session in the scratchpad and is not committed.
- The single-list refactor needs no test of its own: ViewerContainer and the portal page
  import `MODEL_FORMATS`, so they cannot disagree with it.

**Checks:** `tsc --noEmit`, `npm test`, `npm run lint`, `next build`.

**Browser verification:** on the local app (sign-in stubbed per the local visual verification
notes), open every fixture format in the viewer. Drop a `.sldprt` and confirm the advice line.
Load `/rhino3dm/rhino3dm.wasm` while signed out and confirm it is not a 307.

## Release

Production is the only environment.

1. Apply migration 017 in Neon and confirm it is listed in `schema_migrations`.
2. Merge to `main` and push (auto-deploys).
3. Open one FBX, one Rhino and one IGES file on production.

**Rollback:** revert the merge commit and push. The table can stay; nothing reads it.

## Out of scope

IFC, DWG/DXF (separate ongoing work), USDZ/VRML/AMF, video transcoding, native CAD
conversion, and re-enabling upload-time conversion. Also excluded: textures referenced by
FBX files as separate files; only textures embedded in the file are shown.
