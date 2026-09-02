# STEP Viewing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make STEP files open in the viewer, converted once at upload rather than per viewer, and make every failure path end in a visible message instead of an indefinite loading indicator.

**Architecture:** STEP tessellation moves out of the main thread into a terminable Web Worker, reusing the pipeline that already converts and stores an optimized GLB variant at upload time. The viewer prefers the stored GLB; when none exists it tessellates in a worker under a timeout, and a new React error boundary turns any failure into a finished state.

**Tech Stack:** TypeScript, Next.js 14 (App Router), React 18, three.js r169, `occt-import-js` 0.0.23 (OpenCascade WASM), `@gltf-transform/core` 4.4, Node built-in test runner.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-02-step-viewing-design.md`. Read it before starting.
- Tessellation settings are exactly: `linearDeflectionType: 'bounding_box_ratio'`, `linearDeflection: 0.03`, `angularDeflection: 0.5`.
- Timeouts are exactly: upload-time conversion 120000 ms, viewer-time conversion 60000 ms.
- `MAX_STEP_BYTES` is exactly `50 * 1024 * 1024`.
- Tests are `.mjs` files under `scripts/tests/`, run with `npm test` (`node --test scripts/tests/*.mjs`). They import TypeScript directly with an explicit `.ts` extension, e.g. `from '../../lib/storageKeys.ts'`.
- Never write a `.env.local` into the checkout.
- Conversion failure must never fail an upload. Every failure path resolves `null` and the original is uploaded unchanged.
- The variant storage key is always DERIVED server-side, never accepted from the client. Preserve this.
- Run `npm run lint` AND `npx tsc --noEmit` before each commit. Lint and tests both pass on
  code that fails type-checking: `tsconfig.json` sets no `target` and no `downlevelIteration`,
  so iterator syntax (`for...of` over `.entries()`, spreading a `Set`) compiles under neither.
  `next build` type-checks, so a miss here breaks the deploy, not the test run.

---

### Task 1: Extension predicates for STEP variants

**Files:**
- Modify: `lib/storageKeys.ts`
- Test: `scripts/tests/storageKeys.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `TESSELLATABLE_EXTENSIONS: ReadonlySet<string>`, `isTessellatableFilename(filename: string): boolean`, `producesViewerVariant(filename: string): boolean`. `OPTIMIZABLE_EXTENSIONS` and `isOptimizableFilename` keep their current meaning and signatures.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tests/storageKeys.test.mjs`. Add the three new names to the existing import block at the top of that file so it reads:

```js
import {
  optimizedVariantKey,
  isOptimizableFilename,
  isTessellatableFilename,
  producesViewerVariant,
  TESSELLATABLE_EXTENSIONS,
} from '../../lib/storageKeys.ts';
```

Then append:

```js
test('STEP files are tessellatable but not optimizable', () => {
  // Two distinct predicates on purpose. isOptimizableFilename gates the gltf-transform
  // chain, which can only read binary GLB; isTessellatableFilename gates OCCT. Collapsing
  // them into one would send a .stp into WebIO.readBinary and throw on every upload.
  for (const name of ['clamp.stp', 'clamp.step', 'CLAMP.STP', 'a.b.step']) {
    assert.equal(isTessellatableFilename(name), true, name);
    assert.equal(isOptimizableFilename(name), false, name);
  }
});

test('producesViewerVariant covers both families and nothing else', () => {
  for (const name of ['m.glb', 'm.stp', 'm.step', 'M.GLB', 'M.STP']) {
    assert.equal(producesViewerVariant(name), true, name);
  }
  // .gltf is excluded for the reason documented on OPTIMIZABLE_EXTENSIONS; the rest have
  // no converter at all. An accidental `true` here presigns a variant URL that is never
  // used, which is harmless, but it also puts the file into the 'optimizing' UI state.
  for (const name of ['m.gltf', 'm.obj', 'm.stl', 'm.pdf', 'm.png', 'noext', '.stp']) {
    assert.equal(producesViewerVariant(name), false, name);
  }
});

test('the tessellatable set is exactly stp and step', () => {
  assert.deepEqual([...TESSELLATABLE_EXTENSIONS].sort(), ['step', 'stp']);
});

test('a .stp original yields a .optimized.glb variant', () => {
  // The suffix is reused deliberately: one variant key scheme, not two. The converted
  // STEP really is the object the viewer prefers, which is what the suffix means.
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.stp'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A5 'storageKeys'`
Expected: FAIL — `SyntaxError` or `isTessellatableFilename is not a function`, because the exports do not exist yet.

- [ ] **Step 3: Write minimal implementation**

In `lib/storageKeys.ts`, after the `isOptimizableFilename` function, add:

```ts
/**
 * STEP is tessellated by OCCT, not by the gltf-transform chain, so it is a SEPARATE
 * predicate from isOptimizableFilename rather than another member of that set. Both
 * produce the same `.optimized.glb` variant key, because both produce the object the
 * viewer should load instead of the original.
 */
export const TESSELLATABLE_EXTENSIONS: ReadonlySet<string> = new Set(['stp', 'step']);

export function isTessellatableFilename(filename: string): boolean {
  return TESSELLATABLE_EXTENSIONS.has(extensionOf(filename));
}

