# More native CAD formats through the CAD worker — design

**Date:** 2026-11-19
**Status:** Approved in conversation.
**Builds on:** `docs/superpowers/specs/2026-10-18-sldprt-conversion-design.md` (live since 2026-10-19). Everything that spec says about claims, the callback, the cap, the worker image and the viewer still holds. This spec only describes what changes.

## Real-file test (2026-11-19)

31 real public files went through the real converter on a temporary Modal T4 app (`modal run`, the production worker untouched): 20 files in the main smoke run, then 11 in two targeted runs (the same NIST parts across CAD systems, and the same MTC parts across SLDPRT, NX and ACIS). All 31 converted, none failed. Cold start was not measured: the Convert s column is the worker's convert time per file, and the 20-file main run took about 3 minutes of wall clock. Scale is the GLB's sorted bounding box against NIST's own STEP export of the same part, within 1% counting as OK. The Upright column records bounding-box and material evidence only; nothing was looked at on screen, so every verdict is provisional until the Task 6 on-screen check.

| Format | Files | Converted | Convert s | GLB size | Scale vs STEP | Upright, colours | Verdict |
|---|---|---|---|---|---|---|---|
| .ipt | 4 (Inventor 2021) | 4/4 | 4.0-4.7 | 47-221 KB | OK 4/4, worst 0.35% | 1-3 bodies, one default grey (0.75); axes differ from the STEP frame on 2 of 4 files (ctc_02 swaps X and Y, ftc_08 swaps Y and Z); the worker keeps them as the file has them | ship, pending Task 6 on-screen check |
| .catpart | 5 (V5R2019) | 5/5 | 4.2-5.4 | 55-363 KB | OK 5/5, worst 0.46% | 1 body, one light blue (0.82/0.82/1.0); before Task 2b the axes equalled the STEP frame on 5 of 5, and the worker now stands the part up (see below) | ship, pending Task 6 on-screen check |
| .prt (NX) | 6 (NX 1957 x1, NX 1953/1957 x2, NX 1980 x2, NX 2027 x1, read from the version strings in the file headers) | 6/6 | 3.9-6.0 | 39-156 KB | OK 2/2 against STEP; the 2 MTC parts tried (cover, polycarb) have the same extents as the SLDPRT of the same part, the cover with the same centre, the polycarb with the Z centre's sign flipped (41,34,-2 against 41,34,2) | 1 body, grey-blue or default grey; before Task 2b the axes equalled the STEP frame on 1 of 2, and the worker now stands the part up (see below) | ship, pending Task 6 on-screen check |
| .prt.n (Creo) | 5 (Creo 4, 10) | 5/5 | 4.0-4.8 | 55-380 KB | OK 5/5, worst 0.46% | 1 body; default grey or tinted; keeps its axes, which equal the STEP frame on 4 of 5 (ftc_06 swaps X and Z; so does ftc_09 on the Creo 10 file, checked in Task 2b) | ship, pending Task 6 on-screen check |
| .x_t | 2 | 2/2 | 4.4-4.6 | 5-128 KB | no reference file, scale plausible only (LONGBAR 2000 x 2000 x 20000 mm, Maslow_Frame 548 x 3157 x 1976 mm) | 4 and 24 bodies, default grey | ship, pending Task 6 on-screen check |
| .x_b | 1 | 1/1 | 4.5 | 1.4 MB | no reference file, scale plausible only (297 x 102 x 91 mm, plausible for a foot part) | 23 bodies, 5 materials, 2 coloured | ship, pending Task 6 on-screen check |
| .jt | 1 | 1/1 | 8.5 | 14.8 MB (9 times the 1.6 MB source, 494k triangles; watch the size) | no STEP; 152.4 x 101.6 x 107.7 mm is the 6 x 4 inch MTC assembly | 36 bodies, 3 materials, 1 coloured | ship, pending Task 6 on-screen check |
| .sat | 1 | 1/1 | 4.0 | 163 KB | equals the SLDPRT and NX versions of the same part (152.4 x 101.6 x 25.0, same centre) | 1 body, pale grey | ship, pending Task 6 on-screen check |
| .sldprt (control) | 6 | 6/6 | 4.2-5.1 | 21-907 KB | OK 3/3 against STEP | the live format; axes equal the STEP frame on 3 of 3 | ship (already live), pending Task 6 on-screen check |

