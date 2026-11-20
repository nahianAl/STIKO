# SolidWorks assemblies (.sldasm) — design

**Date:** 2026-11-19
**Status:** Approved in conversation.
**Builds on:**
- `docs/superpowers/specs/2026-11-19-more-cad-formats-design.md`, which provides the format table, the per-format switch and the worker (all live);
- `docs/superpowers/specs/2026-10-18-sldprt-conversion-design.md`, which provides the claim/callback protocol.

This spec only describes what changes.

## Goal

People upload a SolidWorks assembly file (`.sldasm`) on its own and review it in the 3D viewer, with each component listed by its real name in the parts panel.

## Spike (2026-11-19)

The NIST MTC assembly (one `.SLDASM` plus 8 `.SLDPRT` parts, from `~/Desktop/stiko-cad-samples/solidworks-assembly-sldasm/`) was run through `usd-convert-cad` 0.3.0 on a Modal T4. A throwaway script was used, not the worker.

| Case | Result |
|---|---|
| Assembly + all 8 parts beside it | 36 bodies, 5 materials, 648,888 triangles, extent 152.4 × 101.6 × 107.7 mm |
| Assembly, one part missing | 36 bodies, same extent (the missing part filled in) |
| **Assembly alone** (parts renamed so none is found; also run as a lone file) | **36 bodies, 5 materials, 436,251 triangles, same extent**, 12.1 MB GLB, converts in about 4 s |

What this shows:
- **A `.sldasm` carries a display copy of every component**, so the converter rebuilds the whole assembly from that one file. The model is the same; only the tessellation is coarser.
- **This depends on a SolidWorks save setting** that is normally on. An assembly saved without it gives no visible mesh, which is the existing failure path.
- **Real names are present.** Each component is an `Xform` whose `displayName` metadata holds SolidWorks's instance name, for example `ZINC PLATED STEEL HEX NUT-3` or `nist_mtc_crada_cover_rev-B-1`. Its mesh child is just `Mesh`. The spike ran with `--convert-metadata`; whether `displayName` also appears without it is checked in the real-file test.

## Real-file test (2026-11-19)

Five assemblies, each uploaded alone (no parts beside it), through the real worker code (`cad-worker/app.py::smoke`, `worker_core.run_converter` + `usd_to_glb.py`) on a Modal T4. `modal run` only; nothing deployed. The converter was called exactly as the worker calls it, **without `--convert-metadata`**.

| Assembly | Source (licence) | Saved no later than | Seconds | GLB MB | Bodies | Triangles | Extent (mm) | Names sample | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `nist_mtc_crada_assembly_rev-D.SLDASM` | NIST MTC CRADA (US Gov, public domain) | SolidWorks year unknown | 9.0 | 12.1 | 36 | 436,251 | 152.4 × 101.6 × 107.7 | `nist_mtc_crada_box_rev-D-1`, `91274A141_COATED ALLOY STEEL SOCKET HEAD CAP SCREW-1`, `90591A141_ZINC PLATED STEEL HEX NUT-3` | **Pass**: 36/36 real names, same body count, triangle count and extent as the spike |
| `MLS800.SLDASM` | blemasle/mls800-enclosure (MIT) | 2019 or earlier | 8.2 | 7.5 | 115 | 274,644 | 482.6 × 43.9 × 98.5 | `Rack-Chassis-2`, `Rack-Cover-1`, `flush stud_pmm-10` | Pass: 115/115 real names; 482.6 mm is a 19-inch rack width |
| `ens.SLDASM` | enriquewph/esp-map (MIT) | 2024 or earlier | 7.1 | 3.9 | 64 | 139,712 | 104.0 × 78.0 × 27.3 | `Pcb_ec12.step-1`, `U2_SMDIP_16_W953mm_9c7765f4fb9e.step-1` | Pass: 64/64 real names |
| `Dingo Quadruped.SLDASM` | Yerbert/DingoCAD (MIT) | 2026 or earlier | 44.9 | 113.5 | 1,735 | 4,289,185 | 250.8 × 414.1 × 555.7 | `Torso base plate-1`, `CLS6336 35kg servo-1`, `CLS6336 35kg servo-1 (2)` | Pass: 1,735/1,735 real names, 1,352 of them numbered " (2)" and up because SolidWorks repeats instance names across sub-assemblies, and the flat parts list shows those as "name (2)" without the parent context; input 64,862,814 bytes (61.9 MiB) and GLB 113,546,456 bytes (108.3 MiB) are both under the worker caps (200 MiB in, 150 MiB out) |
| `01-MOTOR_ASM.SLDASM` | takaki-maeda-99/GEM-4 (Apache-2.0) | 2026 or earlier | n/a | none | n/a | n/a | n/a | n/a | Failed through the verdict path: `no visible mesh in the converted part` (a 25 KB file, which is consistent with an assembly saved without display data). Recorded, not a blocker |

