# DWG and DXF shown as PDF — design

**Date:** 2026-10-15
**Status:** Approved in conversation; spec for review
**Revised:** 2026-10-17 (final-review fix wave). The converter is its own Vercel project, built
from `converter/` in this repo, and that folder is licensed AGPL-3.0-or-later. It parses each
drawing in a child process with no secrets and with resource limits. The Next route calls it at
`CAD_CONVERTER_URL`. Sections 1, 2, 3, 6, the failure table, testing and release below reflect
this.

## Goal

Let reviewers open DWG and DXF files in Stiko by converting each one to a PDF and showing it in
the existing PDF viewer. Markup, comments, pages and measuring all work with no new 2D viewer.
Running cost stays at $0 and drawings never leave Stiko's own Vercel and R2.

## Decisions already made

- **Converter:** LibreDWG (`dwg2dxf`) turns DWG into DXF; ezdxf's drawing add-on renders DXF to
  PDF through PyMuPDF.
  - Spiked 2026-10-15 on Autodesk's own sample sheets (DWG 2007 and 2010). They render as
    recognisable plots with title blocks, sections and tables.
  - **Measured:** about 2 s per sheet once hatch patterns are capped. Uncapped, one hatch
    expanded to about 3.5M line segments and took 9 minutes.
- **Where it runs:** a Python function in a **second Vercel project** (`stiko-converter`) on the
  same Vercel account, built from this repo with Root Directory `converter/`. There is no new
  account or bill. It is separate from the stiko project because Vercel gives every function in a
  project all of that project's env vars (the production DB owner password, R2 keys…), and
  LibreDWG parses untrusted uploads. The converter project's only env var is
  `CAD_CONVERTER_SECRET`. (The first version put it inside the stiko project.) Rejected
  alternatives:
  - a Fly.io service (new account)
  - CloudConvert (third party, and its output is untested)
- **Licence:** `converter/` is AGPL-3.0-or-later, because PyMuPDF is AGPL. The rest of the
  repo is unchanged. The LibreDWG binary stays GPL-3.0-or-later, with its NOTICE and the full
  licence text in COPYING.
- **Look:** black lines on white, like a standard plotted sheet. Colour is out of scope.
- **Budget:** $0. Conversions run inside the existing Vercel plan.

## Design

### 1. The converter: `converter/api/convert_drawing.py`

A Vercel Python serverless function at `/api/convert_drawing` of its own Vercel project, whose
Root Directory is `converter/`. The stiko project does not serve it.

- **Input:** `POST` with JSON `{ "sourceUrl": str, "targetUrl": str, "filename": str }` and
  header `X-Converter-Secret`. The two URLs are presigned by the Next route, one GET and one
  PUT. The function holds no storage credentials and needs no boto3. (Changed from the first
  draft, which used `sourceKey`/`targetKey` and the `R2_*` credentials.)
- **Auth:** a constant-time comparison of that header with env var `CAD_CONVERTER_SECRET`; any
  mismatch returns 401. There is no user session here. Only Stiko's Next server calls it.
- **Steps:**
  0. **Isolation:** steps 2–6 run in a child process: `python _lib/drawing_pdf.py <source>
     <out.pdf> <dwg2dxf>`. The child's environment is only `PYTHONPATH`, `PATH=/usr/bin:/bin`,
     `HOME`/`XDG_CACHE_HOME` (a scratch directory) and `LANG=C.UTF-8`. It never gets the
     secret. Its limits are `RLIMIT_CPU` 50 s and `RLIMIT_AS` 2 GiB (Linux), with a 45 s
     wall-clock timeout.
     - Exit 0 prints the page count.
     - Exit 2, a timeout, or death by a signal is a verdict on the drawing, so the reply is 422.
     - Any other exit is a server fault, so the reply is 500.
  1. Download `sourceUrl` into `/tmp`. Reject anything over 50 MB.
  2. For `.dwg`, run the bundled `api/_bin/dwg2dxf -y -o out.dxf in.dwg` with a 30 s timeout and
     only `PATH` in its environment. If it dies by a signal, the drawing fails even if it
     wrote a DXF.
  3. Load with `ezdxf.recover.readfile`.
  4. **Pages:** every paper-space layout that has content, in tab order. A layout counts if it
     has any entity other than its own overall viewport. A sheet that still renders nothing
     is skipped. Autodesk's civil sample has a sheet whose only viewport renders empty after
     DWG → DXF. If no sheet renders, use model space.
  5. **Page size:** the layout's plot paper size in mm when the file defines a positive one;
     otherwise A3 landscape (420 × 297 mm). Margins 10 mm. Content is fitted to the page.
  6. **Render settings:** `Configuration(background_policy=WHITE, color_policy=BLACK,
     min_hatch_line_distance=0.5, hatching_timeout=10)`.
  7. Merge the pages into one PDF and PUT it to `targetUrl` with
     `Content-Type: application/pdf`.
