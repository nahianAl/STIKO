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

## Decisions already made

- **The assembly file alone (the user's choice).** There is no zip or folder handling. Parts uploaded beside an assembly are not used by it; each still converts as its own `.sldprt` file, as today. Using sibling parts for full-quality geometry is a later option if anyone notices the coarser mesh.
- **Real names in the parts panel (the user's choice)**, for every format, for files converted from now on.
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
- **`--convert-metadata`:** if the real-file test shows `displayName` needs it, `run_converter` adds `--convert-metadata` for every format.
- **Body names: `usd_to_glb.py`.** Each glTF node is named after the nearest enclosing prim, the mesh itself included, that has authored `displayName` metadata.
  - **Clean-up:** trim, collapse runs of whitespace to one space, and cut to 120 characters.
  - **No name:** use `Body N`, the current behaviour.
  - **Duplicates:** when two or more nodes would get the same name (one component with several meshes), the second and later get ` (2)`, ` (3)`, and so on.
  - **Instance proxies:** the walk goes up through instance proxies, the same way meshes are already found.
  - The `extras.stikoPart = true` marker is unchanged.
- **README:** the supported list gains `.sldasm`, with one sentence on the display-copy behaviour.

### 3. Viewer and portal

There is no new code beyond the noun. The parts panel shows names from the GLB. Sub-assemblies come out as a flat list of components, because `usd_to_glb.py` writes one node per mesh. A nested tree is out of scope.

## Failure table

The table in the 2026-10-18 spec applies unchanged. New in practice:

| Situation | Row becomes | User sees |
|---|---|---|
| Assembly saved without its display copy (no visible mesh) | `failed` | "Couldn't convert this SolidWorks assembly." + "Save As STEP, then upload." |
| Assembly larger than 200 MB, or GLB over 150 MB | `failed` | same |

## Testing

1. **Real-file test first, before app code.** Use the worker's `smoke` entrypoint, with `sldasm` added to `CAD_EXTENSIONS`, on:
   - the NIST assembly alone;
   - any other public `.sldasm` with a licence that permits testing (search GitHub, MIT, Apache, CC0 or CERN-OHL repos; 2–4 files from different SolidWorks years if they exist).

   For each, record:
   - bodies and triangles;
   - GLB size;
   - extent against the NIST STEP export of the assembly (`nist_mtc` has no STEP; compare against the sum of its parts' placement or the all-parts spike extent, 152.4 × 101.6 × 107.7 mm);
   - names in the GLB, with and without `--convert-metadata`;
   - an on-screen look in the real viewer.

   An assembly that comes out empty is recorded as such; it shows that the failure path works.
2. **`node --test`:** the table test lists `sldasm`; `cadLabel('a.sldasm')`; `cadPreparingLabel('a.sldasm')` is "Preparing SolidWorks assembly…"; `assumedMmPerUnit('a.sldasm')` is 1; and `formatTables` disjointness still holds.
3. **Worker pytest:**
   - `input_suffix` for `.sldasm`;
   - `stands_up` False for it;
   - naming in `usd_to_glb.py` on hand-built stages: a `displayName` on the parent Xform, on the mesh itself, none (gives `Body N`), duplicates (gives ` (2)`), whitespace and the 120-character cut, and through an instanceable prim.
4. **Browser:** the real `ViewerContainer` with the converted NIST assembly GLB. The parts panel lists the real names. CadPreparer shows "Converting SolidWorks assembly…" with stubbed status. No uploads.
5. **Gates:** `tsc`, lint, all node tests, pytest, and `next build` with `sldasm` in the switch list, confirming it is inlined.

## Release

Production is the only environment. No migration.

1. Deploy `cad-worker/` to Modal. This is backward compatible, but **every format's newly converted files get real body names from this point.**
2. On Vercel (Production), add `sldasm` to `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` (`sldprt,sldasm,ipt,x_t,x_b,jt,sat`).
3. Merge to main and push.
4. Upload one real assembly to a throwaway package. Confirm it converts, stands upright, measures in millimetres and lists named parts.
5. **Rollback:** remove `sldasm` from the variable and redeploy without the build cache. Never `git revert`.

## Out of scope

- Using parts uploaded beside the assembly, and Pack and Go zips.
- `.iam`, `.catproduct`, NX/Creo `.asm`.
- A nested component tree in the parts panel.
- Renaming bodies in GLBs that were already converted.
