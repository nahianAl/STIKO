# DWG and DXF shown as PDF — design

**Date:** 2026-10-15
**Status:** Approved in conversation; spec for review

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
- **Where it runs:** a Python function inside the existing Vercel project, so there is no new
  account or bill. Rejected alternatives:
  - a Fly.io service (new account)
  - CloudConvert (third party, and its output is untested)
- **Look:** black lines on white, like a standard plotted sheet. Colour is out of scope.
- **Budget:** $0. Conversions run inside the existing Vercel plan.

## Design

### 1. The converter: `api/convert_drawing.py`

A Vercel Python serverless function at `/api/convert_drawing`, living in the repo root `api/`
folder beside the Next.js app. Next's `app/api` routes are unaffected.

- **Input:** `POST` with JSON `{ "sourceKey": str, "targetKey": str }` and header
  `X-Converter-Secret`.
- **Auth:** a constant-time comparison of that header with env var `CAD_CONVERTER_SECRET`; any
  mismatch returns 401. There is no user session here. Only Stiko's Next server calls it.
- **Steps:**
  1. Download `sourceKey` from R2 (boto3, S3 API, the existing `R2_*` env vars) into `/tmp`.
     Reject anything over 50 MB.
  2. For `.dwg`, run the bundled `api/_bin/dwg2dxf -y -o out.dxf in.dwg` with a 30 s timeout.
  3. Load with `ezdxf.recover.readfile`.
  4. **Pages:** every paper-space layout that has content, in tab order. A layout counts if it
     has any entity other than its own overall viewport. If none qualifies, use model space.
  5. **Page size:** the layout's plot paper size in mm when the file defines a positive one;
     otherwise A3 landscape (420 × 297 mm). Margins 10 mm. Content is fitted to the page.
  6. **Render settings:** `Configuration(background_policy=WHITE, color_policy=BLACK,
     min_hatch_line_distance=0.5, hatching_timeout=10)`.
  7. Merge the pages into one PDF and upload it to `targetKey` with
     `Content-Type: application/pdf`.
- **Output:** `200 { "pages": n }`, or `422 { "error": "<reason>" }` for an unreadable or empty
  drawing.
- **Packaging:**
  - `requirements.txt` pins `ezdxf`, `pymupdf` and `boto3`.
  - `vercel.json` sets the function's `maxDuration: 60`, `memory: 1769` and
    `includeFiles: "api/_bin/**"`.
- **Code layout:** the rendering logic lives in `api/_lib/drawing_pdf.py` as pure functions
  (bytes in, PDF bytes out), so it can be tested without R2 or HTTP. The handler file stays
  thin.

### 2. The DWG reader binary

`api/_bin/dwg2dxf` is LibreDWG 0.14, built statically for Linux x86_64, because Vercel's Python
runtime runs on Amazon Linux and a static binary avoids glibc mismatches.

- A committed GitHub Actions workflow (`.github/workflows/build-dwg2dxf.yml`, manual trigger
  only) builds it.
- The artifact is committed with `api/_bin/NOTICE` stating GPL-3.0, the LibreDWG version, and
  the source URL.
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
  - `conversion_job_id` is otherwise unused (the CloudConvert webhook never sets it). Its new
    meaning is documented in `lib/schema.sql` next to the column.
- **Call:** `fetch(<origin of the incoming request>/api/convert_drawing)` with the secret.
  - When `VERCEL_AUTOMATION_BYPASS_SECRET` is set, also send it as `x-vercel-protection-bypass`.
    Vercel's deployment protection otherwise blocks a server-to-server call to a protected
    preview URL.
  - The target key is `<directory>/<stem>.drawing.pdf`, derived by a new pure helper
    `drawingPdfKey(storageKey)` in `lib/storageKeys.ts`, never taken from the client.
  - The route sets `maxDuration = 60` and the fetch times out at 55 s.
- **Success:**
  - Set `converted_storage_key` to the target key and `conversion_status = 'completed'`.
  - Then delete the file's `file_calibrations` rows. This is the existing obligation for anything
    that assigns `converted_storage_key`, and it tolerates its own failure, as the webhook route
    does.
- **Failure** (non-200, timeout, network): set `conversion_status = 'failed'` and log the
  reason.
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

Add `'/api/convert_drawing'` to `PUBLIC_PATHS` in `lib/routeAccess.ts`, with a comment that the
endpoint authenticates by secret, not session. Without it, the server-to-server call is
redirected to `/login`.

## Failure behaviour

| Case | Result |
|---|---|
| Unreadable DWG, `dwg2dxf` timeout, or empty drawing | `422` → `'failed'` → download message |
| Converter over time, or any network error | the Next route marks `'failed'` |
| A run killed mid-way leaves `'processing'` | the next viewer reclaims it after 3 minutes |
| `CAD_CONVERTER_SECRET` unset | every call 401s → `'failed'`; uploads are never affected |

## Testing

**Python (pytest)** in a scratch virtualenv. It is not part of `npm test`, and the command is
documented in `api/_lib/README.md`. Tests cover `drawing_pdf.py`:
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

**Preview deployment, before merging:** push the branch so Vercel builds a preview, set
`CAD_CONVERTER_SECRET` for Preview, upload an Autodesk sample DWG and a DXF there, and confirm
both open as PDFs. Previews share the production database and R2, so use a throwaway package
and delete it afterwards.

## Release

1. Set `CAD_CONVERTER_SECRET` for Production in Vercel.
2. Merge and push.
3. Open an existing, previously unviewable DWG to confirm on-view conversion.

**Rollback:** revert the merge. Files already converted keep a harmless `.drawing.pdf` beside
them.

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