- **Output:** `200 { "pages": n }`; `422` for an unreadable, empty, too-slow or too-big drawing;
  `400`, `401`, `413`, `502` or `500` otherwise. Error bodies are fixed strings.
- **Packaging (all under `converter/`):**
  - `requirements.txt` pins every package exactly, transitive dependencies included.
  - `vercel.json` sets the function's `maxDuration: 60` and
    `includeFiles: "api/{_lib,_bin}/**"`.
  - `LICENSE` is AGPL-3.0, and each Python file carries an SPDX header.
- **Code layout:** the rendering logic lives in `converter/api/_lib/drawing_pdf.py` as pure
  functions plus a CLI entry point, so it can be tested without R2 or HTTP. The handler file
  stays thin.

### 2. The DWG reader binary

`converter/api/_bin/dwg2dxf` is LibreDWG 0.14, built statically for Linux x86_64, because Vercel's Python
runtime runs on Amazon Linux and a static binary avoids glibc mismatches.

- A committed GitHub Actions workflow (`.github/workflows/build-dwg2dxf.yml`, manual trigger
  only) builds it.
- The artifact is committed with `converter/api/_bin/NOTICE` stating GPL-3.0, the LibreDWG
  version, and the source URL. The full GPL-3.0 text sits beside it in `COPYING`.
- It runs server-side only and is never sent to browsers.

### 3. Triggering and status: `POST /api/files/[id]/convert-drawing`

A Next route. `/api/files` is a public middleware prefix, so the route calls `auth()` itself and
returns a JSON 401.

- **Access:** the caller must be able to view the file (the same check `/api/files/url` uses).
  Files that are not DWG/DXF get 400.
- **Claim, one atomic statement:**
  - Set `conversion_status = 'processing'` and `conversion_job_id = 'drawing:' || now()`.
  - Only when `converted_storage_key IS NULL` and either:
    - `conversion_status IS NULL`, or
    - `conversion_status = 'processing'` and the claim is more than 3 minutes old (a crashed
      run).
  - If no row is claimed, return the current status (200) without starting a second run.
  - A `'failed'` file is not retried automatically. A new upload gets a new file id.
  - CloudConvert's old STEP→GLB trigger also set `conversion_job_id` (to its job id), and the
    CloudConvert webhook still looks files up by it. A drawing claim always starts with
    `drawing:`, so the two never collide. Both meanings are documented in `lib/schema.sql`
    next to the column.
- **Configuration:** both `CAD_CONVERTER_SECRET` and `CAD_CONVERTER_URL` must be set. The URL
  is the converter project's production URL, for example
  `https://stiko-converter.vercel.app/api/convert_drawing`. It must be https, or http only on
  localhost. Otherwise the route answers 503 before claiming anything and logs what is
  missing.
- **Call:** `fetch(CAD_CONVERTER_URL, { redirect: 'manual' })` with the secret. A redirect is
  never followed.
  - No deployment-protection bypass is needed: the converter project's production domain is
    public and secret-guarded.
  - The target key is `<directory>/<stem>.drawing.pdf`, derived by a new pure helper
    `drawingPdfKey(storageKey)` in `lib/storageKeys.ts`, never taken from the client.
  - The route sets `maxDuration = 60` and the fetch times out at 55 s.
- **Success:**
  - Set `converted_storage_key` to the target key and `conversion_status = 'completed'`.
  - Then delete the file's `file_calibrations` rows. This is the existing obligation for anything
    that assigns `converted_storage_key`, and it tolerates its own failure, as the webhook route
    does.
- **Completed** only for a 200 whose JSON body has `pages` as a number > 0. A 200 without that
  is treated as a transient error.
- **Failed** (`'failed'`, never retried) only for 413 or 422, which are verdicts on the drawing.
- **Transient** (any other status, a redirect, a network error, a presign throw): release the
  claim (status and job id back to NULL), log the reason and answer 503.
- **Timeout** (no answer within 55 s): keep the claim as `'processing'` and answer 503. The
  next attempt waits until the claim is stale (3 minutes), so a slow drawing is not converted
  again on every open.
- **Response:** `{ conversionStatus, convertedStorageKey }`.

`GET /api/files/[id]/conversion-status` gains the same `auth()` and view-access check. It
currently has none.

### 4. Who triggers it