/** True when uploading this file should also produce a viewer variant. */
export function producesViewerVariant(filename: string): boolean {
  return isOptimizableFilename(filename) || isTessellatableFilename(filename);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, and no previously passing test now fails.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add lib/storageKeys.ts scripts/tests/storageKeys.test.mjs
git commit -m "feat(upload): recognise STEP as producing a viewer variant"
```

---

### Task 2: The conversion module

**Files:**
- Create: `lib/model/stepToGlb.ts`
- Modify: `types/occt-import-js.d.ts`
- Test: `scripts/tests/stepToGlb.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `stepToGlb(bytes: Uint8Array, options?: { locateFile?: (path: string) => string }): Promise<Uint8Array>` returning GLB bytes, and `STEP_TESSELLATION` (the settings object).

**Why `locateFile` is a parameter:** in the browser the WASM is served from `/occt-import-js.wasm` (copied there by the `postinstall` script). Node has no such URL, so the test must point OCCT at `node_modules`. Without this seam the conversion cannot be tested outside a browser at all.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/stepToGlb.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WebIO } from '@gltf-transform/core';
import { stepToGlb, STEP_TESSELLATION } from '../../lib/model/stepToGlb.ts';

// occt-import-js is a direct dependency, so its bundled test cube is always present. It is
// NOT vendored into this repo: it is third-party GrabCAD content. If the dependency ever
// moves the file, this test fails loudly, which is the correct outcome — silently skipping
// would leave the conversion path untested.
const OCCT_DIST = 'node_modules/occt-import-js/dist/';
const CUBE = 'node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp';

const locateFile = (p) => path.join(process.cwd(), OCCT_DIST, p);

test('the tessellation settings are the ones the spec fixed', () => {
  // These three numbers are the entire fix. A well-meaning "let's improve quality" edit
  // that restores OCCT's 0.001 default reintroduces a hang that no test would otherwise
  // catch, because the cube below is small enough to mesh fast at any setting.
  assert.equal(STEP_TESSELLATION.linearDeflectionType, 'bounding_box_ratio');
  assert.equal(STEP_TESSELLATION.linearDeflection, 0.03);
  assert.equal(STEP_TESSELLATION.angularDeflection, 0.5);
});

test('a STEP solid converts to a readable GLB with geometry', async () => {
  const glb = await stepToGlb(new Uint8Array(readFileSync(CUBE)), { locateFile });

  const doc = await new WebIO().readBinary(glb);
  const meshes = doc.getRoot().listMeshes();
  assert.ok(meshes.length >= 1, 'expected at least one mesh');

  const prim = meshes[0].listPrimitives()[0];
  const position = prim.getAttribute('POSITION');
  assert.ok(position.getCount() > 0, 'expected vertices');
  assert.ok(prim.getIndices().getCount() % 3 === 0, 'indices must form whole triangles');
  assert.ok(prim.getAttribute('NORMAL'), 'expected normals');

  // A cube is not degenerate: its bounds must have real extent on every axis.
  const min = position.getMin([]);
  const max = position.getMax([]);
  for (let i = 0; i < 3; i++) {
    assert.ok(max[i] - min[i] > 0, `axis ${i} has no extent`);
  }
});

test('one node per solid, so parts stay separately selectable', async () => {
  // The viewer's per-part selection and cross-section capping both depend on solids
  // arriving as distinct nodes rather than one merged blob.
  const glb = await stepToGlb(new Uint8Array(readFileSync(CUBE)), { locateFile });
  const doc = await new WebIO().readBinary(glb);
  assert.equal(
    doc.getRoot().listNodes().length,
    doc.getRoot().listMeshes().length
  );
});

