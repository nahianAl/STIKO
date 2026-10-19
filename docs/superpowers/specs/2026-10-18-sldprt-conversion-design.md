# SolidWorks parts shown as GLB — design

**Date:** 2026-10-18
**Status:** Approved in conversation; spec for review

## Goal

Let people upload SolidWorks part files (`.sldprt`) and review them in Stiko's existing 3D
viewer without exporting STEP first. Each part is converted once to a GLB on an NVIDIA GPU
worker, and the GLB becomes the file's `converted_storage_key`. Part colours, measuring, markup
and comments then work with no new viewer code.

## Decisions already made

- **Converter:** NVIDIA's `usd-convert-cad` (PyPI; HOOPS Exchange inside, no Omniverse Kit)
  turns `.sldprt` into USD. A second step turns USD into GLB: `usd2gltf` first, headless Blender
  if the real-file test shows `usd2gltf` loses colours or normals. Chosen over:
  - cadmpeg, which is free but rated L1 for `.sldprt` and leaves undecodable faces empty;
  - Autodesk APS, which the user rejected;
  - convert3d, whose terms are blocked.
- **Scope:** `.sldprt` only. `.sldasm` and other native formats keep their "export STEP" advice.
  Assemblies are a later, separate project because they need several files uploaded together.
- **Where it runs:** a Modal serverless function on a T4 GPU, deployed from `cad-worker/` in
  this repo. It costs about $0.59 per GPU-hour and is billed per second.
- **Wiring:** asynchronous. The route asks Modal to start a job and returns at once; the worker
  reports back to a signed callback. (Rejected: waiting synchronously like the DWG route, since
  cold starts plus heavy parts would hit Vercel's 60 s limit; and having Stiko ask Modal for
  results, which needs a Modal token in the main app.)
- **Switch:** `NEXT_PUBLIC_SLDPRT_CONVERSION`. Anything other than `off` means on. It is a
  `NEXT_PUBLIC_` variable because the upload picker decides which extensions to accept in the
  browser. Next.js inlines it at build time, so flipping it needs a redeploy. That is already the
  case for every env change.
- **Budget:** the user's cap is $30 a month. `SLDPRT_MONTHLY_CAP` (default 300 conversions) is
  enforced in code, with a spending limit in Modal's dashboard as the hard stop.
- **Licence:** the user chose to build now and confirm two points with NVIDIA in parallel. The
  two points are whether `.sldprt` input needs a separate HOOPS licence, and explicit approval
  for a hosted product. The switch is the off-ramp if the answer is bad.

## Design

### 1. Formats and the switch

- **When the switch is on:** `sldprt` joins `SUPPORTED_EXTENSIONS` and `MODEL_FORMATS` in
  `lib/fileFormats.ts` and leaves `NATIVE_CAD_ADVICE`. The two lists must stay disjoint, which a
  test already checks.
