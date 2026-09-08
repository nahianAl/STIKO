# Model Load Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make re-opening an already-viewed 3D file instant, and bound the parsed-model cache that currently grows for the life of the tab.

**Architecture:** Presigned viewer URLs get a signing date quantized to the hour, so one key yields a byte-identical URL for the whole window — which is what lets the browser HTTP cache and `useLoader`'s parsed-model cache hit at all. A new `lib/model/modelCache.ts` holds an LRU over loaded models and disposes the coldest once retained bytes exceed a budget.

**Tech Stack:** Next.js App Router, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1010.0, three.js, `@react-three/fiber` 8.18.0, Cloudflare R2. Tests are `node --test` over `scripts/tests/*.mjs`, importing `.ts` sources directly.

**Spec:** `docs/superpowers/specs/2026-09-08-model-load-caching-design.md`

## Global Constraints

- Node `>=22.11.0` (see `package.json` engines).
- Tests run with `npm test` → `node --test scripts/tests/*.mjs`. Test files are `.mjs` and import `.ts` sources directly (`../../lib/foo.ts`).
- `lib/s3.ts` **throws at import time** when the R2 env vars are absent. Pure logic that needs unit tests goes in its own module, following the precedent set by `lib/storageKeys.ts`. A test that must import `lib/s3.ts` sets fake `R2_*` env vars *before* a dynamic `await import()`.
- `URL_WINDOW_MS` is 1 hour. `expiresIn` for viewer URLs is exactly `2 × URL_WINDOW_MS`. Never lower it below that ratio.
- Eviction budget is 300 MB of source bytes; minimum retained entries is 2.
- Do not touch `getDownloadPresignedUrl`. It serves comments, attachments, conversions and the download route, and none of them want a stable URL.

---

### Task 1: Verify R2 honours `response-cache-control`

Everything in Task 3 rests on this. It is a read-only check against a real object and it is a hard gate: if R2 ignores the override, stop and re-open the spec.

**Files:**
- Create: `scripts/tests/manual/verifyCacheControl.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a go/no-go answer for Task 3. No exported code.

- [ ] **Step 1: Write the verification script**

```javascript
// scripts/tests/manual/verifyCacheControl.mjs
//
// Manual, read-only. Confirms R2 honours the response-cache-control override on a
// presigned GET. Run once before implementing the viewer URL change.
//
//   node scripts/tests/manual/verifyCacheControl.mjs
import { readFileSync } from 'node:fs';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const listed = await s3.send(
  new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, Prefix: 'uploads/', MaxKeys: 200 })
);
const target = (listed.Contents || []).find((o) => /\.glb$/i.test(o.Key));
if (!target) throw new Error('no .glb object found to test against');

const url = await getSignedUrl(
  s3,
  new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: target.Key,
    ResponseCacheControl: 'private, max-age=3600, immutable',
  }),
  { expiresIn: 300 }
);

// A Range GET, not a HEAD: SigV4 signs the HTTP METHOD, so a HEAD against a URL
// presigned for GET is a signature mismatch and 403s — which looks exactly like
// "R2 rejected the override" and is not. Extra REQUEST headers are fine, because
// a presigned URL signs only `host` (X-Amz-SignedHeaders=host), so Range costs
// one byte instead of downloading a 90 MB object.
const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
const got = res.headers.get('cache-control');
console.log('key         :', target.Key);
console.log('status      :', res.status, '(206 expected — Range request)');
console.log('cache-control:', got ?? '(absent)');
// Gate on the status as well as the header. A 200 here would mean the Range never
// engaged, so the run just pulled a whole object and proved something other than what
// it claims to test — and a verdict that reads PASS on it would be lying.
console.log(
  res.status === 206 && got === 'private, max-age=3600, immutable'
    ? '\nPASS — R2 honours the override. Task 3 is safe to implement.'
    : '\nFAIL — R2 did not echo the override, or the Range did not engage. STOP and revisit the spec.'
);
```

- [ ] **Step 2: Run it**

Run: `mkdir -p scripts/tests/manual && node scripts/tests/manual/verifyCacheControl.mjs`

Expected: `status: 206` (partial content, because of the Range header) and `cache-control: private, max-age=3600, immutable`, ending in `PASS`.

A `403` here means the request method does not match what the URL was signed for — not that R2 rejected the override.

If it prints `FAIL`, stop. Do not continue to Task 3 — the design's cache-control half needs rethinking, and the plan should be revised before writing any more code.

- [ ] **Step 3: Commit**

```bash
git add scripts/tests/manual/verifyCacheControl.mjs
git commit -m "test: verify R2 honours response-cache-control overrides"
```

---

### Task 2: Signing window module

Pure timestamp quantization, in its own file so it can be unit tested. `lib/s3.ts` cannot be imported without R2 env vars, which is the same reason `lib/storageKeys.ts` exists apart from it.

**Files:**
- Create: `lib/urlWindow.ts`
- Test: `scripts/tests/urlWindow.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `URL_WINDOW_MS: number` (3600000) and `signingWindowStart(nowMs: number, windowMs?: number): Date`. Task 3 uses both.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/tests/urlWindow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URL_WINDOW_MS, signingWindowStart } from '../../lib/urlWindow.ts';

