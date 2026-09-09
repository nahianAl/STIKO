# Upload reliability audit — raw findings

**Date:** 2026-09-08
**Status:** VETTED. Four independent audits, then two adversarial reviewers (Opus) instructed to
REFUTE rather than confirm, defaulting to "refuted" where a mechanism could not be verified.
8 findings dropped, 6 severities lowered, 2 raised, 3 new issues found during vetting.
**Goal:** Stiko is going from a handful of users to thousands. Uploads must not lose work.

Already fixed and excluded: retry-on-network-error (`lib/uploadRetry.ts`), the 300s→3600s
presign expiry, `app.stiko.design` missing from the R2 CORS allow-list.

---

## A — Silent data loss

**A1. Comment/annotation submit treats any non-2xx as success.** HIGH
`components/portal/CommentsPanel.tsx:127`, `app/portal/[id]/page.tsx:1237`.
Neither checks `res.ok`. `fetch` only rejects on network failure, so 401/403/500 resolve
normally; both then clear text, attachments and the pending pin. The comment never reached
Postgres and there is nothing left to resubmit. Primary feedback path of the product.

**A2. Duplicate relative paths cross-contaminate progress rows.** MEDIUM
`components/ui/FileDropzone.tsx:99-109`, `lib/useUpload.ts:116-120,230`.
`filesRef` is a Map keyed by path (last write wins); `patch` matches EVERY item with that
path. If file A fails and path-twin B succeeds, B's patch flips A's row to 'done'.
`allDone`/`anyFailed` derive from that array, so a version can publish missing a file.

## B — Permanent hangs

**B1. No timeout or AbortSignal anywhere in the network layer.** HIGH
`lib/useUpload.ts:34-62` (no `xhr.timeout`/`ontimeout`), `:130-140`, `:166-171`, `:196-209`
(no `AbortSignal`). A stalled socket never fires onload/onerror, so the promise never settles.
`putWithRetry` reacts only to rejection. `start()` awaits `Promise.all` over the pool, so ONE
stuck file hangs the WHOLE batch forever: no error, no 'failed' state, no retry button.
`runOptimize.ts:150` already uses a watchdog for this exact hazard.

## C — Retry and idempotency

**C1. `/api/files/complete` has no retry.** HIGH
`lib/useUpload.ts:196-218`. The PUT gets 4 attempts; the very next hop gets none. Any blip
marks the item failed, and the retry button re-uploads the entire file from zero even though
the bytes are already in R2.

**C2. Every retry mints a new fileId, orphaning the previous object.** HIGH
`lib/useUpload.ts:262-270` → `app/api/files/upload/route.ts:44`. Retry re-presigns from
scratch. Any post-PUT failure permanently orphans the previous original (and variant).

**C3. Retrying a partially-failed batch re-uploads and duplicates everything.** HIGH
`components/portal/NewVersionDrawer.tsx:197-211`, `:109-150`. The `onRetry` closure captures
a stale `upload` object literal, so its `upload.allDone` branch is dead code; the error banner
never clears; the only remaining button calls `upload.start(files)` over the FULL array,
re-uploading the 19 already-registered files as new rows. `app/new/page.tsx:241-250` has the
correct pattern.

**C4. No idempotency on `/complete`.** MEDIUM
`app/api/files/complete/route.ts:81-91`, `lib/schema.sql:120-139`. Plain INSERT, no
`ON CONFLICT`, no unique constraint on `storage_key` or `(version_id, filename)`. A response
lost after commit produces a silent duplicate row.

**C5. `create()` is not idempotent.** MEDIUM
`app/new/page.tsx:76-147`. A failure after project/portal/version creation, then retry via the
same button, creates a whole new project + package + version and re-uploads everything.

## D — Orphans and cleanup

**D1. No garbage collection or reconciliation exists at all.** STRUCTURAL
`lib/s3.ts:145-172`. `deleteObjects` is only called from delete routes that start from a DB
row. An object with no row is never visited by any code path, ever.

