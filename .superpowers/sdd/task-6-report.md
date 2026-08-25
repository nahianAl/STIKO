# Task 6 Report: Optimize during upload

## Status: DONE (Step 6 skipped — see below)

## Summary

Implemented client-side wiring so that GLB/glTF uploads are optimized in-browser
between the original PUT and the `/api/files/complete` call, per the brief's exact
call order:

1. `POST /api/files/upload` → returns `presignedUrl` and `variantPresignedUrl`.
2. PUT the original to `presignedUrl` (unchanged XHR-based upload, left alone).
3. If `variantPresignedUrl` exists and `shouldOptimize(filename, size)` is true:
   optimize locally via `runOptimize`, and on success PUT the optimized bytes to
   `variantPresignedUrl`.
4. `POST /api/files/complete` once, with `hasOptimizedVariant` reflecting whether
   step 3 actually succeeded. `state: 'done'` is set only after this call, exactly
   as before.

## Files changed

- `lib/useUpload.ts`
  - Added `import { runOptimize, shouldOptimize } from '@/lib/model/runOptimize';`
  - Widened the presign response destructure to include `variantPresignedUrl`.
  - Inserted the optimization block verbatim from the brief, between the original
    upload's `await new Promise<void>(...)` and the `const folderPath = ...` line.
  - Added `hasOptimizedVariant` to the `/api/files/complete` request body, after
    `folderPath`.
- `components/ui/UploadProgress.tsx`
  - `UploadState` now includes `'optimizing'`.
  - Added the `item.state === 'optimizing'` progress-label branch ("Optimising…")
    before the existing `uploading`/`pending` branch.
  - No other change needed — the existing `track` background ternary already
    falls through to `#F1F3FF` for any state that isn't `done`/`failed`.

Diff matches the brief's verbatim code exactly (confirmed via `git diff` before
committing).

## Verification performed

- `npx tsc --noEmit` → clean, no errors.
- `npm test` → 175 passing, 0 failing (unchanged from before this task; no new
  tests added, per the brief's guidance that this is browser-API glue with no
  test harness in this project).
- Manually traced every failure path in the new optimization block against the
  non-negotiable constraint ("optimization must never block or fail an upload"):
  - `variantPresignedUrl` is `null` (non-`.glb`/`.gltf` file) → block skipped
    entirely, `hasOptimizedVariant` stays `false`, upload proceeds normally.
  - `shouldOptimize` returns `false` (oversized or non-optimizable) → block
    skipped, same as above.
  - `runOptimize` resolves `null` (worker unavailable, worker crash, timeout,
    `arrayBuffer()` failure, or any internal optimizer error) — confirmed by
    reading `lib/model/runOptimize.ts` that every failure path calls
    `resolve(null)`, never `reject`, so `await runOptimize(...)` cannot throw —
    the `if (optimized)` guard is skipped, `hasOptimizedVariant` stays `false`,
    state is patched back to `'uploading'`, and the flow proceeds to
    `/api/files/complete`.
  - `runOptimize` resolves a result but the variant PUT fails (network error or
    non-OK status) → caught by the block's own inner `try/catch`, logged via
    `console.warn`, `hasOptimizedVariant` explicitly reset to `false`, state
    patched back to `'uploading'`, flow proceeds to `/complete` — this failure
    never reaches the outer `try/catch` that would mark the whole upload
    `'failed'`.
  - In every one of the above cases, `/api/files/complete` is still called and
    `state: 'done'` is still reached at the end, matching "today's behaviour" as
    the worst case.
- Grepped the codebase for other consumers of `UploadState` / `item.state ===`
  comparisons outside `UploadProgress.tsx` — none exist, so no exhaustiveness
  checks elsewhere needed updating (also confirmed by the clean `tsc` run).
- Confirmed `app/api/files/upload/route.ts` already returns `variantPresignedUrl`
  (and `variantStorageKey`, unused by the client per the brief) and
  `app/api/files/complete/route.ts` already accepts `hasOptimizedVariant` and
  derives `converted_storage_key` server-side, with `conversion_status` left
  `NULL`. No server-side files were touched (not in scope for this task).