- **Uploader:** `lib/useUpload.ts`, after `/api/files/complete` succeeds for a `.dwg` or `.dxf`
  file, fires `POST /api/files/<id>/convert-drawing` without awaiting it. A failure changes
  nothing for the upload.
- **Viewer:** see section 5. This covers drawings uploaded before this change and any upload
  whose trigger was lost.

### 5. Viewer

In `ViewerContainer`, a drawing is a file whose ORIGINAL filename ends in `.dwg` or `.dxf`.

- **Has a PDF** (`convertedStorageKey` set): render `PDFKonvaViewer` with that key's URL,
  exactly as for an uploaded PDF. Markup, comments, page navigation and calibration-based
  measuring are unchanged.
- **No PDF yet:**
  - Show "Preparing drawing…" and keep the page's loading indicator up.
  - Call `POST /api/files/<id>/convert-drawing` once, then poll `GET …/conversion-status` every
    2 s for up to 90 s.
  - On `'completed'`, switch to the PDF.
- **Failed, or still not done after 90 s:** release the indicator and show "This drawing
  couldn't be converted for viewing. Download the original to open it in your CAD software."
- The page's existing PDF checks (`isPDFFile` and the measure surface) treat a drawing that has
  a PDF as a PDF. The decision lives in one pure helper, `viewerKindFor(filename,
  convertedStorageKey)`, used by both `ViewerContainer` and the portal page.
- Downloads still serve the original DWG/DXF, as `getFileDownloadDecision` already does.

### 6. Middleware

No change. The stiko app no longer serves `/api/convert_drawing`, so it gets no middleware
exemption. (The first version exempted it, back when the converter lived in this project.)

## Failure behaviour

| Case | Result |
|---|---|
| Unreadable DWG, `dwg2dxf` timeout, empty drawing, or a conversion over 45 s or killed by a resource limit | `422` → `'failed'` → download message |
| Next route's 55 s timeout fires | claim kept `'processing'`; reclaimed after 3 minutes; 503 |
| Any other status, a redirect, a 200 without pages, or a network error | claim released; 503; a later open retries |
| A run killed mid-way leaves `'processing'` | the next viewer reclaims it after 3 minutes |
| `CAD_CONVERTER_SECRET` or `CAD_CONVERTER_URL` unset in stiko | 503 before claiming; no file changes; uploads are never affected |
| `CAD_CONVERTER_SECRET` unset in the converter project | every call 401s → claim released; 503 |

## Testing

**Python (pytest)** in a scratch virtualenv. It is not part of `npm test`, and the command is
documented in `scripts/pytests/README.md`. Tests cover `drawing_pdf.py`:
- a DXF built in-test with ezdxf, with two layouts carrying content, gives 2 pages
- a model-only DXF gives 1 page
- page size follows the layout paper size
- output is black on white (sample a pixel of a rendered line)
- a DWG fixture (`example_2018.dwg` from LibreDWG's GPL test data, committed with a note)
  converts through `dwg2dxf`. Locally the Homebrew build is used, via env var `DWG2DXF`.

**Node (`node --test`):**
- `drawingPdfKey`
- `viewerKindFor`
- the claim-staleness rule, as a pure function `claimIsStale(jobId, now)`

The pytest suite also covers the handler end to end against a fake presigned-URL store. It
checks the child process's exits, its timeout and signal handling, and that its environment
holds nothing from the parent beyond the allowlist.

**Preview deployment, before merging:**
1. Create the `stiko-converter` Vercel project: Root Directory `converter`, Framework Preset
   Other, env `CAD_CONVERTER_SECRET`.
2. Temporarily set that project's Production Branch to `feature/dwg-dxf-as-pdf`.
3. Give the stiko project `CAD_CONVERTER_SECRET` and `CAD_CONVERTER_URL` for Production and
   Preview.
4. Push the branch. Upload an Autodesk sample DWG and a DXF on the stiko preview, and confirm
   both open as PDFs. Previews share the production database and R2, so use a throwaway package
   and delete it afterwards.

## Release

1. Confirm the stiko project has `CAD_CONVERTER_SECRET` and `CAD_CONVERTER_URL` for Production.
2. Merge and push.
3. Switch the converter project's Production Branch back to `main` and redeploy it from `main`.
4. Open an existing, previously unviewable DWG to confirm on-view conversion.

**Rollback:** revert the merge. Files already converted keep a harmless `.drawing.pdf` beside
them. The converter project can stay; nothing calls it once the route is gone.

No migration.

## Out of scope

- choosing layouts
- colour output
- xrefs (they will be missing)
- exact SHX fonts (ezdxf substitutes)
- 3D solids in DWG
- a "download as PDF" button
- retrying `'failed'` files
- converting at upload time in the uploader's browser
