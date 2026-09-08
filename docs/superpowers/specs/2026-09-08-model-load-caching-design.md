# Model load caching

**Date:** 2026-09-08
**Status:** Approved, not yet implemented
**Scope:** Phase A only. Phase B is sketched at the end and is not part of this spec.

## Problem

Switching between 3D files is slow, and — the part that gives the cause away —
re-opening a file you looked at a minute ago costs exactly as much as opening it
the first time. Nothing is cached, anywhere, at any layer.

## Evidence

Measured against the production bucket on 2026-09-08:

- 62 model objects. Source sizes p50 **3 MB**, p90 **22 MB**, largest **93.6 MB**.
- **No `Cache-Control` on any object.** Nothing was ever uploaded with one.
- A typical version holds 15+ models and can run to GBs.

The heaviest files are also the least optimized. STL never had a viewer variant,
and upload-time STEP tessellation was switched off on 2026-09-03 (the kill-switch
comment in `app/api/files/upload/route.ts`), so a 94 MB STL and a 52 MB STEP both
load raw — and STEP re-runs OCCT tessellation in the browser on *every* open.
`2026-09-04-download-authorization-design.md` recorded 9 of 99 files with a
converted variant; that ratio has not improved.

## Root cause

**Every file switch mints a brand-new presigned URL.**
`components/viewers/ViewerContainer.tsx:105` refetches `/api/files/url` whenever
`viewerKey` changes, and `getDownloadPresignedUrl` signs a fresh `X-Amz-Date` and
`X-Amz-Signature` on each call. A different query string is a different URL, and a
different URL is a different cache key. So:

- the **browser HTTP cache** never hits — all the bytes come down again;
- **`useLoader`'s cache** (`components/viewers/ModelViewerInner.tsx:186`) is keyed
  by URL, so it never hits either, and the model is re-parsed from scratch;
- `key={viewerKey}` on `ModelErrorBoundary` tears the scene down and rebuilds it.

Go A → B → A and A costs full price the second time.

### The same fault is also a live memory leak

`useLoader` *does* cache parsed models — permanently. `lib/model/partTree.ts:87`
states it outright: the tree is "kept alive across mounts by `suspend-react` with
no lifespan and no `useLoader.clear()` call anywhere in this repo."

So the current behaviour is the worst of both. The cache never hits, because the
key always changes; and nothing is ever freed, because nothing ever clears it.
Every model opened in a session stays fully parsed — geometries, materials,
textures, GPU buffers — for the life of the tab. Twelve switches through a heavy
version retains twelve models. This is a plausible contributor to the
`THREE.WebGLRenderer: Context Lost` failures already seen under memory pressure.

Bounded eviction is therefore not a nicety attached to the caching work. Making
the cache *hit* without also making it *bounded* would turn a leak that is at
least bounded by the number of files opened into one that is genuinely unbounded.

## What Phase A does and does not fix

**Fixes:** re-opening any file already opened this session is instant — no
download, no re-parse. The leak is bounded.

**Does not fix:** the first open of a file. Downloads still cost what the bytes
cost. Prefetching, and restoring the STL/STEP variants, are separate work and are
deliberately not here.

## Design

### 1. Cache identity

A **new** `getViewerPresignedUrl` function is added to `lib/s3.ts`, rather than
changing `getDownloadPresignedUrl` in place. `getDownloadPresignedUrl` is deliberately
left untouched: it also serves comment snapshots, comment attachments, conversion
retries and the download route, none of which wants a stable URL, and the download
route varies `ResponseContentDisposition` per request, which would defeat stability
outright. `getViewerPresignedUrl` gains a **quantized signing date**. The
signing timestamp is floored to the wall-clock hour and passed as
`signingDate`, with `expiresIn` raised to 7200:

```ts
const URL_WINDOW_MS = 60 * 60 * 1000;
const windowStart = new Date(Math.floor(now / URL_WINDOW_MS) * URL_WINDOW_MS);
```

The same key then produces a **byte-identical URL for the whole hour**, so the
browser disk cache and `useLoader` both hit on re-open. Verified against the real
SDK: identical at +0, +15 min and +59:59; different in the next window; different
for a different key.

`expiresIn: 7200` against a 1-hour window guarantees **at least 3600s of remaining
life** on any URL handed out — exactly today's guarantee. The cost is that the
worst-case lifetime of a leaked URL goes from 1h to 2h.

Be precise about which number matters for what, because it is easy to get backwards.
The **floor** (unchanged at 1h) is an availability property: it guarantees a URL still
works for as long as it may be handed out. **Revocation is governed by the ceiling**,
and the ceiling doubles — after access is withdrawn, an already-issued URL keeps
working for up to 2h instead of 1h. The URL is also byte-identical for every
authorized user, so a link leaked in a screenshot or a log is a shared capability for
that window rather than a per-user one.

Accepted deliberately: this app's threat model already tolerated an hour, invites and
download authorization gate the *issuing* of URLs rather than the bytes (see
`2026-09-04-download-authorization-design.md`, which makes the same point), and the
alternative — per-user sliding windows — reintroduces exactly the key churn this spec
exists to remove.