**D2. Interruption between PUT success and `/complete` orphans with zero trace.** MEDIUM
`lib/useUpload.ts:144-210`. Server never records that a URL was issued; client state is
in-memory only.

**D3. Version deleted or access revoked mid-upload.** MEDIUM
`app/api/files/upload/route.ts:28-42` vs `complete/route.ts:26-40`. `/complete` correctly
404s/403s, but the object is already in R2 and is now permanently orphaned.

**D4. Abandoned drafts become phantom versions an uploader cannot delete.** HIGH
`app/api/versions/route.ts:90-135`, `app/portal/[id]/page.tsx:803-825`, `lib/access.ts:298-303`.
No path reuses an existing unpublished draft. The draft consumes a version number, is returned
to `canUpload` users, and the portal auto-selects `data[0]` by version_number DESC — so a
phantom draft can become the default-selected version. `getVersionDeleteDecision` hardcodes
`isOwnUpload: false`, so an uploader cannot delete even their own.

## E — Protocol and limits

**E1. Checksum-of-nothing on every presigned PUT — a live time-bomb.** CRITICAL IF TRIGGERED
`lib/s3.ts:33-39` (no Body) → `@aws-sdk/middleware-flexible-checksums` (DEFAULT
`WHEN_SUPPORTED`, CRC32 over `body || ""`) → `@smithy/signature-v4:244` hoists it into the
signed query. Every presigned PUT carries `x-amz-checksum-crc32=AAAAAA==` — CRC32 of an EMPTY
body. Cloudflare's S3-compat docs list this header as **Not Implemented**. SDK 3.729.0 making
this the default caused a documented total PutObject outage on R2, fixed Cloudflare-side
2025-02-03. LocalStack still hard-rejects the same construct. If R2 ever validates it, 100% of
uploads fail instantly.

**E2. No multipart; 5 GiB hard single-PUT ceiling; no resumability.** MEDIUM
`app/api/files/upload/route.ts:71` never passes `contentLength`, so size is unenforced. R2 caps
a single PUT at 4.995 GiB. The resulting 400 is not in the retriable set, so it fails instantly
as generic "Upload failed".

**E3. Retry restarts from byte 0 and can exhaust the shared 3600s window.** LOW-MED
`lib/useUpload.ts:60,79-103`. Four full re-sends of a multi-GB file can outlive the URL, turning
a retriable drop into a non-retriable 403.

**E4. No length validation on filename/extension → oversized R2 key.** LOW-MED
`app/api/files/upload/route.ts:16-23` → `lib/storageKeys.ts:77-78`. `ext` is everything after
the last dot, uncapped. R2's key limit is 1024 bytes. Fails only after the PUT starts.

**E5. CORS excludes Vercel preview deployments.** HIGH (for the team)
Fixed exact-match origin list. Preview URLs are per-branch and never match. The browser blocks
the preflight, which surfaces as `status: null` — indistinguishable from a network blip — so the
app retries 4 times into a wall it can never get through.

## F — Throughput and diagnosis

**F1. The 4-wide pool silently narrows to 1 whenever files need optimization.** HIGH
`lib/model/runOptimize.ts:53-66` serializes ALL optimization behind one module-level queue
(deliberately, to avoid ~9.6GB of concurrent OOM). But a lane blocks in `await` while queued, so
later files do not even START uploading. The UI shows "Optimising…" identically whether actively
converting or merely queued.

**F2. Every failure collapses into one undifferentiated "Upload failed".** HIGH
`components/ui/UploadProgress.tsx:64-75`, `lib/useUpload.ts:214-217`. Status/error is
console-only. Expired signature, oversized file, CORS wall and network exhaustion are
indistinguishable to the user and to whoever supports them.

**F3. Cancel does not cancel.** MED-HIGH
`app/new/page.tsx:199-201`. `router.back()` unmounts the component but nothing aborts the
running `create()`. The upload pool, `/complete` calls and `finish()` keep going — so a
cancelled flow can still publish the package and email every reviewer. No `beforeunload`
anywhere in the repo.