Passed so far (input to Task 7): sldprt, ipt, catpart, prt, x_t, x_b, jt, sat — each still subject to the Task 6 on-screen check.

**Task 6 on-screen check (2026-11-19): all eight render in the real viewer with no errors**, so all eight ship. The NIST ftc_09 plate stands on its edge for CATIA and NX once stood up, and lies flat for Creo and for the raw CATIA output. That is expected: NIST drew its parts with Y-up-style coordinates in every system, so a Z-up app (and now Stiko) shows this plate standing. A real customer CATIA or NX file is the release check for the orientation decision.

- **Creo's version suffix works as is.** `.prt.1` and `.prt.8` converted with the suffix kept, so `input_suffix` needs no change and Step 2's fallback was not needed.
- **Orientation: what the files showed, and what settled it.** `usd-convert-cad` keeps each file's own axes; asking for a Y-up stage does not rotate anything. NIST built the same coordinates across the CAD systems, so its files cannot show any one app's idea of "up", and reading the STEP frame as Z-up is an assumption. Against that frame (unsorted bounding-box extents only), the axes matched on SolidWorks 3 of 3, CATIA 5 of 5, Creo 4 of 5, NX 1 of 2 and Inventor 2 of 4, and the ACIS cover equals the SolidWorks cover. Inventor's two differences are a swap of X and Y on ctc_02 and a swap of Y and Z on ftc_08, so its Z axis moved on 1 of 4 files only. The check "a part tall along Z in STEP ends up tall along Y" could be run on ftc_09 alone, the only part whose STEP is tallest along Z, and the CATIA file failed it (still tall along Z). That is all the NIST evidence shows. Orientation was then settled by the user's decision on each app's own convention (Task 2b, below), not by this evidence.
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
  - **`list` set and not blank:** `'off'` means none. Otherwise split on commas, semicolons, pipes and whitespace (`/[\s,;|]+/`, because the variable is typed by hand: `sldprt; ipt` and `sldprt ipt` both work), lowercase, keep only own keys of `CAD_CONVERSION_FORMATS` and drop duplicates. Unknown names among known ones are ignored.
  - **A list naming no known format** (`solidworks`, a typo): `console.warn` one line naming the value, then fall back to the legacy SolidWorks switch exactly as for an unset list. A typo must neither switch every conversion off nor surprise anyone by turning something on.
  - **`list` unset or blank:** today's behaviour. That is `['sldprt']` when `sldprtConversionEnabled(legacy)`, otherwise none.
  - **The new variable:** `NEXT_PUBLIC_CAD_CONVERSION_FORMATS`.
  - **The legacy variable:** `NEXT_PUBLIC_SLDPRT_CONVERSION`, read only as the fallback (unset, blank, or no known format in the list). Once the new variable names a known format or is `off`, the legacy one is ignored. It can be removed once the new variable is set in production.
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
- **Who it affects:** everything that goes through `extensionOf`, including support checks, advice, analytics, units and the file chips. The chips are `getFileChip` in `lib/fileChips.ts`, `fileChip` in `lib/design.ts` and the portal file list's icon (`components/portal/FileList.tsx`); a Creo version file is labelled PRT, not by its version number. Each of the three keeps its old reading, the last dot-segment, for a name `extensionOf` finds no extension in (`README`, `.DS_Store`), so no other label changes. That is intended: a Creo version file *is* a `.prt`.
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
- **What stays the same:** the converter command and the 200 MB input cap. `usd_to_glb.py` gains `--stand-up` and `worker_core` gains `stands_up` (section 6). A converted GLB over 150 MB (`MAX_OUTPUT_BYTES`) is refused with a `too_large_output` verdict and not uploaded: the 200 MB audit showed a model that large freezes the viewer, and GLBs are not counted by the usage meters.
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
- **`lib/fileChips.ts`:** enabled formats are in `MODEL_FORMATS` and get the model chip. The only change is that it reads the extension through `extensionOf` (section 2), as `lib/design.ts` and the portal file list do, so a Creo `name.prt.5` is labelled PRT.
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
   - orientation, per the rule in section 6;
   - colours;
   - **millimetre scale**, checked by comparing each NIST part's bounding box with the NIST STEP export of the same part opened through Stiko's existing STEP path.

   **A format that fails or comes out wrong is dropped from the table and the switch list, not shipped.** The results go into this spec, as the SolidWorks spec did.
