# More native CAD formats through the CAD worker — design

**Date:** 2026-11-19
**Status:** Approved in conversation.
**Builds on:** `docs/superpowers/specs/2026-10-18-sldprt-conversion-design.md` (live since 2026-10-19). Everything that spec says about claims, the callback, the cap, the worker image and the viewer still holds. This spec only describes what changes.

## Real-file test (2026-11-19)

31 real public files went through the real converter on a temporary Modal T4 app (`modal run`, the production worker untouched): 20 files in the main smoke run, then 11 in two targeted runs (the same NIST parts across CAD systems, and the same MTC parts across SLDPRT, NX and ACIS). All 31 converted, none failed. "s" is the worker's convert time per file, cold start not included. Scale is the GLB's sorted bounding box against NIST's own STEP export of the same part, within 1% counting as OK.

| Format | Files | Converted | Convert s | GLB size | Scale vs STEP | Upright, colours | Verdict |
|---|---|---|---|---|---|---|---|
| .ipt | 4 (Inventor 2021) | 4/4 | 4.0-4.7 | 47-221 KB | OK 4/4, worst 0.35% | 1-3 bodies, one default grey (0.75); frame differs from the STEP frame on 2 of 4, Inventor is Y-up natively; visual check in Task 6 | ship |
| .catpart | 5 (V5R2019) | 5/5 | 4.2-5.4 | 55-363 KB | OK 5/5, worst 0.46% | 1 body, one light blue (0.82/0.82/1.0); frame equals the Z-up STEP frame, never rotated to Y-up; visual check in Task 6 | ship, orientation open |
| .prt (NX) | 6 (NX 1980, 2027) | 6/6 | 3.9-6.0 | 39-156 KB | OK 2/2 against STEP; the 2 MTC parts tried (cover, polycarb) equal the SLDPRT of the same part | 1 body, grey-blue or default grey; same frame behaviour as CATIA; visual check in Task 6 | ship, orientation open |
| .prt.n (Creo) | 5 (Creo 4, 10) | 5/5 | 4.0-4.8 | 55-380 KB | OK 5/5, worst 0.46% | 1 body; default grey or tinted; same frame behaviour as CATIA; visual check in Task 6 | ship, orientation open |
| .x_t | 2 | 2/2 | 4.4-4.6 | 5-128 KB | no reference file; metres honoured (LONGBAR stores 2 and 20, GLB 2000 x 2000 x 20000 mm) | 4 and 24 bodies, default grey; visual check in Task 6 | ship, scale plausible only |
| .x_b | 1 | 1/1 | 4.5 | 1.4 MB | no reference file; 297 x 102 x 91 mm, plausible for a foot part | 23 bodies, 5 materials, 2 coloured; visual check in Task 6 | ship, scale plausible only |
| .jt | 1 | 1/1 | 8.5 | 14.8 MB | no STEP; 152.4 x 101.6 x 107.7 mm is the 6 x 4 inch MTC assembly | 36 bodies, 3 materials, 1 coloured; 494k triangles from a 1.6 MB file | ship, watch GLB size |
| .sat | 1 | 1/1 | 4.0 | 163 KB | equals the SLDPRT and NX versions of the same part (152.4 x 101.6 x 25.0, same centre) | 1 body, pale grey; visual check in Task 6 | ship |
| .sldprt (control) | 6 | 6/6 | 4.2-5.1 | 21-907 KB | OK 3/3 against STEP | the live format; same frames as CATIA, NX and Creo | live |

- **Creo's version suffix works as is.** `.prt.5` and `.prt.8` converted with the suffix kept, so `input_suffix` needs no change and Step 2's fallback was not needed.
- **Orientation is the open question, and it is not the same for every format.** The worker asks for a Y-up stage, but the converted geometry keeps the source file's own axes. NIST's STEP frame (Z-up) comes through axis for axis in most comparisons: SolidWorks 3 of 3, CATIA 5 of 5, Creo 4 of 5, NX 1 of 2, Inventor 2 of 4, and the ACIS cover equals the SolidWorks cover. The CATIA plate `ftc_09`, tall along Z in STEP, is still tall along Z in the GLB, which fails the check that Z-up parts should end up tall along Y. The evidence is bounding-box extents only. A part drawn upright in a Z-up system will therefore probably lie on its back in the viewer. Inventor and SolidWorks are Y-up natively, and the Inventor files do move to a Y-up frame (`ftc_08` is thin along Y). Task 6 must look at these on screen before any Z-up format is switched on; a fix would be a -90 degrees about X in the worker for those formats, which is only free to choose while no production pins exist for them.
- Inventor and CATIA files came out in one default colour each; the NIST files may simply carry no authored colours.
- Only Inventor 2021 and CATIA V5R2019 files were sampled; the 2024 and R2023 files in the sample folder were not.