test('a file that is not STEP at all rejects rather than returning empty geometry', async () => {
  await assert.rejects(
    () => stepToGlb(new Uint8Array([1, 2, 3, 4]), { locateFile }),
    /STEP/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -B2 -A8 stepToGlb | head -30`
Expected: FAIL — cannot resolve `../../lib/model/stepToGlb.ts`.

- [ ] **Step 3: Widen the OCCT type declaration**

Replace the whole of `types/occt-import-js.d.ts` with:

```ts
declare module 'occt-import-js' {
  /**
   * Triangulation parameters. Previously typed as `null` only, which made the settings the
   * viewer needs literally unrepresentable — that is how OCCT's 0.001 default ended up
   * shipping. See docs/superpowers/specs/2026-09-02-step-viewing-design.md.
   */
  export interface OcctImportParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }

  interface OcctMeshAttributes {
    position: { array: number[] };
    normal: { array: number[] };
  }

  interface OcctMesh {
    name?: string;
    index: { array: number[] };
    attributes: OcctMeshAttributes;
    color?: [number, number, number];
  }

  interface OcctResult {
    success: boolean;
    meshes: OcctMesh[];
  }

  interface OcctImportJs {
    ReadStepFile: (buffer: Uint8Array, params: OcctImportParams | null) => OcctResult;
  }

  interface OcctModuleOptions {
    locateFile?: (path: string, scriptDirectory: string) => string;
  }

  export default function (options?: OcctModuleOptions): Promise<OcctImportJs>;
}
```

- [ ] **Step 4: Write the conversion module**

Create `lib/model/stepToGlb.ts`:

```ts
import { Document, WebIO } from '@gltf-transform/core';
import type { OcctImportParams } from 'occt-import-js';

/**
 * STEP → GLB, and the only module in the codebase that knows OpenCascade exists.
 *
 * No DOM, no worker API, no React: it takes bytes and returns bytes, so it runs in a Web
 * Worker in the browser and directly under `node --test`.
 */

/**
 * The settings that make heavy CAD viewable.
 *
 * OCCT's own default is a bounding_box_ratio of 0.001 — a 0.33 mm chord error on the
 * reference file — which never returns on a 13.7 MB Rhino export whose 1223 faces are 887
 * NURBS patches. Measured on that file: 0.03 renders within 0.04% of the pixels of a
 * setting seven times finer, in 19.7 s instead of never.
 *
 * angularDeflection stays at OCCT's 0.5. It, not the linear term, is what keeps small
 * curved features smooth — it forces a minimum segment count around a cylinder regardless
 * of the linear setting. At 1.0 the reference file's handle visibly facets; at 0.3 nothing
 * visible is gained for 25% more time.
 */
export const STEP_TESSELLATION: OcctImportParams = {
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.03,
  angularDeflection: 0.5,
};

/** Matches the viewer's own default when a solid carries no colour of its own. */
const DEFAULT_COLOR: [number, number, number] = [0.53, 0.6, 0.67];

type OcctImportJs = Awaited<ReturnType<typeof import('occt-import-js').default>>;

let occtPromise: Promise<OcctImportJs> | null = null;

/**
 * The WASM is 7.6 MB and initialises in ~25 ms, so it is loaded once and reused. In the
 * browser it is served from /occt-import-js.wasm, copied there by the postinstall script;
 * tests pass a path into node_modules instead.
 */
function initOcct(locateFile?: (path: string) => string): Promise<OcctImportJs> {
  if (!occtPromise) {
    occtPromise = import('occt-import-js').then((mod) =>
      mod.default({ locateFile: locateFile ?? (() => '/occt-import-js.wasm') })
    );
  }
  return occtPromise;
}

export async function stepToGlb(
  bytes: Uint8Array,
  options: { locateFile?: (path: string) => string } = {}
): Promise<Uint8Array> {
  const occt = await initOcct(options.locateFile);

  const result = occt.ReadStepFile(bytes, STEP_TESSELLATION);
  if (!result.success) {
    throw new Error('STEP file could not be read');
  }
  if (!result.meshes.length) {
    // Success with no meshes means the file parsed but held no solid geometry — a
    // drawing-only or reference-geometry export. Returning an empty GLB would show an
    // empty viewport with no explanation, so this is an error.
    throw new Error('STEP file contained no solid geometry');
  }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  // An indexed loop, not `for...of result.meshes.entries()`: tsconfig.json sets no `target`
  // and no `downlevelIteration`, so iterating an iterator is a compile error. `npm test` and
  // `npm run lint` both pass regardless — only `tsc --noEmit` and `next build` catch it.
  for (let i = 0; i < result.meshes.length; i++) {
    const mesh = result.meshes[i];
    const name = mesh.name || `solid_${i}`;

    const primitive = doc.createPrimitive().setAttribute(
      'POSITION',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(mesh.attributes.position.array))
        .setBuffer(buffer)
    );

    if (mesh.attributes.normal?.array?.length) {
      primitive.setAttribute(
        'NORMAL',
        doc
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(mesh.attributes.normal.array))
          .setBuffer(buffer)
      );
    }

    if (mesh.index?.array?.length) {
      primitive.setIndices(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Uint32Array(mesh.index.array))
          .setBuffer(buffer)
      );
    }

    const [r, g, b] = mesh.color ?? DEFAULT_COLOR;
    primitive.setMaterial(
      doc
        .createMaterial(`${name}_material`)
        .setBaseColorFactor([r, g, b, 1])
        // metallic=0 on purpose. glTF defaults both factors to 1, which is exactly the
        // pitch-black-mesh trap repairMaterials.ts exists to undo; do not emit it here.
        .setMetallicFactor(0)
        .setRoughnessFactor(0.6)
        // CAD parts are frequently thin or perforated, and a single-sided wall disappears
        // when viewed through an opening. Matches makeDoubleSided() in the viewer.
        .setDoubleSided(true)
    );

    // One node per solid keeps parts separately selectable and cross-sectionable.
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive)));
  }

  return new WebIO().writeBinary(doc);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test 2>&1 | grep -A3 'stepToGlb\|# fail'`
Expected: PASS on all four `stepToGlb` tests, `# fail 0` overall.

- [ ] **Step 6: Commit**

```bash
npm run lint
git add lib/model/stepToGlb.ts types/occt-import-js.d.ts scripts/tests/stepToGlb.test.mjs
git commit -m "feat(model): STEP to GLB conversion with viewable tessellation settings"
```

---

### Task 3: The worker and its timeout

**Files:**
- Create: `lib/model/stepWorker.ts`
- Create: `lib/model/runStepConvert.ts`
- Test: `scripts/tests/runStepConvert.test.mjs`

**Interfaces:**
- Consumes: `stepToGlb` from Task 2.
- Produces: `runStepConvert(bytes: ArrayBuffer, options?: { createWorker?: () => ConvertWorker; timeoutMs?: number }): Promise<ArrayBuffer | null>`, `STEP_CONVERT_TIMEOUT_MS = 120000`, `STEP_VIEWER_TIMEOUT_MS = 60000`, and the `ConvertWorker` interface.