const HOUR = 60 * 60 * 1000;

test('the window is one hour', () => {
  assert.equal(URL_WINDOW_MS, HOUR);
});

test('a timestamp is floored to the start of its hour', () => {
  const aligned = Math.floor(1757318400000 / HOUR) * HOUR;
  assert.equal(signingWindowStart(aligned + 12345).getTime(), aligned);
});

test('two times in the same window floor to the same instant', () => {
  const aligned = Math.floor(1757318400000 / HOUR) * HOUR;
  assert.equal(
    signingWindowStart(aligned + 60_000).getTime(),
    signingWindowStart(aligned + 3_599_000).getTime()
  );
});

test('a time in the next window floors to a different instant', () => {
  const aligned = Math.floor(1757318400000 / HOUR) * HOUR;
  assert.notEqual(
    signingWindowStart(aligned + 3_599_000).getTime(),
    signingWindowStart(aligned + 3_601_000).getTime()
  );
});

test('an exact boundary belongs to the window it opens, not the one it closes', () => {
  const aligned = Math.floor(1757318400000 / HOUR) * HOUR;
  assert.equal(signingWindowStart(aligned).getTime(), aligned);
});

test('the window size is overridable, for tests that need a short one', () => {
  assert.equal(signingWindowStart(1000, 1000).getTime(), 1000);
  assert.equal(signingWindowStart(1999, 1000).getTime(), 1000);
  assert.equal(signingWindowStart(2000, 1000).getTime(), 2000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/urlWindow.test.mjs`
Expected: FAIL — `Cannot find module` for `../../lib/urlWindow.ts`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/urlWindow.ts
/**
 * Quantized signing windows for presigned viewer URLs.
 *
 * Deliberately NOT in lib/s3.ts: that module throws at import time when the R2 env
 * vars are absent, so nothing declared there can be unit tested. lib/storageKeys.ts
 * exists apart from it for exactly the same reason.
 */

/** One hour. A key yields a byte-identical viewer URL for the whole window. */
export const URL_WINDOW_MS = 60 * 60 * 1000;

/**
 * Floor a timestamp to the start of its signing window.
 *
 * Presigning against this instead of the current instant is the whole trick.
 * X-Amz-Date is the only per-call input to the signature that varies, so quantizing
 * it makes every call within a window produce an identical URL — and that URL string
 * is the cache key for both the browser's HTTP cache and useLoader's parsed-model
 * cache. A URL that changes per call silently defeats both.
 */
export function signingWindowStart(
  nowMs: number,
  windowMs: number = URL_WINDOW_MS
): Date {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/urlWindow.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/urlWindow.ts scripts/tests/urlWindow.test.mjs
git commit -m "feat: add quantized signing windows for presigned URLs"
```

---

### Task 3: Stable viewer presigned URL

A **new** function rather than a change to `getDownloadPresignedUrl`, which has four other callers — comments, attachments, conversion retry and the download route — none of which wants a stable URL and one of which varies `ResponseContentDisposition` per request anyway.

**Files:**
- Modify: `lib/s3.ts` (add `getViewerPresignedUrl`; leave `getDownloadPresignedUrl` untouched)
- Modify: `app/api/files/url/route.ts:2,40`
- Test: `scripts/tests/viewerUrl.test.mjs`

**Interfaces:**
- Consumes: `URL_WINDOW_MS`, `signingWindowStart` from Task 2.
- Produces: `getViewerPresignedUrl(storageKey: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/tests/viewerUrl.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/s3.ts throws at import time without these, so they must be set before the
// dynamic import below. The values are never used to talk to R2 — SigV4 signing is
// pure arithmetic over whatever credentials it is handed.
process.env.R2_ACCESS_KEY_ID = 'AKIAFAKEFAKEFAKE';
process.env.R2_SECRET_ACCESS_KEY = 'fakefakefakefakefakefakefake';
process.env.R2_ENDPOINT_URL = 'https://fake.r2.cloudflarestorage.com';
process.env.R2_BUCKET_NAME = 'stiko-uploads-test';

const { getViewerPresignedUrl } = await import('../../lib/s3.ts');
const { URL_WINDOW_MS } = await import('../../lib/urlWindow.ts');

const KEY = 'uploads/p/po/v/abc-123.glb';
const ALIGNED = Math.floor(1757318400000 / URL_WINDOW_MS) * URL_WINDOW_MS;

test('the same key yields a byte-identical URL across a whole window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED });
  const atStart = await getViewerPresignedUrl(KEY);
  t.mock.timers.setTime(ALIGNED + URL_WINDOW_MS - 1000);
  const atEnd = await getViewerPresignedUrl(KEY);
  assert.equal(atStart, atEnd);
});

test('the URL changes in the next window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED });
  const thisWindow = await getViewerPresignedUrl(KEY);
  t.mock.timers.setTime(ALIGNED + URL_WINDOW_MS + 1000);
  const nextWindow = await getViewerPresignedUrl(KEY);
  assert.notEqual(thisWindow, nextWindow);
});

test('different keys yield different URLs in the same window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED });
  const a = await getViewerPresignedUrl(KEY);
  const b = await getViewerPresignedUrl('uploads/p/po/v/def-456.glb');
  assert.notEqual(a, b);
});

test('a URL minted at the very end of a window still outlives the window', async (t) => {
  // The failure this guards against: sign at the window start, hand the URL out 59
  // minutes later, and it 403s in the user's face while it is still being served.
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED + URL_WINDOW_MS - 1000 });
  const url = new URL(await getViewerPresignedUrl(KEY));
  const signedAt = url.searchParams.get('X-Amz-Date');
  const expiresIn = Number(url.searchParams.get('X-Amz-Expires'));

  // X-Amz-Date is ISO8601 basic: 20260908T070000Z
  const m = signedAt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const signedMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const remaining = signedMs + expiresIn * 1000 - Date.now();
  assert.ok(
    remaining >= URL_WINDOW_MS,
    `only ${remaining}ms of life left, expected at least ${URL_WINDOW_MS}ms`
  );
});

test('the URL carries the cache-control override', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: ALIGNED });
  const url = new URL(await getViewerPresignedUrl(KEY));
  assert.equal(
    url.searchParams.get('response-cache-control'),
    'private, max-age=3600, immutable'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/viewerUrl.test.mjs`
Expected: FAIL — `getViewerPresignedUrl is not a function`.

- [ ] **Step 3: Add the import to `lib/s3.ts`**

Change line 2 of `lib/s3.ts` from:

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
```

to:

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { URL_WINDOW_MS, signingWindowStart } from './urlWindow.ts';
```

- [ ] **Step 4: Add the function**

Insert into `lib/s3.ts` immediately **before** the existing `getDownloadPresignedUrl`:

```typescript
// Generate a presigned URL for the VIEWER's render path.
//
// Differs from getDownloadPresignedUrl in one way, and it is the whole point: the
// signing date is quantized to the start of the current window, so the same key
// produces a byte-identical URL for an hour. A URL string is the cache key for BOTH
// the browser's HTTP cache and useLoader's parsed-model cache, so the old behaviour —
// a fresh signature per call — meant a model the user merely returned to was
// re-downloaded and re-parsed every single time, while the previous parse was never
// freed. See docs/superpowers/specs/2026-09-08-model-load-caching-design.md.
//
// expiresIn is deliberately TWICE the window. A URL minted at the last second of a
// window is still being handed out then, so anything shorter would 403 while in use.
// The floor on remaining life is therefore exactly URL_WINDOW_MS — the same one hour
// the unquantized version guaranteed, so revocation timing does not get weaker.
//
// Deliberately NOT folded into getDownloadPresignedUrl: that function also serves
// comment snapshots, comment attachments, conversion retries and the download route.
// None of them wants a stable URL, and the download route varies
// ResponseContentDisposition per request, which would defeat stability anyway.
export async function getViewerPresignedUrl(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    // Signed into the URL, so this needs no re-upload of the objects already in the
    // bucket — none of which carries a Cache-Control of its own. `private` because
    // these URLs are authorized per user and no shared cache should ever hold one.
    // `immutable` is honest: an upload key carries a fresh fileId per upload and is
    // never overwritten in place.
    ResponseCacheControl: `private, max-age=${URL_WINDOW_MS / 1000}, immutable`,
  });
  return getSignedUrl(s3, command, {
    expiresIn: (2 * URL_WINDOW_MS) / 1000,
    signingDate: signingWindowStart(Date.now()),
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/tests/viewerUrl.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Point the viewer route at it**

In `app/api/files/url/route.ts`, change line 2 from:

```typescript
import { getDownloadPresignedUrl } from '@/lib/s3';
```

to:

```typescript
import { getViewerPresignedUrl } from '@/lib/s3';
```

and line 40 from:

```typescript
  const url = await getDownloadPresignedUrl(storageKey);
```

to:

```typescript
  const url = await getViewerPresignedUrl(storageKey);
```

- [ ] **Step 7: Verify nothing else moved**

Run: `grep -rn "getDownloadPresignedUrl" --include="*.ts" app lib | grep -v node_modules`
Expected: exactly four call sites remain — `app/api/comments/route.ts` (two), `app/api/conversions/retry/route.ts`, `app/api/files/[id]/download/route.ts` — plus the declaration in `lib/s3.ts`. `app/api/files/url/route.ts` must **not** appear.

- [ ] **Step 8: Run the whole suite and build**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 9: Commit**

```bash
git add lib/s3.ts app/api/files/url/route.ts scripts/tests/viewerUrl.test.mjs
git commit -m "feat: give viewer presigned URLs a stable cache identity"
```

---

### Task 4: Eviction policy

Pure function, no three.js and no React, so the policy that decides what gets destroyed is testable on its own.

**Files:**
- Create: `lib/model/modelCache.ts`
- Test: `scripts/tests/modelCache.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `BUDGET_BYTES: number`, `MIN_RETAINED: number`, `interface CacheEntry { url: string; bytes: number; lastUsed: number }`, and `selectEvictions(entries: CacheEntry[], activeUrl: string, budgetBytes?: number, minRetained?: number): string[]`. Task 5 uses all four.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/tests/modelCache.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEvictions, BUDGET_BYTES, MIN_RETAINED } from '../../lib/model/modelCache.ts';

const MB = 1024 * 1024;
const e = (url, mb, lastUsed) => ({ url, bytes: mb * MB, lastUsed });

test('the defaults match the spec', () => {
  assert.equal(BUDGET_BYTES, 300 * MB);
  assert.equal(MIN_RETAINED, 2);
});

test('nothing is evicted when everything fits', () => {
  const entries = [e('a', 10, 3), e('b', 10, 2), e('c', 10, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), []);
});

test('an empty cache evicts nothing', () => {
  assert.deepEqual(selectEvictions([], 'a'), []);
});

test('the coldest entries go once the budget is blown', () => {
  const entries = [e('a', 100, 4), e('b', 100, 3), e('c', 100, 2), e('d', 100, 1)];
  // a + b + c = 300MB exactly, which fits. d does not.
  assert.deepEqual(selectEvictions(entries, 'a'), ['d']);
});

test('once over budget, every colder entry goes — no cherry-picking a small one', () => {
  // The fixture must leave real HEADROOM after the minRetained cutoff, or it cannot
  // tell the two algorithms apart. a+b retain 200MB of the 300MB budget, leaving
  // 100MB free. 'c' at 150MB does not fit, so it trips the cascade. 'd' at 50MB
  // WOULD fit in that headroom, so a "keep whatever still fits" implementation
  // retains it and returns ['c']; only the strictly-ordered cascade returns
  // ['c','d'].
  //
  // An earlier fixture here used 150/150/150/1 MB, where a+b came to EXACTLY the
  // budget. With zero headroom both algorithms return ['c','d'], so the test passed
  // against the very regression it existed to catch.
  const entries = [e('a', 100, 4), e('b', 100, 3), e('c', 150, 2), e('d', 50, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), ['c', 'd']);
});

test('the active model is never evicted, even when it is the coldest', () => {
  const entries = [e('a', 200, 1), e('b', 200, 4), e('c', 200, 3)];
  const evicted = selectEvictions(entries, 'a');
  assert.ok(!evicted.includes('a'), 'the active model must survive');
});

test('at least MIN_RETAINED entries survive even when both blow the budget', () => {
  // Two 400MB models are over budget together, but A -> B -> A must still be
  // instant, so both are kept.
  const entries = [e('a', 400, 2), e('b', 400, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), []);
});

test('a single model larger than the whole budget is still retained while active', () => {
  const entries = [e('huge', 900, 1)];
  assert.deepEqual(selectEvictions(entries, 'huge'), []);
});

test('the budget and floor are overridable', () => {
  const entries = [e('a', 10, 3), e('b', 10, 2), e('c', 10, 1)];
  assert.deepEqual(selectEvictions(entries, 'a', 15 * MB, 1), ['b', 'c']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/modelCache.test.mjs`
Expected: FAIL — `Cannot find module` for `../../lib/model/modelCache.ts`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/model/modelCache.ts
/**
 * A bounded LRU over the models useLoader has parsed.
 *
 * Why this exists at all: useLoader caches parsed models through suspend-react with
 * NO lifespan, and this repo never called useLoader.clear() — see the note in
 * lib/model/partTree.ts. Combined with a presigned URL that changed on every call,
 * that produced the worst of both worlds: a cache that never hit, and never freed.
 * Every model opened stayed fully resident — geometries, materials, textures, GPU
 * buffers — for the life of the tab.
 *
 * Task 3 made the cache hit. This makes it bounded. Doing only the first would turn
 * a leak bounded by "files opened" into an unbounded one.
 */

/** Retained source bytes above which the coldest models are dropped. */
export const BUDGET_BYTES = 300 * 1024 * 1024;

/**
 * Never retain fewer than this, whatever the budget says. Two is the floor because
 * A -> B -> A is the exact journey this whole change exists to make instant.
 */
export const MIN_RETAINED = 2;

export interface CacheEntry {
  url: string;
  bytes: number;
  lastUsed: number;
}

/**
 * Decide which entries to evict, most-recently-used first.
 *
 * Eviction is strictly ordered: once the running total exceeds the budget, every
 * colder entry goes too. The alternative — keep any entry that still happens to fit —
 * makes survival depend on file size rather than recency, so a small model opened
 * once long ago outlives a large one opened moments before.
 */
export function selectEvictions(
  entries: CacheEntry[],
  activeUrl: string,
  budgetBytes: number = BUDGET_BYTES,
  minRetained: number = MIN_RETAINED
): string[] {
  const ordered = [...entries].sort((a, b) => {
    // The active model sorts first unconditionally. It is normally the most recently
    // used anyway; pinning it here means a caller that registers out of order, or a
    // clock that has not advanced, still cannot destroy what is on screen.
    if (a.url === activeUrl) return -1;
    if (b.url === activeUrl) return 1;
    return b.lastUsed - a.lastUsed;
  });

  const evict: string[] = [];
  let retained = 0;
  let overBudget = false;

  ordered.forEach((entry, index) => {
    if (index < minRetained) {
      retained += entry.bytes;
      return;
    }
    if (overBudget || retained + entry.bytes > budgetBytes) {
      overBudget = true;
      evict.push(entry.url);
      return;
    }
    retained += entry.bytes;
  });

  return evict;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/modelCache.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/model/modelCache.ts scripts/tests/modelCache.test.mjs
git commit -m "feat: add the model cache eviction policy"
```

---

### Task 5: Registry and disposal

`useLoader.clear` drops the suspend-react entry so the tree can be collected, but GPU resources are released only by explicit `dispose()`. Both halves are needed.

**Files:**
- Modify: `lib/model/modelCache.ts`
- Modify: `scripts/tests/modelCache.test.mjs`

**Interfaces:**
- Consumes: `selectEvictions`, `BUDGET_BYTES`, `MIN_RETAINED`, `CacheEntry` from Task 4.
- Produces: `disposeTree(root: unknown): void`, `registerModel(args: RegisterArgs): void`, `resetModelCacheForTests(): void`, and `interface RegisterArgs { url: string; loader: unknown; root: unknown; bytes: number; clearLoaderCache: (loader: unknown, url: string) => void }`. Task 6 calls `registerModel`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tests/modelCache.test.mjs`:

```javascript
import * as THREE from 'three';
import {
  registerModel,
  disposeTree,
  resetModelCacheForTests,
} from '../../lib/model/modelCache.ts';

/** A model whose disposals are observable. three fires a 'dispose' event on each. */
function fakeModel(fired) {
  const geometry = new THREE.BufferGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  geometry.addEventListener('dispose', () => fired.push('geometry'));
  material.addEventListener('dispose', () => fired.push('material'));
  texture.addEventListener('dispose', () => fired.push('texture'));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  return root;
}

test('disposeTree releases geometry, material and texture', () => {
  const fired = [];
  disposeTree(fakeModel(fired));
  assert.deepEqual(fired.sort(), ['geometry', 'material', 'texture']);
});

test('disposeTree survives a root with no geometry or material', () => {
  assert.doesNotThrow(() => disposeTree(new THREE.Group()));
});

test('disposeTree releases a bare BufferGeometry, which STL and PLY loaders return', () => {
  // STLLoader and PLYLoader resolve to a BufferGeometry, not an Object3D: it has
  // dispose() but no traverse(), so it takes the early-return branch. A THREE.Group
  // does NOT cover this — a Group has traverse() and never reaches that path. Without
  // a test here, deleting the branch frees nothing on exactly the heaviest files in
  // the bucket, where .stl runs to 94 MB.
  let fired = false;
  const geometry = new THREE.BufferGeometry();
  geometry.addEventListener('dispose', () => { fired = true; });
  disposeTree(geometry);
  assert.ok(fired, 'a bare BufferGeometry must be disposed');
});

test('disposeTree handles an array of materials', () => {
  const fired = [];
  const geometry = new THREE.BufferGeometry();
  const a = new THREE.MeshBasicMaterial();
  const b = new THREE.MeshBasicMaterial();
  a.addEventListener('dispose', () => fired.push('a'));
  b.addEventListener('dispose', () => fired.push('b'));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, [a, b]));
  disposeTree(root);
  assert.deepEqual(fired.sort(), ['a', 'b']);
});

test('registering under budget evicts and disposes nothing', () => {
  resetModelCacheForTests();
  const cleared = [];
  const fired = [];
  for (const url of ['a', 'b', 'c']) {
    registerModel({
      url,
      loader: 'GLTFLoader',
      root: fakeModel(fired),
      bytes: 10 * MB,
      clearLoaderCache: (loader, u) => cleared.push(u),
    });
  }
  assert.deepEqual(cleared, []);
  assert.deepEqual(fired, []);
});

test('registering over budget clears and disposes the coldest', () => {
  resetModelCacheForTests();
  const cleared = [];
  const fired = [];
  for (const url of ['a', 'b', 'c', 'd']) {
    registerModel({
      url,
      loader: 'GLTFLoader',
      root: fakeModel(fired),
      bytes: 100 * MB,
      clearLoaderCache: (loader, u) => cleared.push(u),
    });
  }
  // On registering 'd': a,b,c,d = 400MB. Newest three fit in 300MB; 'a' does not.
  assert.deepEqual(cleared, ['a']);
  assert.deepEqual(fired.sort(), ['geometry', 'material', 'texture']);
});

test('re-registering an existing url refreshes it instead of duplicating it', () => {
  resetModelCacheForTests();
  const cleared = [];
  const fired = [];
  const reg = (url) =>
    registerModel({
      url,
      loader: 'GLTFLoader',
      root: fakeModel(fired),
      bytes: 100 * MB,
      clearLoaderCache: (loader, u) => cleared.push(u),
    });
  // a -> b -> c -> a. The revisit to 'a' makes it the newest, so the next
  // registration must drop 'b', the coldest — not 'a'.
  reg('a'); reg('b'); reg('c'); reg('a'); reg('d');
  assert.ok(!cleared.includes('a'), 'a was revisited and must not be evicted');
  assert.deepEqual(cleared, ['b']);
});

test('the model just registered is never the one evicted', () => {
  resetModelCacheForTests();
  const cleared = [];
  const fired = [];
  registerModel({
    url: 'huge',
    loader: 'GLTFLoader',
    root: fakeModel(fired),
    bytes: 900 * MB,
    clearLoaderCache: (loader, u) => cleared.push(u),
  });
  assert.deepEqual(cleared, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/modelCache.test.mjs`
Expected: FAIL — `registerModel is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/model/modelCache.ts`:

```typescript
/** Minimal shape of what a loader hands back. Avoids importing three here. */
interface DisposableNode {
  geometry?: { dispose?: () => void };
  material?: unknown;
}

interface TraversableRoot {
  traverse?: (visit: (node: DisposableNode) => void) => void;
  dispose?: () => void;
}

/**
 * Release the GPU resources held by a loaded model.
 *
 * useLoader.clear() alone is not enough: it drops the suspend-react entry so the
 * JS objects can be collected, but geometries, materials and textures hold GPU
 * allocations that only dispose() frees.
 *
 * STL and PLY loaders return a bare BufferGeometry rather than an Object3D, which
 * has a dispose() but no traverse() — hence both branches.
 */
export function disposeTree(root: unknown): void {
  const node = root as TraversableRoot;
  if (typeof node?.traverse !== 'function') {
    node?.dispose?.();
    return;
  }
  node.traverse((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      const m = material as Record<string, unknown> & { dispose?: () => void };
      // Textures are separate GPU allocations and are not freed by the material.
      for (const value of Object.values(m)) {
        const maybeTexture = value as { isTexture?: boolean; dispose?: () => void };
        if (maybeTexture?.isTexture) maybeTexture.dispose?.();
      }
      m.dispose?.();
    }
  });
}

export interface RegisterArgs {
  url: string;
  loader: unknown;
  root: unknown;
  bytes: number;
  /**
   * How to drop the entry from useLoader's cache. Injected rather than imported so
   * this module never pulls in @react-three/fiber, which keeps it importable — and
   * therefore testable — under plain `node --test`.
   */
  clearLoaderCache: (loader: unknown, url: string) => void;
}

interface Registered {
  loader: unknown;
  root: unknown;
  bytes: number;
  lastUsed: number;
}

const registry = new Map<string, Registered>();

/**
 * A monotonic counter, not a clock. Two models registered in the same millisecond
 * must still order deterministically, and Date.now() cannot promise that.
 */
let useCounter = 0;

/**
 * Record a freshly loaded model and evict whatever no longer fits.
 *
 * Safe to call on every render: re-registering a url refreshes its recency in place
 * rather than adding a second entry, and the just-registered url is pinned against
 * eviction, so the model on screen is never disposed out from under itself.
 *
 * Note it DOES replace the stored root/bytes/loader for that url. That is harmless
 * only because the caller re-registers with useLoader's cached value for the same
 * url, which is the same object reference; a caller that passed a genuinely different
 * root would leak the old one's GPU memory.
 */
export function registerModel({ url, loader, root, bytes, clearLoaderCache }: RegisterArgs): void {
  registry.set(url, { loader, root, bytes, lastUsed: ++useCounter });

  const entries: CacheEntry[] = [...registry.entries()].map(([entryUrl, entry]) => ({
    url: entryUrl,
    bytes: entry.bytes,
    lastUsed: entry.lastUsed,
  }));

  for (const victim of selectEvictions(entries, url)) {
    const entry = registry.get(victim);
    if (!entry) continue;
    // Order matters: dispose while we still hold the tree, then drop the cache entry.
    //
    // Disposing is only safe because the victim is never the active model, and
    // partTree's clones — which SHARE geometry with this root — die with the unmount
    // of the model that made them. A victim that was somehow still mounted would go
    // blank rather than error, which is why the active url is pinned in
    // selectEvictions rather than merely sorted to the front.
    disposeTree(entry.root);
    clearLoaderCache(entry.loader, victim);
    registry.delete(victim);
  }
}

/** Test seam. Module state would otherwise leak between test cases. */
export function resetModelCacheForTests(): void {
  registry.clear();
  useCounter = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/modelCache.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/model/modelCache.ts scripts/tests/modelCache.test.mjs
git commit -m "feat: bound the parsed-model cache with disposal"
```

---

### Task 6: Wire the cache into the viewer

**Files:**
- Modify: `components/viewers/ViewerContainer.tsx` (the `<ModelViewer>` render, ~line 160)
- Modify: `components/viewers/ModelViewerInner.tsx:83` (props), `:167` (the `Model` component), `:809` (destructure), `:1016` (the `<Model>` render)

**Interfaces:**
- Consumes: `registerModel` from Task 5; `FileRecord.fileSize` from `lib/types.ts:49`.
- Produces: no new exports. `ModelViewerInnerProps` gains a required `bytes: number`.

- [ ] **Step 1: Add the prop to `ModelViewerInnerProps`**

In `components/viewers/ModelViewerInner.tsx`, immediately after `url: string;` at line 84, add:

```typescript
  /**
   * Source size of the file being displayed, for the model cache's eviction budget.
   *
   * This is the ORIGINAL's size while the viewer may be loading a smaller optimized
   * variant, so it overestimates. That is the safe direction — the budget evicts
   * sooner than strictly necessary — and it avoids both a schema change and threading
   * a byte count back out of the loader.
   */
  bytes: number;
```

- [ ] **Step 2: Import the cache and thread the prop**

In `components/viewers/ModelViewerInner.tsx`, add to the imports near the top:

```typescript
import { registerModel } from '@/lib/model/modelCache';
```

At line 809, add `bytes,` to the destructured props, immediately after `url,`:

```typescript
export default function ModelViewerInner({
  url,
  bytes,
  commentToolActive = false,
```

At the `<Model>` render (line ~1016), add the prop:

```tsx
                <Model
                  url={url}
                  bytes={bytes}
                  partColors={partColors}
                  hiddenParts={hiddenParts}
                  highlightedPart={highlightedPart}
                  onPartsLoaded={onPartsLoaded}
                  onBatchesReady={setBatches}
                />
```

- [ ] **Step 3: Register the model once loaded**

In the `Model` component (line 167), add `bytes` to both the destructuring and its type:

```typescript
function Model({
  url,
  bytes,
  partColors,
  hiddenParts,
  highlightedPart,
  onPartsLoaded,
  onBatchesReady,
}: {
  url: string;
  bytes: number;
  partColors: Record<string, string>;
```

Then immediately after the `useLoader` call at line 186, add:

```typescript
  // Register with the bounded cache the moment the parse resolves. useLoader keeps
  // this tree alive forever on its own — no lifespan, and nothing in this repo used
  // to clear it — so without this every model opened stays resident for the life of
  // the tab. Re-running on the same url merely refreshes recency.
  useEffect(() => {
    registerModel({
      url,
      loader: LoaderClass,
      root: data,
      bytes,
      clearLoaderCache: (loader, cachedUrl) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useLoader.clear(loader as any, cachedUrl),
    });
  }, [url, LoaderClass, data, bytes]);
```

`useEffect` is already imported at `components/viewers/ModelViewerInner.tsx:5`, so no import change is needed here.

- [ ] **Step 4: Pass the size from `ViewerContainer`**

In `components/viewers/ViewerContainer.tsx`, in the `MODEL_EXTENSIONS` branch, add the prop to `<ModelViewer>`:

```tsx
        <ModelViewer
          url={url}
          bytes={file.fileSize}
          commentToolActive={commentToolActive}
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds. A missing `bytes` on any `<ModelViewer>` call site fails here by design — the prop is required so a caller cannot silently opt out of the budget.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx components/viewers/ViewerContainer.tsx
git commit -m "feat: register loaded models with the bounded cache"
```

---

### Task 7: Verify in a browser

Automated tests cover the policy and the URL. They cannot show that a re-open is actually free, which is the entire point of the change.

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Open a package with at least three 3D files, at least one of them 20 MB or larger.

- [ ] **Step 2: Confirm the re-open is free**

Open DevTools → Network, filter to the R2 host, and disable "Disable cache".

1. Open file A. Watch the full download.
2. Open file B.
3. Open file A again.

Expected: the third step issues **no new network request** for A's bytes, or shows one served `(from disk cache)`. A appears without a visible load.

Expected in Network: the request URL for A is **character-for-character identical** between steps 1 and 3. If it differs, Task 3 did not take effect and nothing downstream will work.

- [ ] **Step 3: Confirm memory plateaus**

In DevTools → Memory, take a heap snapshot. Switch through a dozen models, including the heaviest. Take a second snapshot.

Expected: retained size levels off rather than climbing with each switch. Before this change it climbed monotonically.

- [ ] **Step 4: Exercise the clone-disposal trap**

Switch A ⇄ B rapidly, twenty times, without waiting for each to settle.

Expected: both models render correctly every time. A model that renders **blank** — geometry gone, no console error — means a root was disposed while its `partTree` clones were still mounted. That is the sharpest failure mode in this design; if it appears, stop and revisit `selectEvictions`' pinning of the active url.

- [ ] **Step 5: Confirm the parts panel still works**

With a STEP or multi-part GLB open, colour a part, hide a part, then switch away and back.

Expected: colours and visibility survive the round trip. This exercises `partTree`'s clones against a now-cached root, which is the interaction the disposal logic is most likely to break.

- [ ] **Step 6: Commit any fixes**

If steps 2-5 surfaced problems, fix and commit them before considering the plan done.

---

## Follow-ups, deliberately not in this plan

- **Comment snapshots and attachments** (`app/api/comments/route.ts:76,88`) still mint a fresh URL per request and would benefit from the same treatment. Out of scope here because the spec scoped this to the viewer path.
- **Phase B**: cache bytes under the stable `storageKey` in Cache Storage, so identity stops depending on signing at all and cross-session persistence becomes a guarantee rather than a side effect of the disk cache.
- **Restoring STL and STEP viewer variants** — the largest available win for *first* opens, and the reason a 94 MB STL is 94 MB.