Orientation was then settled by the user: CATIA and NX are stood upright (Task 2b); re-checked on ftc_09 — see the plan's Task 2b.

## Goal

People can upload native part files from six more CAD systems and review them in the 3D viewer without exporting STEP first. Each file converts once to a GLB on the existing NVIDIA worker, exactly as SolidWorks parts already do.

| Extension | App | Shown as |
|---|---|---|
| `.ipt` | Inventor | Inventor part |
| `.catpart` | CATIA | CATIA part |
| `.prt`, plus Creo's `.prt.<n>` | NX or Creo | NX or Creo part |
| `.x_t`, `.x_b` | Parasolid | Parasolid model |
| `.jt` | JT | JT model |
| `.sat` | ACIS | ACIS model |

## Decisions already made

- **Scope, the user's choice:** single-file engineering CAD only.
  - **Out:** Revit (`.rvt`/`.rfa`) and IFC. The user said "just the 3d files"; both keep their export advice.
  - **Out:** Solid Edge (`.par`/`.psm`). No public sample file exists to test with.
  - **Out:** assemblies (`.sldasm`, `.iam`, `.catproduct`, `.asm`). Those need multi-file (zip) uploads and are Release B.
- **Converter:** the same `usd-convert-cad` 0.3.0 worker on Modal. Its README lists every format above as supported input on Linux x86_64.
- **Shape (Approach A):** one table of converted formats replaces the SolidWorks-only checks. Rejected alternatives:
  - one switch for all formats, which can't turn off a single vendor's format;
  - a copy of the SolidWorks code per format.
- **Budget:** one shared monthly cap for every format, still read from `SLDPRT_MONTHLY_CAP` (default 300). The name is kept so production config needs no change. Its comment says it covers all formats.
- **Licence:** NVIDIA's README says "proprietary CAD formats can require CAD converter licensing". That open question now covers six more vendors. The per-format switch below is the off-ramp, format by format.

## Sample files

Public test files are in `~/Desktop/stiko-cad-samples/` on the user's Mac, sorted by format. Sources and licences are in its `SOURCES.md`.
- **NIST MBE PMI test models** ("can be used without any restrictions"):
  - 16 `.ipt` (Inventor 2021 and 2024);
  - 20 `.CATPart` (V5-6R2019 and R2023);
  - 26 NX `.prt` (NX 1980 and 2027);
  - 28 Creo `.prt.<n>` (Creo 4 and 10);
  - 1 `.jt` and 1 `.sat`.
  - The same zips hold STEP exports of the same parts, for geometry comparison.
- **Parasolid** (from public GitHub repos): two `.x_t` and one `.x_b`.

Facts observed in these files that shape the design:
- **Creo saves versions as `name.prt.<n>`** (`nist_ctc_01_asme1_rd_cr10030.prt.5`).
- **NX and Creo share `.prt` but differ in content:** NX files start with the bytes `SPLMSSTR`, Creo files with `#UGC`.

## Design

### 1. The format table and the switch: `lib/fileFormats.ts`

- **`CAD_CONVERSION_FORMATS`:** a frozen table keyed by extension. Each entry holds:
  - `app`, e.g. `'Inventor'`;
  - `noun`, `'part'` or `'model'`;
  - `advice`, the existing export advice, used when the format is switched off or a conversion fails.

  Its keys are `sldprt`, `ipt`, `catpart`, `prt`, `x_t`, `x_b`, `jt` and `sat`. SolidWorks moves into this table, and `SLDPRT_ADVICE` goes away.
- **`enabledCadFormats(list, legacy)`** is pure, with its arguments defaulted from the two literal `process.env.NEXT_PUBLIC_…` expressions so Next inlines them.
  - **`list` set and not blank:** `'off'` means none. Otherwise split on commas, trim, lowercase, and keep only keys of `CAD_CONVERSION_FORMATS`. Unknown names are ignored.
  - **`list` unset or blank:** today's behaviour. That is `['sldprt']` when `sldprtConversionEnabled(legacy)`, otherwise none.
  - **The new variable:** `NEXT_PUBLIC_CAD_CONVERSION_FORMATS`.
  - **The legacy variable:** `NEXT_PUBLIC_SLDPRT_CONVERSION`, read only as the fallback. It can be removed once the new variable is set in production.