**F4. No rate limiting anywhere.** MEDIUM — `middleware.ts:44-67`, auth gating only.

**F5. Five DB round trips per file, no batch endpoint.** MEDIUM
`upload/route.ts:28-42` and `complete/route.ts:26-40` each redo the same version→portal→access
lookup. A folder of N files costs 5N round trips.

**F6. Multi-file comment attachments are all-or-nothing and re-orphan on retry.** MEDIUM
`Promise.all(files.map(uploadFile))`; a later failure strands the earlier successes, and the
natural retry re-uploads all of them under new UUIDs.

## G — Minor / latent

- **G1.** `/complete` never validates `fileSize`/`fileType` → uncaught 500 instead of 400.
- **G2.** No bounds on `filename`/`contentType`/`folderPath` before persistence.
- **G3.** `getPublicUrl` does no percent-encoding. Currently dead code (no consumers).
- **G4.** R2 allows 1 write/sec/key; the STEP conversion key is deterministic, so a webhook
  redelivery racing a manual retry can 429.
- **G5.** Zero-byte file yields `NaN%` progress.
- **G6.** `lib/auth.ts` builds a real pooled Postgres connection at module scope, unlike the
  HTTP driver used everywhere else. Likely idle under JWT sessions; unverified.
- **G7.** No client-side file size ceiling or warning.
- **G8.** No end-to-end content integrity check (the checksum is meaningless per E1, and the
  client never compares against the ETag). TLS covers transport; this is defence-in-depth.


---

# VETTING RESULTS

## Dropped — refuted, or folded into another finding

- **C4** (no idempotency on `/complete`). Mechanism impossible: there IS no `/complete` retry, and a
  same-`fileId` replay hits `files.id TEXT PRIMARY KEY` — a 500, not a duplicate row. Worse, the
  proposed unique constraint on `(version_id, filename)` **would break folder uploads**, since
  `filename` is the basename and `FolderA/part.glb` + `FolderB/part.glb` are two valid rows.
- **D2, D3** — true, but each is D1's orphan restated with a rarer trigger. Fold into one.
- **E4** (oversized R2 key). Three guards missed: the dropzone whitelists extensions, OS `NAME_MAX`
  is 255 bytes, and worst-case key is 410 bytes against R2's 1024 limit.
- **E5** (CORS blocks Vercel previews). Premise false — there is no preview deployment; `main` builds
  straight to production.
- **G3** (`getPublicUrl` encoding). Not dead code — it runs on every presign; the returned FIELD is
  unused. And its keys are all UUIDs plus a whitelisted extension, so nothing needs encoding.
- **G4** (R2 1-write/sec on the conversion key). The whole CloudConvert path is dead: nothing sets
  `conversion_job_id`, so the webhook can never match and `retry` can never pass its gate.
- **G6** (`lib/auth.ts` pool). Tested: `new Pool(...)` opens zero connections, and the adapter is
  never invoked under a JWT-session Credentials provider. Dead config, not a leak.

## Severity corrected

- **E1** CRITICAL → **LOW (hygiene)**. The "Not Implemented" citation was a misread of the R2 docs —
  those markers are on bucket-config ops, not PutObject; CRC-32 is listed as supported. Decisive:
  if R2 honoured `AAAAAA==` every upload would fail, and they do not. The Jan-2025 outage was real
  but Cloudflare fixed it server-side on 2025-02-03.
- **C2** HIGH → MEDIUM. The PUT is atomic and a lost response retries the same URL, so the orphan
  window is only C1's window, and the cost is storage, not lost work.
- **A2** MEDIUM → LOW-MED, but with a worse consequence found: `filesRef` collapses to one Map entry,
  so the genuinely failed twin is **permanently un-retryable**.