- **When it is off:** `sldprt` stays in `NATIVE_CAD_ADVICE` as today ("Save As STEP, then
  upload.").
- **One helper:** `sldprtConversionEnabled()` reads the switch. Client and server both go
  through it.
- **Uploaded while off:** a `.sldprt` with no GLB shows "SolidWorks preview is turned off. Save
  As STEP to view it." Parts already converted keep working, because the viewer loads their GLB.

### 2. Pure rules: `lib/cadConversion.ts`

These mirror `lib/drawingConversion.ts` and are kept pure so `node --test` can cover them. The
file has no `@/` imports and imports `lib/queries` types with `import type` only.

- `isSldprtFilename(filename)`.
- **Claim format:** `cad:<attempt>:<ISO time>`, starting at attempt 1.
  `parseCadClaim(jobId)` returns `{attempt, claimedAt}` or `null`.
- **Stale claim:** `CAD_CLAIM_STALE_MS` is 15 minutes, against the worker's 10-minute limit.
- **`mayClaim(status, jobId, now)`:**
  - `null` → yes.
  - `completed` or `failed` → no.
  - `processing` → only when the claim is stale or unreadable.
  - `failed` is never retried; a new upload gets a new file id.
- **`nextAttempt(jobId)`:** the stale claim's attempt + 1. `CAD_MAX_ATTEMPTS = 3`. Reclaiming
  after attempt 3 goes stale marks the file `failed` instead of starting attempt 4.
- **`monthPrefix(now)`:** `YYYY-MM` in UTC, for counting this month's claims.
- **`firstOfNextMonth(now)`:** the date shown when the cap is reached.
- **`workerOutcome(status, body)`** classifies the Modal *start* reply:
  - `started`: 200 with a call id.
  - `retry`: anything else.
  - The start endpoint never reads the file, so no start reply is a verdict on the file. Only the
    callback can mark a file `failed`.
- **`callbackOutcome(body)`:** `completed` when `ok` is true and the GLB size is above 0;
  otherwise `failed`, keeping the worker's reason for logs.
- **Polling:** `CAD_POLL_INTERVAL_MS = 3000`, `CAD_POLL_LIMIT_MS = 300_000`, and
  `nextPollStep`, with the same shape as the drawing version.

### 3. Start route: `app/api/files/[id]/convert-cad/route.ts`

This copies `convert-drawing/route.ts`, in this order:

1. Check the session, then `getFileAccess`. `/api/files` is a public middleware prefix, so the
   route checks these itself.
2. Load the row and return 400 if it is not a `.sldprt`. If it already has a
   `converted_storage_key`, return the current state.
3. **Switch off:** 503 `{reason: 'disabled'}`, without claiming.
4. **`CAD_WORKER_URL` or `CAD_WORKER_SECRET` unset, or the URL not https:** 503 and a log line,
   without claiming.
5. **Cap:** count rows with `conversion_job_id LIKE 'cad:%:' || monthPrefix || '-%'` (for
   example `cad:%:2026-10-%`). At or above
   `SLDPRT_MONTHLY_CAP`, answer 200 `{conversionStatus: null, deferredUntil: firstOfNextMonth}`
   without claiming.
   - The count can be slightly low: a reclaim overwrites the earlier claim, and purged files
     drop out of it. That is acceptable with a 10× margin under the budget.
6. **Claim:** compare-and-set as in the drawing route. The new job id is `cad:<n>:<now>`. If the
   stale claim was already attempt 3, set `failed` instead and answer that.
7. **Callback token:** HMAC-SHA256 of `fileId + ':' + claimId` with `CAD_WORKER_SECRET`.
8. **Call the worker:** POST to `CAD_WORKER_URL` with `redirect: 'manual'`, header
   `X-Worker-Secret`, and a 15 s timeout. Body:
   `{sourceUrl, targetUrl, filename, callbackUrl, fileId, claimId, token}`.
   - `targetUrl` is a presigned PUT for `cadGlbKey(storageKey)` with content type
     `model/gltf-binary`. `cadGlbKey` sits next to `drawingPdfKey` in `lib/storageKeys.ts` and
     produces `<dir>/<stem>.sldprt.glb`.
   - Both presigned URLs last 60 minutes, covering a queued job plus a 10-minute run.
   - `callbackUrl` is `${origin}/api/conversions/cad-callback`.
9. **Map the reply** with `workerOutcome`:
   - `started` → keep the claim and answer `processing`.
   - `retry` → release the claim (status and job id back to NULL) and answer 503.

### 4. Callback route: `app/api/conversions/cad-callback/route.ts`

- Read `{fileId, claimId, token, ok, glbBytes, reason}` and recompute the HMAC with a
  constant-time compare. On a mismatch, answer 401.
- **`completed`:** `UPDATE files SET conversion_status='completed', converted_storage_key=<key>
  WHERE id=$fileId AND conversion_job_id=$claimId`. Then delete `file_calibrations` for the
  file, as its own statement that tolerates its own failure, the same way the drawing route
  does.
- **`failed`:** the same `WHERE` clause, setting `failed`, and the reason is logged.
- **A callback for an old claim** updates zero rows. The route answers 200 so the worker does not
  retry, and logs it.
- The route is not under `/api/files`. The token is its only authentication, and it must not
  depend on middleware.

### 5. The worker: `cad-worker/`

A Python Modal app (`cad-worker/app.py`, `cad-worker/requirements.txt`, `cad-worker/README.md`).

- **Image:**
  - Base: Debian bookworm with Python 3.12 (needs glibc 2.35+).
  - Packages: `usd-convert-cad` pinned to the tested version, `usd2gltf` and `usd-core` pinned.
  - The converter's telemetry is disabled by env var.
- **Start endpoint:**
  - Accepts a POST and checks `X-Worker-Secret` with a constant-time compare (401 otherwise).
  - Validates the body. Both URLs must be https, and the storage URLs must be on an allowlisted
    host suffix (`WORKER_ALLOWED_HOST_SUFFIXES`, as in the DWG converter).
  - Spawns the GPU function and answers 200 `{callId}`.
  - The endpoint itself runs on CPU.
- **GPU function:** `gpu="T4"`, `timeout=600`, no retries.
  1. Downloads with a streaming 200 MB cap. Over the cap → callback `ok: false` with reason
     `too_large`.
  2. Runs `usd-convert-cad -i in.sldprt -o out.usdc` with millimetres and Y-up via the
     converter's options, and default tessellation (LOD 2). The output is checked for at least
     one mesh.
  3. Runs `usd2gltf` to produce `out.glb`, asserting a nonzero size and a valid GLB header.
  4. PUTs the GLB to `targetUrl`.
  5. POSTs the callback, retrying it 3 times with backoff on network or 5xx errors.
  6. Any exception or timeout → callback `ok: false` with the reason.
- **Secrets:** Modal holds `CAD_WORKER_SECRET` and the host allowlist only. It has no database or
  R2 credentials.
- **Licence:** `cad-worker/README.md` records the NVIDIA terms in use:
  - §1.1.2.1, offering the software as a service;
  - §8.15, running only on NVIDIA GPUs;
  - §1.7, the notice and usage reports;
  - §11.1.3, telemetry.
  The required notice ("This software contains source code provided by NVIDIA Corporation") is
  added to the app's attributions or legal page.

### 6. Upload and viewer

- **Upload:** `lib/useUpload.ts` fires `POST /api/files/${fileId}/convert-cad` with
  `keepalive: true` after a `.sldprt` registers, next to the existing drawing call.
- **Viewer:** `components/viewers/CadPreparer.tsx` is modelled on `DrawingPreparer.tsx`.
  `ViewerContainer` uses it when the file is a `.sldprt` with no `convertedStorageKey`.
  1. On mount, POST `convert-cad`, then poll `conversion-status` with `nextPollStep`.
  2. The states it can show:

  | State | What the viewer shows |
  |---|---|
  | converting | "Converting SolidWorks part… this can take a minute the first time." |
  | deferred | "Preview available from <date>. Save As STEP to view it now." |
  | disabled | The switch-off message from section 1. |
  | failed | "Couldn't convert this SolidWorks part. Save As STEP and upload that." |
  | poll limit reached | "Still converting. Check back in a few minutes." The claim is kept. |

  3. On `done`, the normal GLB path loads `convertedStorageKey`.
- **Portal:** `app/portal/[id]/page.tsx` gets the same `.sldprt` handling wherever it branches
  on drawings today.
- **Units:** `assumedMmPerUnit` in `lib/measure/calibration.ts` gains `case 'sldprt': return 1`,
  because the worker writes millimetres. Measuring then works without calibration, like STEP.
- **Orientation is permanent once used:** once production pins exist on SolidWorks parts, Y-up
  can't change without moving them.

## Failure table

| Situation | Row becomes | User sees | Retried? |
|---|---|---|---|
| Worker reports unreadable, empty, too large or timeout | `failed` | "Couldn't convert…" | No |
| Start call: any non-200 reply or network error | claim released | spinner, then retry on next open | Yes |
| Worker URL or secret unset | unchanged | spinner, then 503 | Yes, once configured |
| Callback never arrives | `processing` until stale (15 min) | "Still converting…" | Yes, up to 3 attempts, then `failed` |
| Monthly cap reached | unchanged | "Preview available from…" | On the first open after the 1st |
| Switch off | unchanged | "SolidWorks preview is turned off…" | When switched back on |
| Callback for an old claim | unchanged | — | — |

## Testing

1. **Real-file test first, before any Stiko code.** Deploy `cad-worker/` alone and convert the
   user's real `.sldprt` samples (5–10 files, several SolidWorks years, a couple of complex ones)
   through a temporary local script. For each file, record:
   - geometry against a STEP export of the same part where one is available;
   - colours;
   - millimetre scale and Y-up orientation;
   - GLB size;
   - warm and cold conversion time.
   Choose `usd2gltf` or Blender here. **If the output is poor, stop.**
2. **`node --test`:** every rule in `lib/cadConversion.ts`, `cadGlbKey`, the `sldprt` entry in
   `assumedMmPerUnit`, and the switch's effect on the format lists, including the disjointness
   test.
3. **Route tests on the PGlite harness:** `convert-cad` and `cad-callback`, covering:
   - claim compare-and-set losing a race;
   - stale reclaim and the attempt-3 cutoff;
   - cap reached;
   - switch off and worker not configured;
   - bad token, an old claim's callback, and the calibration delete.
4. **Worker pytest:** stubbed converter and HTTP for the size cap, the timeout path, empty USD,
   a bad GLB, callback retry, and refusal on a bad secret or bad host.
5. **Browser:** a local harness serving a converted GLB fixture through `CadPreparer` and the
   GLB viewer. Each state is checked with stubbed status responses. No uploads, because local
   dev uses the production database and R2.
6. **Gates:** `tsc`, lint, all node tests, `next build`, and pytest.

## Release

Production is the only environment. No migration.

1. Deploy `cad-worker/` to Modal and set the Modal workspace spending limit.
2. On stiko (Production), set `CAD_WORKER_URL`, `CAD_WORKER_SECRET`, `SLDPRT_MONTHLY_CAP=300`,
   and `NEXT_PUBLIC_SLDPRT_CONVERSION=on`.
3. Merge to main with a merge commit and push. Main auto-deploys, which also applies the env.
4. Upload one real part to a throwaway package on production. Confirm it converts, measures in
   millimetres, and stands upright.
5. **Rollback:** set `NEXT_PUBLIC_SLDPRT_CONVERSION=off` and redeploy. `.sldprt` returns to the
   "Save As STEP" advice, and parts already converted keep working.

## Out of scope

- `.sldasm` and Pack and Go zips, and other native formats (CATIA, NX, Creo, Inventor, Parasolid,
  JT, Solid Edge). The same worker can take them later.
- A background job that converts deferred files when the month rolls over; they convert on next
  open.
- Showing which faces failed to convert. HOOPS gives no per-face loss report.
- A user-facing tessellation quality setting.