- **`formatTables(enabled)`** now takes the enabled list.
  - Each enabled format joins the model list and leaves the advice table.
  - Each disabled one stays in, or is added to, the advice table with its `advice`.
  - The test that `SUPPORTED_EXTENSIONS` and `NATIVE_CAD_ADVICE` are disjoint still holds.
- **The `prt` advice text** in `ADVICE_BASE` (`'NX / Creo / Solid Edge'`) stays, for when `prt` is disabled. `par` and `psm` stay in `ADVICE_BASE`.
- **`sldprtConversionEnabled`** stays, used only by `enabledCadFormats`. Its callers (`lib/useUpload.ts`, the convert route) switch to `cadFormatEnabled(filename)`.

### 2. Creo version suffixes: `extensionOf`

- **The rule:** `extensionOf` returns the previous extension when the last one is all digits and the previous one is `prt`, `asm` or `drw`.
  - `part.prt.5` → `prt`;
  - `top.asm.3` → `asm`, which keeps its advice;
  - `notes.5` → `5`, which stays unsupported.
- **Who it affects:** everything that goes through `extensionOf`, including support checks, advice, file chips, analytics and units. That is intended: a Creo version file *is* a `.prt`.
- **The file picker can't pre-filter these.** The `accept` attribute matches only the final extension, so `.prt.5` is greyed out in the picker on some systems. Drag and drop goes through `extensionOf`, so it works. Creo runs only on Windows, where the picker's "All files" option shows the file. This limitation is accepted. No UI copy mentions it, and it isn't worth a custom picker.

### 3. Shared helpers: `lib/cadConversion.ts`

- **`isSldprtFilename` becomes `isCadFilename(filename)`,** true for any key of `CAD_CONVERSION_FORMATS`, enabled or not.
  - `isPendingCad` and `opensAsModel` use it unchanged in shape.
  - **Why enabled or not:** a file converted before its format was switched off still opens through its GLB. One that never converted shows the "turned off" state.
- **`cadFormatEnabled(filename)`** is the switch check, used by the upload trigger and the start route.
- **`cadLabel(filename)`** returns `{app, noun, advice}` from the table, for the viewer and portal copy.
- The claim, stale, attempt, cap, callback and poll rules don't change.

### 4. Routes

- **`app/api/files/[id]/convert-cad/route.ts`:**
  - 400 when the file is not `isCadFilename`;
  - 503 `{reason: 'disabled'}` when the file's format isn't in `enabledCadFormats()`.
  - Everything else is unchanged. The job body already carries `filename`, which is how the worker learns the format.
- **`app/api/conversions/cad-callback/route.ts`:** only log wording changes ("CAD conversion…" instead of "SolidWorks…").
- **`app/api/files/complete/route.ts`:** no change. It already goes through `isPendingCad`.
- **`lib/storageKeys.ts`:** no change. `cadGlbKey` is already `<original key>.glb`; only its comment changes.

### 5. Worker: `cad-worker/`

- **`worker_core.py` gains `CAD_EXTENSIONS`,** the same eight keys as the app's table.
  - **`input_suffix(filename)`** returns the lowercased suffix to give the downloaded file. That is `.prt.5` for a Creo version file, otherwise `.<ext>`. It returns `None` when the format isn't convertible.
  - `validate_job` refuses with 422 when `input_suffix` is `None`, instead of when the name doesn't end in `.sldprt`.
  - `process_job` saves the download as `input<suffix>`, so HOOPS sees the real extension.
- **What stays the same:** the converter command, `usd_to_glb.py` and the 200 MB cap.
- **The worker's list is a superset of the app's switch.** The app decides what is sent, and the worker refuses anything it doesn't know.
- **The local `smoke` entrypoint** takes every file whose `input_suffix` isn't `None`, instead of only `.sldprt`, and walks the sample folder recursively.
- **README:** the supported list and the licence note gain the new formats.

### 6. Viewer, portal and units

- **`components/viewers/CadPreparer.tsx`:** the state texts use `cadLabel`, for example:

  | State | Text |
  |---|---|
  | converting | "Converting Inventor part…" + "The first one after a quiet spell can take a couple of minutes." |
  | failed | "Couldn't convert this CATIA part." + the format's `advice` |
  | deferred | "Preview available from <date>." + the format's `advice` |
  | disabled | "JT preview is turned off." + the format's `advice` |
  | unavailable | "Parasolid preview isn't available right now." + "Try again in a few minutes." + the format's `advice` |

  SolidWorks goes through the same template, so its texts change slightly to match. For example, "Save As STEP in SolidWorks and upload that." becomes its table advice, "Save As STEP, then upload."