The command also sets `ResponseCacheControl: 'private, max-age=3600, immutable'`.
This is a signed query parameter, so it is deterministic and does not disturb URL
stability, and it works **without re-uploading any object** — which matters,
because none of the 62 existing objects has a `Cache-Control` today.

- `private`, not `public`: these are per-user authorized URLs and no shared cache
  should ever hold one.
- `immutable` is honest here: upload keys are `uploads/<project>/<portal>/<version>/<fileId><ext>`
  with a fresh `fileId` per upload, so an object is never overwritten in place.

Only the viewer path changes. `app/api/files/[id]/download/route.ts` keeps
per-request signing: it is one-shot, and it varies `ResponseContentDisposition`
per request, so a stable URL would buy nothing.

**Boundary behaviour.** A file opened at 12:59 gets a URL that changes at 13:00,
costing one re-download. This is inherent to fixed windows and is accepted; the
alternative — per-user sliding windows — reintroduces exactly the key churn this
spec exists to remove.

### 2. Bounded eviction

New module `lib/model/modelCache.ts`, holding an LRU keyed by URL.

`ModelViewerInner` registers each model once loaded:
`{ url, loader, root, bytes }`. On each registration the registry evicts the
coldest entries until retained source bytes fall under a **300 MB** budget.

`bytes` comes from `FileRecord.fileSize` (`lib/types.ts:49`), threaded
`ViewerContainer` → `ModelViewer` → `ModelViewerInner`. `ModelViewer` already
spreads `ModelViewerInnerProps`, so this is one added prop and no new plumbing.

Note what that number is: `fileSize` is the size of the **original**, while the
viewer loads `convertedStorageKey ?? storageKey` and therefore often loads a
smaller optimized variant. The variant's own size is not recorded anywhere. So
for any file with a variant, `bytes` **overestimates** what is actually retained.
That is the right direction to be wrong in — the budget evicts sooner than
strictly necessary — and it avoids both a schema change and threading a byte
count back out of the loader. Do not "correct" this to the variant's real size
without first deciding whether the budget should be measured in source bytes or
in resident GPU memory, which are not the same quantity and which this design
deliberately does not try to model. Eviction traverses the root disposing geometries,
materials and textures, then calls `useLoader.clear(loader, url)`.

`useLoader.clear` alone is not enough: it drops the `suspend-react` entry so the
tree can be collected, but GPU resources are only released by explicit `dispose()`.

Two invariants:

1. **Never evict the active model.**
2. **Always retain at least two**, so A → B → A is instant regardless of size.
   A single model larger than the budget is still retained while active; the
   budget bounds the tail, not the working set.

## Traps

**Clones share geometry with the cached root.** `partTree` deliberately returns a
wrapper around a *clone*, and `Object3D.clone()` shares geometry and material
references with its source. Disposing a root whose clones are still mounted blanks
the model on screen. This is safe only because eviction never touches the active
entry and clones die with the unmount — which makes rapid switching the scenario
most likely to break it, and the reason it gets an explicit test rather than an
argument.

**R2 must honour `response-cache-control`.** The whole of section 1 rests on it.
Verify against a real object before building anything else; it is a two-minute
check and everything downstream depends on the answer.

**Do not lower `expiresIn` below `2 × URL_WINDOW_MS`.** Doing so lets a URL minted
early in a window expire while still being handed out late in it, producing 403s
that look like an auth bug rather than a config one.

## Testing

Unit:

- `getViewerPresignedUrl` returns an identical URL for the same key twice in one
  window, and a different one across a boundary. Clock injected, no wall-clock
  dependence. `getDownloadPresignedUrl` is out of scope for this test — it is
  deliberately unchanged (see "Cache identity" above) and keeps signing fresh on
  every call.
- The signed URL always carries at least `URL_WINDOW_MS` of remaining life.
- Eviction selects the coldest entries, never the active one, and always leaves at
  least two.

Manual, in a browser, against a real version:

- A → B → A: the second open of A issues no network request for its bytes and
  renders without a visible load.
- Switch through a dozen heavy models: tab memory plateaus rather than climbing.
- Rapid A ⇄ B switching does not blank either model (the clone-disposal trap).

## Phase B — not this spec

Phase A's cross-session behaviour is a side effect of the browser's disk cache,
not a guarantee, and it resets at each window boundary. Phase B would fetch model
bytes through a helper keyed on the stable `storageKey`, demoting the presigned
URL to pure transport, and hold the bytes in Cache Storage under an explicit LRU
budget. Cache identity would then not depend on signing at all, and "instant in a
session tomorrow" becomes a real promise rather than a hopeful one.

Deferred because Phase A is ~30 lines against a few hundred, and it is worth
learning how much of the complaint Phase A alone removes before building a second
cache.

## Out of scope

- Prefetching, of neighbours or of anything else. At 15+ heavy models per version
  this risks GBs of background transfer, and it was explicitly rejected.
- First-open speed.
- Restoring STL and STEP viewer variants. This is the biggest available win for
  first opens and should be specced on its own.