2. **`node --test`:**
   - `enabledCadFormats` covering unset, blank, `off`, a list, unknown names, case and spaces, comma, semicolon, pipe and whitespace separators, a list of only unknown names (warns, then the legacy fallback both ways), and the legacy fallback both ways;
   - a child-process test (`scripts/tests/sldprtSwitchOff.test.mjs`) that sets the real variables: a one-format list, `off`, the new switch winning over the legacy one, and a switched-off format still opening once converted;
   - `formatTables` for every format, including the disjointness test;
   - `extensionOf` for `.prt.<n>`, `.asm.<n>`, `.drw.<n>`, a bare `.5`, and a dotted folder;
   - `isCadFilename`, `cadFormatEnabled`, `cadLabel`;
   - `assumedMmPerUnit` for every format.
3. **Route tests on the PGlite harness:** `convert-cad` refuses a non-CAD file (400), answers 503 `disabled` for a known but switched-off format, and starts a job for an enabled non-SolidWorks format. The existing claim, cap and callback scenarios re-run.
4. **Worker pytest:** `input_suffix` for each format and for `.prt.<n>`; `validate_job` refusing an unknown extension; `process_job` naming the input with the right suffix; a GLB over the output cap reported as `too_large_output` and never uploaded. The existing tests re-run.
5. **Browser:** the local harness serves one converted GLB per new format through `CadPreparer` and the viewer. The state texts are checked for two formats with stubbed status responses. There are no uploads, because local dev uses the production database and R2.
6. **Gates:** `tsc`, lint, all node tests, `next build`, pytest.

## Release

Production is the only environment. No migration.

1. Deploy `cad-worker/` to Modal. It accepts more extensions; SolidWorks behaviour is unchanged.
2. On stiko (Production), set `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` to `sldprt,ipt,catpart,prt,x_t,x_b,jt,sat`. All eight passed the real-file test and the Task 6 on-screen check.
3. Merge to main with a merge commit and push. Main auto-deploys.
4. On production, upload one real file per new format to a throwaway package. Confirm each one converts, stands upright and measures in millimetres.
5. **Rollback of one format:** remove it from `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` and redeploy.
   **Rollback of everything new:** set the variable to `sldprt`.
   **Never `git revert`:** converted files would then show as unsupported.
   - **Roll back with the env first.** Removing a format from the worker while the app still enables it leaves those files permanently "unavailable".
   - **Worker rollback**, only if the worker itself breaks SolidWorks: `git checkout 4019050 -- cad-worker && modal deploy cad-worker/app.py`.
   - **Redeploy without the build cache** after changing any `NEXT_PUBLIC_` variable: the values are inlined into the browser bundle at build time, and a cached build can keep the old one.

## Out of scope

- Assemblies and zip uploads (Release B).
- Revit, IFC and Solid Edge.
- Multi-file NX assemblies (which are also `.prt`) and shattered JT (a JT that references other files). They are not supported; they will most likely fail with "no visible mesh" and show the export advice.
- A per-format monthly cap.
- A custom file picker for Creo's `.prt.<n>`.
- Telling NX `.prt` from Creo `.prt` in the UI. Both show as "NX or Creo part".