## NOT verified — Step 6 (end-to-end)

Per the controlling instructions, Step 6 of the brief ("Verify end to end": upload
`Rohit Resort Villas.glb` through the running app, check the browser console for
the exact optimization log line, and confirm both S3 objects and the `files` row
in the database) was **not performed**. This environment has no browser, no
running app instance, and no S3/DB credentials available to this agent. This is
explicitly called out rather than simulated or claimed.

## Commit

`bc05962` — `feat(upload): optimize GLB uploads in the browser before registering them`
(2 files changed, 45 insertions, 2 deletions — `lib/useUpload.ts` and
`components/ui/UploadProgress.tsx`).

## Concerns

None regarding the implementation itself — it matches the brief verbatim and all
constraints are satisfied by inspection and the passing typecheck/test suite.
The only open item is the un-performed Step 6 browser/S3/DB verification, which
requires an environment this agent does not have.

---

## Controller addendum — bundle isolation verified for real

Task 4's bundle check was trivially green because nothing imported the optimizer yet. Task 6
is the first client import, so the check is only now meaningful. Re-ran it:

`rm -rf .next && npm run build` → "⚠ Compiled with warnings" (the pre-existing bcryptjs /
Edge-Runtime warning via lib/password.ts). Build then fails at page-data collection on the
missing DATABASE_URL, which is AFTER client compilation, so emitted chunks are valid.

| chunk | page-manifest refs | carries @gltf-transform |
|---|---|---|
| `100-fa603eda00f9b364` — page-loaded, contains `new Worker(...)` | 2 | **no** |
| `463.7e370bb832a438dc` — worker entry | **0** | references `df95f485` |
| `870.c8dc954f1a2c1001` | **0** | yes |
| `df95f485.309a5b71d9c48dc2` | **0** | yes |

`grep -rl sharp .next/static/chunks/` → no matches.

Webpack compiled the worker to `new Worker(a.tu(new URL(a.p+a.u(463)...)))`, so chunk 463 is
genuinely reachable rather than orphaned. The main bundle carries only the launcher and the
Worker construction; the heavy dependency loads solely inside the worker, as required.

Still outstanding: Step 6 (upload the reference file through the running app) needs a browser
and credentials. Controller-driven, not done here.

---

## Hardening — runOptimize brought inside the try

**Status:** DONE

Restructured the optimization block in `lib/useUpload.ts` (lines 87–130) to enforce the
global constraint "optimization must never block or fail an upload" with a defensive,
locally-visible safety net.

### The change

`await runOptimize(entry.file)` was outside the try/catch that wraps the variant PUT.
If it ever rejected, the exception would skip the `patch(entry.path, { state: 'uploading' })`
restoration, propagate to the outer catch, and mark the whole upload `'failed'` — even
though the original file is already safely in S3.

Restructured using `try { await runOptimize(...); ... } catch { ... } finally { patch(...) }`:
- The entire optimization block (including `runOptimize`) is now inside one try.
- State restoration moved to finally, so it cannot be skipped on any error path.
- A new outer catch logs optimization failures and clears the variant flag, preventing
  them from reaching the outer upload catch.
- Behavior is identical to before: `hasOptimizedVariant` ends up `false` on any failure,
  state always returns to `'uploading'`, control always reaches `/api/files/complete`.

Updated the comment to say the invariant is enforced *here*, not inherited from the
property of a different file.

### Files changed

- `lib/useUpload.ts` — optimization block restructured with try/finally, lines 87–130
- `docs/superpowers/plans/2026-08-24-model-import-optimization.md` — Task 6 Step 3
  code block updated to match

### Verification

- `npx tsc --noEmit` → clean, no errors
- `npm test` → 175 passing, 0 failing (no regressions)

### Commit

`<commit-sha>` — `fix(upload): bring runOptimize inside try/finally to enforce state restoration`