Public repos were found with `gh search code --extension sldasm`; only MIT, Apache-2.0, BSD, CC0, CC-BY and CERN-OHL repos were used. Poppy, gloworm and OpenSaint (no usable licence) and fluxpad, selfdrive and holydrone (GPL-3.0) were skipped. The files live in `~/Desktop/stiko-cad-samples/solidworks-assembly-public/` with a `SOURCES.md`; they are not in the repo.

**Timing.** The 9.0 s for the NIST assembly is the whole worker path (the converter, `usd_to_glb.py` and process overhead). The spike's "about 4 s" timed the converter alone.

**`--convert-metadata` is not needed.** Without it, every component node still carries the SolidWorks instance name (`displayName`), and no node in any converted assembly fell back to `Body N`. The worker command is unchanged.

**Single parts.** Three `.sldprt` files (`nist_ftc_11`, `nist_ftc_09`, `nist_ctc_02`) convert as before, each to one node named `Body 1`. A lone part has no component `displayName`, so it keeps the fallback name.

**Other formats already live (2026-11-19).** One sample each, through `smoke` (nothing deployed), then the GLB node names read back. In all five the stage's default prim (`/out`) and the `out` Xforms under it carry no `displayName`, so `usd_to_glb.body_name` never picks up a stage-root name and needed no change. Every name below is an authored `displayName` on a component or part Xform.