- **F1** HIGH → MEDIUM (every file still lands; throughput and UX only). **New consequence found:**
  the variant URL is presigned at the same instant as the original, so a long optimize queue can
  expire it, and the 403 is swallowed as a silent viewer downgrade.
- **E2** MEDIUM → LOW-MED, **E3** → LOW (manual retry re-presigns, so a 403 is one click from
  recovery), **F5** → LOW-MED (pure latency; the `neon()` HTTP driver has no pool to exhaust).
- **D1** — factually correct but it is a **documented accepted tradeoff** (`ARCHITECTURE.md:54`), not
  a defect. **D4** — the `isOwnUpload: false` half is refuted; it is deliberate and documented
  (`lib/capabilities.ts:68`), because one version holds several people's files.

## Severity RAISED

- **F6** — the audit described the orphaning but missed that the failure is **completely silent**
  (`console.error` only, no error state) and `setPendingFiles([])` sits inside the try, so the files
  stay attached and the natural resubmit re-uploads every one under fresh UUIDs.

## Found DURING vetting — not in the original audit

- **NEW-1. A network failure during publish strands a fully-uploaded draft with no recovery path.**
  `app/new/page.tsx:141-146`. A *rejected* (not merely non-ok) publish or participants fetch
  propagates to the catch, which sets `phase = 'compose'` — and the recovery button at `:241` lives
  inside the `phase === 'uploading'` branch, so it stops rendering. Every byte is in R2, every row in
  Postgres, `draft` still holds the ids, and the UI offers no way to publish. The only available
  action rebuilds a second project, portal and version and re-uploads everything. Strictly worse than
  both C5 and D4.
- **NEW-2. `/api/conversions/retry` has no `auth()` and no ownership check.** It accepts an arbitrary
  `fileId`, presigns a download URL for it, and ships it to CloudConvert. Middleware requires *a*
  session, but any authenticated user can name any file id. Currently unreachable only because the
  `conversion_status === 'failed'` gate can never be satisfied — a live IDOR the moment conversions
  are re-enabled.
- **NEW-3. `/api/comments/attachments` requires only `auth()` — no package membership check.**
  It mints 25 MB presigned writes. With open signup, any account can mint unlimited bucket writes.
  The sharpest instance of F4.

## Final ranking (vetted)

**Tier 1 — losing or hiding user work**
1. **A1** comments/annotations silently discarded while the UI reports success. HIGH.
2. **B1** no timeout anywhere; one stalled file wedges the whole batch, no error, no retry. HIGH.
3. **C3** retrying a partial batch re-uploads and duplicates every successful file. HIGH.
4. **NEW-1** publish failure strands a complete draft with no way to finish it. HIGH.
5. **F6** multi-attachment failure is silent and re-orphans on every resubmit. HIGH (raised).

**Tier 2 — recovery is expensive or confusing**
6. **F2** every failure renders the same string; `UploadItem` has no error field at all. HIGH.
7. **C1** `/complete` has no retry; recovery is a full re-transfer. MED-HIGH.
8. **F3** Cancel doesn't cancel; a cancelled flow still emails reviewers. MED-HIGH.
9. **D4** phantom drafts are auto-selected and labelled "Current". MEDIUM.
10. **C5** `create()` not idempotent — duplicate project/package/version. MEDIUM.
11. **F1** optimize queue serializes the pool; can expire the variant URL. MEDIUM.

**Tier 3 — abuse, cost, ceilings**
12. **F4 + NEW-3** no rate limiting; attachments route mints writes for any account. MEDIUM.
13. **NEW-2** conversions/retry IDOR, latent. MEDIUM.
14. **C2 + D1** orphans with no reconciliation. MEDIUM, documented tradeoff.
15. **E2 + G7** 5 GiB single-PUT ceiling, no resumability, no client size gate. LOW-MED.
16. **A2** duplicate paths; failed twin permanently un-retryable. LOW-MED.

**Tier 4 — hygiene:** E1, E3, F5, G1, G2, G5, G8.