- **`app/portal/[id]/page.tsx`:** `'Preparing SolidWorks part…'` becomes ``Preparing ${app} ${noun}…``. The branches already use `isPendingCad` and `opensAsModel`.
- **`lib/measure/calibration.ts`:** `assumedMmPerUnit` returns 1 for every key of `CAD_CONVERSION_FORMATS`, because the worker writes millimetres whatever unit the part was drawn in. The `sldprt` case becomes a table check.
- **`lib/fileChips.ts`:** no change. Enabled formats are in `MODEL_FORMATS` and get the model chip.
- **Orientation (user decision, 2026-11-19):** `usd-convert-cad` keeps each file's own axes. CATIA (`.catpart`) and NX `.prt` treat Z as up, so the worker turns those parts -90° about X (`usd_to_glb.py --stand-up`, chosen by `worker_core.stands_up`, which tells NX from Creo by the `SPLMSSTR` header). Every other format keeps its axes: SolidWorks, Inventor and Creo are Y-up already, and Parasolid, JT and ACIS have no fixed convention. Once production pins exist on a format, its orientation can never change.

## Failure table

The failure table in the SolidWorks spec applies to every format unchanged. One row is new:

| Situation | Row becomes | User sees | Retried? |
|---|---|---|---|
| A format removed from the switch after upload, with no GLB yet | unchanged | "<App> preview is turned off." + the advice | When switched back on |

## Testing

1. **Real-file test first, before any app code.** Run the widened `smoke` entrypoint on Modal over `~/Desktop/stiko-cad-samples/` for every format: at least 3 files per format where 3 exist, including NX and Creo `.prt`. For each format, record:
   - conversion success;
   - cold and warm time;
   - GLB size;
   - Y-up orientation;
   - colours;
   - **millimetre scale**, checked by comparing each NIST part's bounding box with the NIST STEP export of the same part opened through Stiko's existing STEP path.

   **A format that fails or comes out wrong is dropped from the table and the switch list, not shipped.** The results go into this spec, as the SolidWorks spec did.
2. **`node --test`:**
   - `enabledCadFormats` covering unset, blank, `off`, a list, unknown names, case and spaces, and the legacy fallback both ways;
   - `formatTables` for every format, including the disjointness test;
   - `extensionOf` for `.prt.<n>`, `.asm.<n>`, `.drw.<n>`, a bare `.5`, and a dotted folder;
   - `isCadFilename`, `cadFormatEnabled`, `cadLabel`;
   - `assumedMmPerUnit` for every format.
3. **Route tests on the PGlite harness:** `convert-cad` refuses a non-CAD file (400), answers 503 `disabled` for a known but switched-off format, and starts a job for an enabled non-SolidWorks format. The existing claim, cap and callback scenarios re-run.
4. **Worker pytest:** `input_suffix` for each format and for `.prt.<n>`; `validate_job` refusing an unknown extension; `process_job` naming the input with the right suffix. The existing tests re-run.
5. **Browser:** the local harness serves one converted GLB per new format through `CadPreparer` and the viewer. The state texts are checked for two formats with stubbed status responses. There are no uploads, because local dev uses the production database and R2.
6. **Gates:** `tsc`, lint, all node tests, `next build`, pytest.

## Release

Production is the only environment. No migration.

1. Deploy `cad-worker/` to Modal. It accepts more extensions; SolidWorks behaviour is unchanged.
2. On stiko (Production), set `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` to the formats that passed the real-file test, for example `sldprt,ipt,catpart,prt,x_t,x_b,jt,sat`.
3. Merge to main with a merge commit and push. Main auto-deploys.
4. On production, upload one real file per new format to a throwaway package. Confirm each one converts, stands upright and measures in millimetres.
5. **Rollback of one format:** remove it from `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` and redeploy.
   **Rollback of everything new:** set the variable to `sldprt`.
   **Never `git revert`:** converted files would then show as unsupported.

## Out of scope

- Assemblies and zip uploads (Release B).
- Revit, IFC and Solid Edge.
- A per-format monthly cap.
- A custom file picker for Creo's `.prt.<n>`.
- Telling NX `.prt` from Creo `.prt` in the UI. Both show as "NX or Creo part".