| Format | Sample | Nodes | Names |
|---|---|---|---|
| `.ipt` | `INV_nist_ftc_11_asme1_2021.ipt` | 1 | `INV_nist_ftc_11_asme1_2021.ipt` (the part's own name, extension included) |
| `.x_t` | `Maslow_Frame.x_t` | 24 | `Part 1`, `Part 1 (2)` ... `Part 1 (24)`: the file names all 24 parts "Part 1", so only the numbering tells them apart |
| `.x_b` | `Foot_only.x_b` | 23 | `tie-rod-ankle-brackket_left:1`, `foot-top:1`, `2020_150mm:2`, `toes:1`, ... (23 distinct) |
| `.jt` | `NIST mtc crada assembly.jt` | 36 | `90591A141_ZINC PLATED STEEL HEX NUT_90591A141`, ` (2)` ... ` (10)`, ... `NIST mtc crada box_14652` (36 distinct, 8 before numbering) |
| `.sat` | `nist_mtc_crada_cover_rev-B.SAT` | 1 | `nist_mtc_crada_cover_rev-B` |

So a single `.ipt` or `.sat` part is named after the part inside the file, where a single `.sldprt` keeps `Body 1`. Nothing else changes for these formats.

**Conversion gate: ship.** The NIST assembly converts with real names and the right extent, and three other public assemblies do too. The one empty file failed cleanly. This verdict is about conversion only; the on-screen result is the next paragraph. Two things to remember: a 1,700-body, 4.3 million triangle assembly (Dingo) produces a 113,546,456-byte GLB (108.3 MiB), 72% of the 150 MiB output cap, and it will test the viewer harder than the 36-body NIST file does.

**On-screen result (2026-11-19).** In headless Chromium with software WebGL (`next dev`, the real `ViewerContainer` and `PartsPanel`, the converted GLBs served from `public/uploads`, every network write stubbed):
- **NIST:** renders with all 36 components in the parts panel, ready 2.6 s after navigation, no console errors beyond the harness's own stubbed endpoints.
- **Dingo:** loads and renders, lists all 1,735 components, ready 6.8 s after navigation (about 3.7 s of that is the local download of the 108.3 MiB file), no console errors beyond the harness's own stubbed endpoints, no crash.
- **Dingo's real-GPU viewer performance is unknown.** Software rendering is far slower than a real GPU, so these numbers show that it loads, not how it performs. The earlier 200 MB 3D audit found that very large models freeze clicks and zoom, and a 4.3 million triangle assembly may do the same.
- **Names on screen (fixed in `lib/model/partTree.ts`, see section 3).** Three.js's glTF loader sanitises node names: spaces become underscores, `[ ] . : /` are dropped, and a repeated name gets a `_1` suffix. So the panel used to show `90591A141_ZINC_PLATED_STEEL_HEX_NUT-3` where the GLB holds `90591A141_ZINC PLATED STEEL HEX NUT-3`, and `CLS6336_35kg_servo-1_(2)` for ` (2)`, and a panel search for "hex nut" found nothing. The loader keeps the original in each node's `userData.name`; the parts panel now shows that instead. This applies to every format and every GLB already stored, not only to assemblies.

## Decisions already made

- **The assembly file alone (the user's choice).** There is no zip or folder handling. Parts uploaded beside an assembly are not used by it; each still converts as its own `.sldprt` file, as today. Using sibling parts for full-quality geometry is a later option if anyone notices the coarser mesh.
- **Real names in the parts panel (the user's choice)**, for assemblies and for any format whose converter emits `displayName`, on files converted from now on. A single `.sldprt` part keeps `Body N`: the real-file test found no authored `displayName` on or above its mesh. Single `.ipt` and `.sat` parts do carry one, and get it (see "Other formats already live").
- **SolidWorks only.** Inventor `.iam`, CATIA `.catproduct` and NX/Creo `.asm` don't store display copies, so they need their parts uploaded. That is a separate, later project.
- **No migration.** Part colours and comment pins are keyed by index path (`part_key`, for example "0/2/1"), never by name, so renaming bodies cannot disturb stored data.

## Design

### 1. Format table: `lib/fileFormats.ts`

- **`CadFormat.noun`** becomes `'part' | 'model' | 'assembly'`.
- **New entry:** `sldasm: { app: 'SolidWorks', noun: 'assembly', advice: 'Save As STEP, then upload.' }` is added to `CAD_CONVERSION_FORMATS`.
- **Advice when disabled:** the `sldasm` row already in `ADVICE_BASE` (`SolidWorks`, `Save As STEP, then upload.`) stays and keeps winning, as for the other formats.
- **Copy follows from the table:**
  - "Converting SolidWorks assembly…"
  - "Couldn't convert this SolidWorks assembly." + "Save As STEP, then upload."
  - "Preparing SolidWorks assembly…" in the portal
  - millimetres for measuring (`assumedMmPerUnit` already covers every table key)
- **Upload trigger:** follows from the table too (`cadFormatEnabled`).

### 2. Worker: `cad-worker/`

- **`worker_core.CAD_EXTENSIONS`** gains `'sldasm'`. `input_suffix('a.sldasm')` returns `'.sldasm'`.
- **No rotation:** `stands_up` stays False for it, because SolidWorks is Y-up.
- **`--convert-metadata`:** not needed. The real-file test found `displayName` on every component without it, so `run_converter` is unchanged.
- **Body names: `usd_to_glb.py`.** Each glTF node is named after the nearest enclosing prim, the mesh itself included, that has authored `displayName` metadata.
  - **Clean-up:** trim, collapse runs of whitespace to one space, and cut to 120 characters.
  - **No name:** use `Body N`, the current behaviour.
  - **Duplicates:** when two or more nodes would get the same name (one component with several meshes, or the same instance name repeated across sub-assemblies), the second and later get ` (2)`, ` (3)`, and so on. The flat parts list shows these as "name (2)" without the parent context.
  - **Instance proxies:** the walk goes up through instance proxies, the same way meshes are already found.
  - The `extras.stikoPart = true` marker is unchanged.
- **README:** the supported list gains `.sldasm`, with one sentence on the display-copy behaviour.

### 3. Viewer and portal

One code change, and it is **not behind the switch**: `lib/model/partTree.ts` now shows GLTFLoader's original node name (`userData.name`) in place of the sanitised `object.name`, falling back to `object.name` when there is none. It applies to **every format and every GLB already stored**, as soon as the code deploys.

Effects on screen:
- `Body_1` becomes `Body 1`.
- Names keep `[ ] . : /` and spaces.
- Duplicate original names no longer get the loader's `_1` suffix. This is display only: identity (part colours, comment pins) stays by `part_key`, so nothing stored changes.

The only other app change is the `noun` addition in section 1. Sub-assemblies come out as a flat list of components, because `usd_to_glb.py` writes one node per mesh. A nested tree is out of scope.

## Failure table

The table in the 2026-10-18 spec applies unchanged. New in practice:

| Situation | Row becomes | User sees |
|---|---|---|
| Assembly saved without its display copy (no visible mesh) | `failed` | "Couldn't convert this SolidWorks assembly." + "Save As STEP, then upload." |
| Assembly larger than 200 MiB, or GLB over 150 MiB | `failed` | same |

## Testing

1. **Real-file test first, before app code.** Use the worker's `smoke` entrypoint, with `sldasm` added to `CAD_EXTENSIONS`, on:
   - the NIST assembly alone;
   - any other public `.sldasm` with a licence that permits testing (search GitHub, MIT, Apache, CC0 or CERN-OHL repos; 2–4 files from different SolidWorks years if they exist).

   For each, record:
   - bodies and triangles;
   - GLB size;
   - extent in millimetres. NIST ships no STEP for this assembly, so compare against the all-parts spike extent of 152.4 × 101.6 × 107.7 mm. For other assemblies, check the extent is plausible for the object;
   - names in the GLB, with and without `--convert-metadata`;
   - an on-screen look in the real viewer.

   An assembly that comes out empty is recorded as such; it shows that the failure path works.
2. **`node --test`:** the table test lists `sldasm`; `cadLabel('a.sldasm')`; `cadPreparingLabel('a.sldasm')` is "Preparing SolidWorks assembly…"; `assumedMmPerUnit('a.sldasm')` is 1; `formatTables` disjointness still holds; and `partTree` shows `userData.name` in preference to `object.name`.
3. **Worker pytest:**
   - `input_suffix` for `.sldasm`;
   - `stands_up` False for it;
   - naming in `usd_to_glb.py` on hand-built stages: a `displayName` on the parent Xform, on the mesh itself, none (gives `Body N`), duplicates (gives ` (2)`), whitespace and the 120-character cut, and through an instanceable prim.
4. **Browser:** the real `ViewerContainer` with the converted NIST assembly GLB. The parts panel lists the real names with their original spaces (`ZINC PLATED STEEL HEX NUT-3`, not `ZINC_PLATED_STEEL_HEX_NUT-3`), and an older single-part model reads `Body 1`, not `Body_1`. CadPreparer shows "Converting SolidWorks assembly…" with stubbed status. No uploads.
5. **Gates:** `tsc`, lint, all node tests, pytest, and `next build` with `sldasm` in the switch list, confirming it is inlined.

## Release

Production is the only environment. No migration.

1. Deploy `cad-worker/` to Modal. This is backward compatible, but **from this point newly converted assemblies, and any format whose converter emits `displayName` (`.ipt`, `.x_t`, `.x_b`, `.jt`, `.sat`), get real body names; single `.sldprt` parts keep `Body N`.**
   **Check before step 2** that the deployed worker accepts `.sldasm`. A request to the endpoint without the secret is refused with 401 before the filename is looked at, so it cannot prove this. Instead:
   - check out the commit that was deployed, and run `/tmp/stiko-cadw/bin/modal run cad-worker/app.py::smoke --samples DIR --out DIR` on the NIST assembly (`modal run` builds the same image; it does not call the deployed app). Confirm it prints seconds and a GLB size, not an error;
   - confirm the `modal deploy` output (or `modal app list`) shows `stiko-cad-worker` deployed just now.
2. On Vercel (Production), add `sldasm` to `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` (`sldprt,sldasm,ipt,x_t,x_b,jt,sat`), **only after the check above passes**. The real-file test and the on-screen check left this list as written, and the gate build inlined exactly this value. If `sldasm` goes in before the new worker is live, the old worker answers 422, the route treats any reply but a 200 with a call id as transient and releases the claim, CadPreparer shows "SolidWorks preview isn't available right now.", and it heals on the next open after the worker deploy.
3. Merge to main and push. **This also changes the parts-panel labels of every existing model, in every format** (`Body_1` becomes `Body 1`; cosmetic, identity is by key). It is code, so the env rollback below does not undo it; only a code change would.
4. Upload one real assembly to a throwaway package. Confirm it converts, stands upright, measures in millimetres and lists named parts. **Also open the largest real assembly (Dingo, 1,735 bodies, 108.3 MiB GLB) on a real-GPU machine before announcing assemblies.** Known risks: GLBs are not counted by the usage meters, so an assembly can add up to 150 MiB uncounted; and every re-open downloads the full GLB again (model-load caching is not built).
5. **Rollback:**
   1. Remove `sldasm` from `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` and redeploy without the build cache. Never `git revert`.
   2. Only if the worker itself is at fault, redeploy the previous multi-format worker from a throwaway worktree at `a1b788e`: `git worktree add /tmp/stiko-worker-rollback a1b788e && /tmp/stiko-cadw/bin/modal deploy /tmp/stiko-worker-rollback/cad-worker/app.py && git worktree remove /tmp/stiko-worker-rollback`. Do this only after step 1: rolling the worker back while the env still lists `sldasm` makes those files unavailable (422).

## Out of scope

- Using parts uploaded beside the assembly, and Pack and Go zips.
- `.iam`, `.catproduct`, NX/Creo `.asm`.
- A nested component tree in the parts panel.
- Renaming bodies in GLBs that were already converted.