**Why the worker is injectable:** terminating the worker is the entire mechanism that makes the timeout real — a synchronous WASM call cannot be interrupted on the main thread. That behaviour is the regression test for the original bug, and it can only be asserted with a stub, because Node has no `Worker` global and a real worker would need a bundler.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/runStepConvert.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runStepConvert,
  STEP_CONVERT_TIMEOUT_MS,
  STEP_VIEWER_TIMEOUT_MS,
} from '../../lib/model/runStepConvert.ts';

/** A worker that never answers — the shape of the bug this whole change exists to fix. */
function silentWorker(log) {
  return {
    postMessage() {},
    terminate() {
      log.terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
}

test('the two timeout budgets are the ones the spec fixed', () => {
  assert.equal(STEP_CONVERT_TIMEOUT_MS, 120000);
  assert.equal(STEP_VIEWER_TIMEOUT_MS, 60000);
});

test('a worker that never replies resolves null and is terminated', async () => {
  // THE regression test. Before this change the equivalent call was a synchronous WASM
  // invocation on the main thread that could not be timed out at all, and the viewport
  // spun forever. Deleting this test re-opens that failure mode.
  const log = { terminated: false };
  const result = await runStepConvert(new ArrayBuffer(8), {
    createWorker: () => silentWorker(log),
    timeoutMs: 30,
  });
  assert.equal(result, null);
  assert.equal(log.terminated, true, 'a wedged worker must be killed, not merely abandoned');
});

test('a successful conversion resolves the buffer and terminates the worker', async () => {
  const log = { terminated: false };
  const payload = new ArrayBuffer(16);
  const worker = {
    postMessage() {
      queueMicrotask(() => worker.onmessage({ data: { ok: true, buffer: payload } }));
    },
    terminate() {
      log.terminated = true;
    },
    onmessage: null,
    onerror: null,
  };

  const result = await runStepConvert(new ArrayBuffer(8), {
    createWorker: () => worker,
    timeoutMs: 5000,
  });
  assert.equal(result, payload);
  assert.equal(log.terminated, true, 'the worker must not be leaked on the success path');
});

test('a worker reporting failure resolves null rather than throwing', async () => {
  // Callers treat null as "use the original file". A throw here would propagate into the
  // upload loop and could fail an upload that has already succeeded.
  const worker = {
    postMessage() {
      queueMicrotask(() => worker.onmessage({ data: { ok: false, error: 'bad file' } }));
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  };
  const result = await runStepConvert(new ArrayBuffer(8), { createWorker: () => worker });
  assert.equal(result, null);
});

test('a worker that crashes outright resolves null', async () => {
  // onerror rather than onmessage: this is the out-of-memory path.
  const worker = {
    postMessage() {
      queueMicrotask(() => worker.onerror({ message: 'out of memory' }));
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  };
  const result = await runStepConvert(new ArrayBuffer(8), { createWorker: () => worker });
  assert.equal(result, null);
});

test('a worker that cannot be constructed resolves null', async () => {
  const result = await runStepConvert(new ArrayBuffer(8), {
    createWorker: () => {
      throw new Error('Worker is not defined');
    },
  });
  assert.equal(result, null);
});

test('a late reply after a timeout cannot resolve twice', async () => {
  // settled-guard check: a worker that replies just after being killed must not overwrite
  // the null the caller already received, which would surface as a resolved promise
  // changing value.
  let captured = null;
  const worker = {
    postMessage() {
      captured = () => worker.onmessage({ data: { ok: true, buffer: new ArrayBuffer(4) } });
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  };
  const result = await runStepConvert(new ArrayBuffer(8), {
    createWorker: () => worker,
    timeoutMs: 10,
  });
  assert.equal(result, null);
  assert.doesNotThrow(() => captured());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -B2 -A6 runStepConvert | head -20`
Expected: FAIL — cannot resolve `../../lib/model/runStepConvert.ts`.

- [ ] **Step 3: Write the worker entry**

Create `lib/model/stepWorker.ts`:

```ts
/// <reference lib="webworker" />
import { stepToGlb } from './stepToGlb';

/**
 * Worker entry for STEP tessellation. This module and optimizeWorker.ts are the ONLY places
 * their heavy dependencies may enter the bundle graph — the OCCT WASM alone is 7.6 MB, and a
 * reviewer who never opens a STEP file must not download it.
 *
 * Running here is not only about main-thread responsiveness. ReadStepFile is a synchronous
 * call that can run for minutes on heavy NURBS input and cannot be interrupted; on the main
 * thread that freezes the tab with no way out. In a worker the caller can terminate it.
 */

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const glb = await stepToGlb(new Uint8Array(event.data));

    // Copy out of the WASM heap view into a standalone ArrayBuffer so it can be
    // transferred. glb.buffer may be the whole heap, and may be larger than glb.
    const buffer = glb.slice().buffer;
    (self as unknown as Worker).postMessage({ ok: true, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
```

- [ ] **Step 4: Write the front door**

Create `lib/model/runStepConvert.ts`:

```ts
/**
 * Browser-side front door to STEP tessellation, modelled on runOptimize.ts. Every failure
 * path resolves `null`, which callers read as "use the original file" — conversion is an
 * improvement, never a gate.
 */

/**
 * Structural worker type rather than the DOM `Worker`. The timeout behaviour below is the
 * regression test for a bug that froze tabs indefinitely, and it can only be asserted
 * against a stub.
 */
export interface ConvertWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/** Measured 19.7s on the 13.7 MB reference file; ~6x headroom. Matches runOptimize. */
export const STEP_CONVERT_TIMEOUT_MS = 120_000;

/**
 * Deliberately tighter than the upload budget. A reviewer waiting on a file needs an answer
 * sooner than an uploader does, and a file that cannot make 60s here is one that should
 * have been converted at upload.
 */
export const STEP_VIEWER_TIMEOUT_MS = 60_000;

function defaultWorker(): ConvertWorker {
  // new URL(..., import.meta.url) is how webpack 5 — and therefore Next 14 — discovers and
  // bundles a worker as a separate chunk.
  return new Worker(new URL('./stepWorker.ts', import.meta.url)) as unknown as ConvertWorker;
}

export function runStepConvert(
  bytes: ArrayBuffer,
  options: { createWorker?: () => ConvertWorker; timeoutMs?: number } = {}
): Promise<ArrayBuffer | null> {
  const timeoutMs = options.timeoutMs ?? STEP_CONVERT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let worker: ConvertWorker;
    try {
      worker = (options.createWorker ?? defaultWorker)();
    } catch (error) {
      console.warn('STEP conversion unavailable; using the original file.', error);
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (result: ArrayBuffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    // Terminating is the whole point: a synchronous WASM call cannot be interrupted any
    // other way, and letting it run is what froze the tab before this existed.
    const timer = setTimeout(() => {
      console.warn(`STEP conversion exceeded ${timeoutMs}ms; using the original file.`);
      finish(null);
    }, timeoutMs);

    worker.onmessage = (event) => {
      const data = event.data as
        | { ok: true; buffer: ArrayBuffer }
        | { ok: false; error: string };
      if (!data.ok) {
        console.warn('STEP conversion failed; using the original file.', data.error);
        finish(null);
        return;
      }
      finish(data.buffer);
    };

    // Fires when the worker dies outright, which is the out-of-memory case.
    worker.onerror = (event) => {
      console.warn('STEP conversion worker crashed; using the original file.', event.message);
      finish(null);
    };

    try {
      worker.postMessage(bytes, [bytes]);
    } catch (error) {
      console.warn('STEP conversion could not be started.', error);
      finish(null);
    }
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test 2>&1 | grep -A3 'runStepConvert\|# fail'`
Expected: PASS on all seven `runStepConvert` tests, `# fail 0` overall.

- [ ] **Step 6: Commit**

```bash
npm run lint
git add lib/model/stepWorker.ts lib/model/runStepConvert.ts scripts/tests/runStepConvert.test.mjs
git commit -m "feat(model): run STEP tessellation in a terminable worker"
```

---

### Task 4: Route STEP through the upload pipeline

**Files:**
- Modify: `lib/model/runOptimize.ts`
- Modify: `lib/useUpload.ts:92-131`
- Modify: `app/api/files/upload/route.ts:4,22`
- Test: `scripts/tests/prepareVariant.test.mjs`

**Interfaces:**
- Consumes: `producesViewerVariant`, `isTessellatableFilename`, `isOptimizableFilename` (Task 1); `runStepConvert`, `STEP_CONVERT_TIMEOUT_MS` (Task 3).
- Produces: `shouldPrepareVariant(filename: string, bytes: number): boolean`, `prepareViewerVariant(file: File): Promise<VariantResult | null>` where `VariantResult = { buffer: ArrayBuffer; summary: string }`, and `MAX_STEP_BYTES`. `runOptimize`, `shouldOptimize` and `MAX_OPTIMIZE_BYTES` remain exported unchanged so nothing else breaks.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/prepareVariant.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldPrepareVariant,
  MAX_OPTIMIZE_BYTES,
  MAX_STEP_BYTES,
} from '../../lib/model/runOptimize.ts';

const MB = 1024 * 1024;

test('the two size caps are independent and correctly sized', () => {
  // They describe different things. MAX_OPTIMIZE_BYTES exists because the gltf-transform
  // chain peaks near 24x the input in memory. OCCT does not — the reference file peaked
  // near 60 MB on a 13.7 MB input. Its real guard is the timeout, because tessellation
  // cost tracks surface complexity, not byte count.
  assert.equal(MAX_OPTIMIZE_BYTES, 100 * MB);
  assert.equal(MAX_STEP_BYTES, 50 * MB);
});

test('each format is judged against its own cap', () => {
  assert.equal(shouldPrepareVariant('m.glb', 90 * MB), true);
  assert.equal(shouldPrepareVariant('m.glb', 110 * MB), false);
  assert.equal(shouldPrepareVariant('m.stp', 40 * MB), true);
  // A 60 MB STEP is under the GLB cap but over its own. Sharing one cap would let it through.
  assert.equal(shouldPrepareVariant('m.stp', 60 * MB), false);
  assert.equal(shouldPrepareVariant('m.step', 40 * MB), true);
});

test('formats with no converter never claim a variant', () => {
  for (const name of ['m.obj', 'm.stl', 'm.gltf', 'm.pdf', 'notes.txt']) {
    assert.equal(shouldPrepareVariant(name, 1 * MB), false, name);
  }
});

test('the reference file is comfortably inside the STEP cap', () => {
  // 13,748,500 bytes. If a future edit tightens MAX_STEP_BYTES below this, the file that
  // motivated this whole change stops being converted.
  assert.equal(shouldPrepareVariant('Clamp 9inch reach.stp', 13_748_500), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -B2 -A6 prepareVariant | head -20`
Expected: FAIL — `shouldPrepareVariant is not a function` / `MAX_STEP_BYTES` undefined.

- [ ] **Step 3: Extend runOptimize.ts**

In `lib/model/runOptimize.ts`, update the import line at the top:

```ts
import {
  isOptimizableFilename,
  isTessellatableFilename,
  producesViewerVariant,
} from '@/lib/storageKeys';
import { runStepConvert } from './runStepConvert';
```

Add after the `MAX_OPTIMIZE_BYTES` declaration:

```ts
/**
 * A cap on absurd inputs only. Unlike MAX_OPTIMIZE_BYTES this is NOT a memory projection:
 * OCCT peaked near 60 MB on a 13.7 MB file. Tessellation cost tracks surface complexity,
 * not byte count, so the timeout in runStepConvert is the real guard.
 */
export const MAX_STEP_BYTES = 50 * 1024 * 1024;

export interface VariantResult {
  buffer: ArrayBuffer;
  /** One line for the console. Its shape differs per source format. */
  summary: string;
}

export function shouldPrepareVariant(filename: string, bytes: number): boolean {
  if (!producesViewerVariant(filename)) return false;
  if (isTessellatableFilename(filename)) return bytes <= MAX_STEP_BYTES;
  return bytes <= MAX_OPTIMIZE_BYTES;
}
```

Add this function, placed next to `runOptimize` and sharing its queue:

```ts
/**
 * Produce the object the viewer should load instead of the original, whatever the source
 * format. Shares runOptimize's single-slot queue, so a multi-file upload never runs two
 * conversions at once regardless of which kind they are.
 */
export function prepareViewerVariant(file: File): Promise<VariantResult | null> {
  const result = optimizeQueue.then(() => prepareViewerVariantNow(file));
  optimizeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function prepareViewerVariantNow(file: File): Promise<VariantResult | null> {
  if (isTessellatableFilename(file.name)) {
    const bytes = await file.arrayBuffer();
    const glb = await runStepConvert(bytes);
    if (!glb) return null;
    return {
      buffer: glb,
      summary:
        `Tessellated ${file.name}: ` +
        `${Math.round(file.size / 1024)}KB STEP → ${Math.round(glb.byteLength / 1024)}KB GLB`,
    };
  }

  if (!isOptimizableFilename(file.name)) return null;

  const optimized = await runOptimizeNow(file);
  if (!optimized) return null;
  const { before, after } = optimized.stats;
  return {
    buffer: optimized.buffer,
    summary:
      `Optimised ${file.name}: ${before.primitives} → ${after.primitives} draw calls, ` +
      `${after.triangles} triangles preserved, ` +
      `${Math.round(before.bytes / 1024)}KB → ${Math.round(after.bytes / 1024)}KB`,
  };
}
```

Note: `prepareViewerVariantNow` calls `runOptimizeNow` directly, NOT `runOptimize` — going through `runOptimize` would chain onto the same queue this call already holds and deadlock.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | grep -A3 'prepareVariant\|# fail'`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Presign a variant URL for STEP**

In `app/api/files/upload/route.ts`, change the import on line 4 and the gate on line 22:

```ts
import { producesViewerVariant, optimizedVariantKey } from '@/lib/storageKeys';
```

```ts
  const variantStorageKey = producesViewerVariant(filename)
    ? optimizedVariantKey(storageKey)
    : null;
```

Without this the client receives `variantPresignedUrl: null` for every `.stp` and the whole conversion path is dead code.

- [ ] **Step 6: Switch the upload call site**

In `lib/useUpload.ts`, change the import on line 6:

```ts
import { prepareViewerVariant, shouldPrepareVariant } from '@/lib/model/runOptimize';
```

Then in `uploadOne`, replace the guard and body of the optimization block. The `try/finally` structure, the `patch(...)` calls and every `console.warn` stay exactly as they are — only the three marked lines change:

```ts
        let hasOptimizedVariant = false;
        if (variantPresignedUrl && shouldPrepareVariant(entry.file.name, entry.file.size)) {
          patch(entry.path, { state: 'optimizing' });
          try {
            const variant = await prepareViewerVariant(entry.file);

            if (variant) {
              try {
                const put = await fetch(variantPresignedUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'model/gltf-binary' },
                  body: variant.buffer,
                });
                if (!put.ok) throw new Error(`Variant upload failed (${put.status})`);

                hasOptimizedVariant = true;
                console.info(variant.summary);
              } catch (err) {
                console.warn(`Could not store optimised copy of ${entry.file.name}`, err);
                hasOptimizedVariant = false;
              }
            }
          } catch (err) {
            console.warn(`Optimization failed for ${entry.file.name}`, err);
            hasOptimizedVariant = false;
          } finally {
            patch(entry.path, { state: 'uploading' });
          }
        }
```

- [ ] **Step 7: Verify nothing else broke**

Run: `npm test && npm run lint`
Expected: `# fail 0`, lint clean.

- [ ] **Step 8: Commit**

```bash
git add lib/model/runOptimize.ts lib/useUpload.ts app/api/files/upload/route.ts scripts/tests/prepareVariant.test.mjs
git commit -m "feat(upload): tessellate STEP to GLB at upload time"
```

---

### Task 5: The error boundary

**Files:**
- Create: `components/viewers/ModelErrorBoundary.tsx`
- Modify: `components/viewers/ViewerContainer.tsx:155`

**Interfaces:**
- Consumes: nothing.
- Produces: default-exported `ModelErrorBoundary` taking `{ onReady?: () => void; children: React.ReactNode }`.

**Why this is separate from the STEP work:** the viewer has no error boundary at all today. A throw from `useLoader` inside `<Suspense>` propagates past the viewer and `onReady` never fires, so the viewport overlay stays up even for failures that are already fast. This task fixes that independently of anything STEP-specific.

- [ ] **Step 1: Create the boundary**

Create `components/viewers/ModelErrorBoundary.tsx`:

```tsx
'use client';

import { Component, type ReactNode } from 'react';

/**
 * The viewer had no error boundary. A throw from useLoader inside <Suspense> had nothing to
 * catch it, so it propagated past the viewer and onReady never fired — leaving the
 * viewport's loading indicator up over a file that had already definitively failed.
 *
 * A class component because React has no hook equivalent of componentDidCatch.
 */
interface Props {
  /**
   * Must be called on the failure path. The page holds ONE loading indicator until a file
   * is on screen OR definitively cannot be; a branch that forgets this leaves the indicator
   * covering the very message explaining why there is nothing to see.
   */
  onReady?: () => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class ModelErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('3D model could not be displayed.', error);
    this.props.onReady?.();
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-gray-700">
            This 3D file could not be prepared for viewing.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            It is too complex to display in the browser. You can still download it.
          </p>
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 2: Wrap the model branch**

In `components/viewers/ViewerContainer.tsx`, add the import beside the other viewer imports:

```ts
import ModelErrorBoundary from './ModelErrorBoundary';
```

Replace the single-line `MODEL_EXTENSIONS` branch with:

```tsx
  if (MODEL_EXTENSIONS.includes(ext)) {
    return (
      <ModelErrorBoundary onReady={onReady}>
        <ModelViewer url={url} commentToolActive={commentToolActive} onSceneClick={onSceneClick} worldPins={worldPins} onPinPositionsUpdate={onPinPositionsUpdate} handleRef={modelViewerRef} transform={transform} transformMode={transformMode} onTransformCommit={onTransformCommit} focalLength={focalLength} sectionSlots={sectionSlots} selectedPlane={selectedPlane} onSelectPlane={onSelectPlane} onReady={onReady} />
      </ModelErrorBoundary>
    );
  }
```

- [ ] **Step 3: Verify the build compiles**

Run:
```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
```
Expected: build completes. `lib/s3.ts` throws at import without all six vars, so a bare `npm run build` failing at "Collect page data" is missing config, not a code defect.

- [ ] **Step 4: Commit**

```bash
npm run lint
git add components/viewers/ModelErrorBoundary.tsx components/viewers/ViewerContainer.tsx
git commit -m "fix(viewer): catch model load failures instead of hanging the indicator"
```

---

### Task 6: STEPLoader off the main thread

**Files:**
- Modify: `lib/STEPLoader.ts` (full rewrite)

**Interfaces:**
- Consumes: `runStepConvert`, `STEP_VIEWER_TIMEOUT_MS` (Task 3); `ModelErrorBoundary` (Task 5) catches what it throws.
- Produces: `STEPLoader` keeping its `THREE.Loader` shape, so `getLoaderForExt` in `ModelViewerInner.tsx:142-143` and `useLoader` are untouched.

- [ ] **Step 1: Rewrite the loader**

Replace the entire contents of `lib/STEPLoader.ts`:

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { runStepConvert, STEP_VIEWER_TIMEOUT_MS } from './model/runStepConvert';

/**
 * Loads a STEP file by tessellating it to GLB in a worker, then parsing that GLB.
 *
 * It used to call occt.ReadStepFile directly, synchronously, on the main thread, with null
 * params. That combination froze the tab for the entire tessellation — which on a heavy
 * Rhino export never finished — while the viewport's CSS loading animation kept running on
 * the compositor thread, so it looked like progress. See
 * docs/superpowers/specs/2026-09-02-step-viewing-design.md.
 *
 * This path is now the FALLBACK. Files uploaded after that change carry a converted GLB and
 * never reach here; this serves files uploaded before it, and any whose conversion failed.
 */
export class STEPLoader extends THREE.Loader {
  load(
    url: string,
    onLoad: (group: THREE.Group) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: unknown) => void,
  ): void {
    this.loadAsync(url, onProgress)
      .then(onLoad)
      .catch(onError);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<THREE.Group> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`STEPLoader: Failed to fetch ${url} (${response.status})`);
    }
    const bytes = await response.arrayBuffer();

    const glb = await runStepConvert(bytes, { timeoutMs: STEP_VIEWER_TIMEOUT_MS });
    if (!glb) {
      // Throwing is what surfaces the message. ModelErrorBoundary catches it and releases
      // the viewport indicator; returning an empty Group would show a blank viewport with
      // no explanation, which is the behaviour this change exists to remove.
      throw new Error('STEPLoader: could not tessellate this file in the browser');
    }

    const gltf = await new GLTFLoader().parseAsync(glb, '');
    return gltf.scene;
  }
}
```

- [ ] **Step 2: Confirm the viewer still routes correctly**

Read `components/viewers/ModelViewerInner.tsx:196` and confirm the `.step`/`.stp` branch renders `<primitive object={data as THREE.Group} />`. `gltf.scene` is a `THREE.Group`, so that branch and the `repairExporterDefaults` / `makeDoubleSided` passes (which test `data instanceof THREE.Object3D`) continue to work unchanged. Make no edit if this holds.

- [ ] **Step 3: Verify the build compiles**

Run:
```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
```
Expected: build completes, and the build output lists a separate chunk for the STEP worker.

- [ ] **Step 4: Commit**

```bash
npm run lint && npm test
git add lib/STEPLoader.ts
git commit -m "fix(viewer): tessellate STEP in a worker under a timeout"
```

---

### Task 7: Verify against the file that caused this

**Files:** none modified.

The reference file is `~/Desktop/Clamp 9inch reach.stp` (13,748,500 bytes). It is not in the repo. If it is missing, ask before proceeding — every number in the spec came from it, and there is no substitute fixture for this task.

- [ ] **Step 1: Confirm conversion outside the browser**

Run:
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import path from 'node:path';
const { stepToGlb } = await import('./lib/model/stepToGlb.ts');
const locateFile = (p) => path.join(process.cwd(), 'node_modules/occt-import-js/dist/', p);
const t = Date.now();
const glb = await stepToGlb(new Uint8Array(readFileSync(process.env.HOME + '/Desktop/Clamp 9inch reach.stp')), { locateFile });
console.log('seconds:', ((Date.now()-t)/1000).toFixed(1), 'glb KB:', Math.round(glb.byteLength/1024));
"
```
Expected: completes in roughly 15–30 s and prints a GLB size near 700 KB. If it does not finish, `STEP_TESSELLATION` has been changed — that is the bug, not a slow machine.

- [ ] **Step 2: Boot the app**

Run:
```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' npm run dev
```
`DATABASE_URL` is required even for pages that never query, because `middleware.ts` imports `lib/auth` → `lib/db`, which throws at module load if unset. `neon()` connects lazily, so a fake URL is fine.

- [ ] **Step 3: Verify the upload path**

Upload the clamp through the normal flow and confirm, in order:
- the upload completes and the file appears in the tree
- the console logs a `Tessellated ...` line
- a `.optimized.glb` object exists beside the original in storage
- opening the file draws the clamp within about a second, with no long spin
- all 11 parts are present and individually selectable
- the cross-section tool still cuts the model

- [ ] **Step 4: Verify the fallback path**

Simulate a file uploaded before this change: in the database, set `converted_storage_key = NULL` for that file row, reload the viewer, and confirm:
- the tab stays responsive throughout — the page scrolls and buttons respond while it works
- it ends in either the drawn model or the "could not be prepared for viewing" message
- it never sits on the tumbling cube indefinitely

The pre-change behaviour is the baseline: it never finished, and the tab was frozen.

- [ ] **Step 5: Verify the failure message**

Temporarily set `STEP_VIEWER_TIMEOUT_MS` to `1000` in `lib/model/runStepConvert.ts`, reload the fallback case, and confirm the failure message appears and the loading indicator comes down. Revert the constant afterward and confirm `git diff` is empty.

- [ ] **Step 6: Commit the verification note**

Append to the plan file a short "Verified" line recording the measured seconds and GLB size from Step 1, then:

```bash
git add docs/superpowers/plans/2026-09-02-step-viewing.md
git commit -m "docs(plan): record STEP viewing verification results"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Convert at upload, in a worker | 3, 4 |
| Failure never fails an upload | 3 (null paths), 4 (try/finally preserved) |
| Viewer-side fallback under a timeout | 3, 6 |
| Failure message + indicator released | 5 |
| Tessellation settings and rationale | 2 |
| `stepToGlb` / `stepWorker` / `runStepConvert` / `ModelErrorBoundary` | 2, 3, 5 |
| `STEPLoader` rewrite | 6 |
| `storageKeys` predicates, suffix reuse | 1 |
| `runOptimize` routing, `MAX_STEP_BYTES` | 4 |
| `useUpload` variant path | 4 |
| `types/occt-import-js.d.ts` widened | 2 |
| `app/api/files/upload/route.ts` gate | 4 |
| `ViewerContainer` wraps in boundary | 5 |
| Timeout budgets 120s / 60s | 3 |
| Not running `optimizeGlb` on STEP output | 2 (never called) |
| Unit / conversion / timeout / boundary / manual tests | 1, 2, 3, 4, 7 |

No spec requirement is unassigned. The boundary has no automated test — rendering React needs a DOM the repo has no harness for, so Task 5 verifies by build plus the manual check in Task 7 Step 5. This is a deliberate deviation from the spec's testing section and should be raised if a DOM harness is ever added.

**Type consistency:** `producesViewerVariant` / `isTessellatableFilename` (Task 1) are used verbatim in Tasks 4 and 5. `runStepConvert(bytes, {createWorker, timeoutMs})` and `ConvertWorker` (Task 3) match their uses in Tasks 4 and 6. `VariantResult.summary` (Task 4) matches the `console.info(variant.summary)` call site. `stepToGlb(bytes, {locateFile})` (Task 2) matches Tasks 3 and 7.
