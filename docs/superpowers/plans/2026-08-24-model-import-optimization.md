# Model Import Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fragmented CAD exports from crippling the 3D viewer, and stop exporter-default materials from rendering pitch black.

**Architecture:** Two independent fixes with different lifecycles. Geometry is optimized **once at upload** in a Web Worker in the uploader's browser — `gltf-transform` merges thousands of tiny primitives into one per material, losslessly — and the result is stored alongside the original as `converted_storage_key`. Materials are repaired **at every load** in the viewer, so every format benefits, not just glTF. Either fix ships and works without the other.

**Tech Stack:** TypeScript, Next.js 14.2.35 (webpack), React 18, three.js 0.169, `@react-three/fiber` 8, `@gltf-transform/*`, Web Workers, `node --test` with native TypeScript type-stripping.

**Spec:** `docs/superpowers/specs/2026-08-24-model-import-optimization-design.md`

## Global Constraints

- **Lossless only.** Triangle count must be identical before and after optimization. No `simplify()`, no decimation, no LOD. This is asserted directly in tests.
- **Optimization must never block or fail an upload.** Any error, timeout, or oversized input falls back to uploading the original file unchanged.
- **`@gltf-transform/*` must be reachable only from the worker entry point.** Never import it from a module that the main bundle pulls in — the viewer must not pay for it on page load.
- **Only `.glb` and `.gltf` are optimized.** STEP, OBJ, STL, PLY, DAE and 3DS are parsed by their own three.js loaders and never become glTF. `lib/cloudconvert.ts`'s `createStepToGlbJob` is vestigial — it is referenced only from `/api/conversions/retry` and is never called for a new upload. Do not build on it.
- **`conversion_status` stays `NULL` on the client-optimized path.** `'completed'` means "a CloudConvert job finished". `converted_storage_key` is populated independently, and the viewer must branch on `convertedStorageKey` alone, never on `conversionStatus`.
- **Never set `needsUpdate` when changing `metalness`, `roughness` or `color`.** Those are uniforms; setting `needsUpdate` forces a pointless shader recompile.
- **Test command:** `npm test` (runs `node --test scripts/tests/*.mjs`). Baseline before this work: **151 passing, 0 failing.**
- Tests are `.mjs` and import `.ts` source directly (e.g. `from '../../lib/crossSection.ts'`). Node strips types natively — use erasable syntax only (no enums, no namespaces, no parameter properties).

---

## Task 1: Material repair module

Fixes the reported black-mesh bug. Pure and fully unit-testable.

**Files:**
- Create: `lib/model/repairMaterials.ts`
- Test: `scripts/tests/repairMaterials.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `repairExporterDefaults<T extends THREE.Object3D>(root: T): T` — mutates in place and returns `root`, matching `makeDoubleSided` / `setClippingPlanes` in `lib/threeMaterials.ts`.

- [x] **Step 1: Write the failing test**

Create `scripts/tests/repairMaterials.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { repairExporterDefaults } from '../../lib/model/repairMaterials.ts';

/** A material carrying exactly the signature Rhino leaves behind: unnamed, no PBR factors
 *  written (so the glTF spec defaults of 1.0/1.0 apply), no maps. */
const exporterDefault = (overrides = {}) =>
  new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 1, roughness: 1, ...overrides });

const wrap = (material) => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  return root;
};

const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

test('an exporter-default material stops being metallic', () => {
  const material = exporterDefault();
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 0);
  assert.equal(material.roughness, 0.8);
});

test('a black albedo is lifted so the surface is visible at all', () => {
  // Metalness alone does not save this one: a dielectric with zero albedo reflects
  // essentially nothing either, so 33% of the reference model would stay black.
  const material = exporterDefault({ color: 0x000000 });
  repairExporterDefaults(wrap(material));
  assert.ok(luminance(material.color) > 0.2, 'black albedo was not lifted');
});

test('a coloured exporter-default keeps its colour', () => {
  const material = exporterDefault({ color: 0x3366cc });
  const before = material.color.clone();
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 0, 'metalness should still be corrected');
  assert.ok(material.color.equals(before), 'a visible colour must not be overwritten');
});

test('a NAMED material is never touched', () => {
  // Named means authored. Rhino only omits the name on auto-generated display-colour
  // materials, so the name is the discriminator that keeps intentional black black.
  const material = exporterDefault({ name: 'Plaster' });
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 1);
  assert.equal(material.roughness, 1);
});

test('a textured material is never touched', () => {
  const material = exporterDefault({ map: new THREE.Texture() });
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 1);
});

test('a deliberately authored metal is never touched', () => {
  const material = exporterDefault({ name: 'Chrome', metalness: 1, roughness: 0.2 });
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 1);
  assert.equal(material.roughness, 0.2);
});

test('every entry of an array-material mesh is considered separately', () => {
  const broken = exporterDefault();
  const authored = exporterDefault({ name: 'keep' });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), [broken, authored]));
  repairExporterDefaults(root);
  assert.equal(broken.metalness, 0);
  assert.equal(authored.metalness, 1);
});

test('a material with no metalness at all is skipped without throwing', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
  assert.doesNotThrow(() => repairExporterDefaults(wrap(material)));
});

test('a non-mesh child is skipped without throwing', () => {
  const root = new THREE.Group();
  root.add(new THREE.Object3D());
  assert.doesNotThrow(() => repairExporterDefaults(root));
});

test('returns root', () => {
  const root = new THREE.Group();
  assert.equal(repairExporterDefaults(root), root);
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `node --test scripts/tests/repairMaterials.test.mjs`
Expected: FAIL — `Cannot find module .../lib/model/repairMaterials.ts`

- [x] **Step 3: Write the implementation**

Create `lib/model/repairMaterials.ts`:

```ts
import * as THREE from 'three';

/**
 * Repairs materials whose PBR factors the exporter never wrote.
 *
 * glTF defaults `metallicFactor` and `roughnessFactor` to 1.0 when they are absent, so a
 * Rhino export that carries only a display colour arrives as a *fully metallic* surface.
 * Metals have no diffuse response — they show reflections and nothing else — and
 * SceneLighting deliberately runs the environment at 0.15 because the headlight is meant
 * to do the lighting. The result is geometry that renders pitch black with no way to
 * recover, which is exactly what one third of the reference model did.
 *
 * The signature below is the discriminator. `metalness === 1 && roughness === 1` describes
 * a perfectly rough mirror, which is physically meaningless and never authored on purpose,
 * and Rhino omits the name only on materials it auto-generates from display colours.
 * Authored materials carry a name and explicit factors, so they never match.
 *
 * Mutates in place and returns `root`, matching `makeDoubleSided` in lib/threeMaterials.ts.
 */

/** Below this linear luminance a base colour carries no visible information at all. */
const NEAR_BLACK_LUMINANCE = 0.02;

/** What a black display colour becomes: a neutral grey that shades legibly. */
const FALLBACK_LUMINANCE = 0.55;

/** Matte enough to read as an untextured CAD surface under the headlight. */
const REPAIRED_ROUGHNESS = 0.8;

/** three.js stores material colours in linear working space, so this is a linear luminance. */
function luminanceOf(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function isExporterDefault(material: THREE.Material): material is THREE.MeshStandardMaterial {
  // A name means a human authored it. Cheapest check, so it goes first.
  if (material.name !== '') return false;

  const standard = material as THREE.MeshStandardMaterial;
  // Undefined on non-PBR materials, which fails this comparison and skips them safely.
  if (standard.metalness !== 1 || standard.roughness !== 1) return false;

  // Any map means the exporter wrote real PBR data and meant it.
  if (standard.map || standard.metalnessMap || standard.roughnessMap) return false;

  return true;
}

export function repairExporterDefaults<T extends THREE.Object3D>(root: T): T {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!isExporterDefault(material)) continue;

      material.metalness = 0;
      material.roughness = REPAIRED_ROUGHNESS;

      // Only rescue a colour that carries no information. A visible colour is the
      // designer's, even on a material the exporter mangled in other ways.
      if (luminanceOf(material.color) < NEAR_BLACK_LUMINANCE) {
        material.color.setScalar(FALLBACK_LUMINANCE);
      }

      // Deliberately no `needsUpdate`: these are all uniforms, and setting it would
      // force a shader recompile for nothing.
    }
  });
  return root;
}
```

- [x] **Step 4: Run the test and verify it passes**

Run: `node --test scripts/tests/repairMaterials.test.mjs`
Expected: PASS — 10 tests, 0 failures

- [x] **Step 5: Run the whole suite**

Run: `npm test`
Expected: 161 passing, 0 failing (151 baseline + 10 new)

- [x] **Step 6: Commit**

```bash
git add lib/model/repairMaterials.ts scripts/tests/repairMaterials.test.mjs
git commit -m "feat(viewer): repair exporter-default materials that render black"
```

---

## Task 2: Wire material repair into the viewer

Delivers the black-mesh fix end to end. Applies to every `Object3D`-rooted format, so STEP/OBJ/DAE/3DS get it too.

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx` (import block near line 14, and the `useMemo` at lines 136–147)

**Interfaces:**
- Consumes: `repairExporterDefaults` from Task 1.
- Produces: nothing new.

- [x] **Step 1: Add the import**

In `components/viewers/ModelViewerInner.tsx`, next to the existing `threeMaterials` import:

```ts
import { makeDoubleSided, setClippingPlanes } from '@/lib/threeMaterials';
import { repairExporterDefaults } from '@/lib/model/repairMaterials';
```

- [x] **Step 2: Call it alongside `makeDoubleSided`**

Replace the existing `useMemo` (currently lines 141–147, the one commented "Materials that ship inside the file..."):

```ts
  // Materials that ship inside the file (OBJ / 3DS / DAE / STEP / glTF) are single-sided
  // by default, which hides the far inner wall of thin or perforated parts when you look
  // through an opening. STL and PLY use the shared materials above, already double-sided.
  //
  // Repair runs first: it only ever touches materials the exporter left at glTF's
  // metal=1/rough=1 defaults, and doing it before the side change keeps both passes over
  // the same freshly-loaded tree.
  useMemo(() => {
    const root: THREE.Object3D | undefined =
      data instanceof THREE.Object3D ? data : (data as GLTF | Collada | undefined)?.scene;
    if (!root) return;
    repairExporterDefaults(root);
    makeDoubleSided(root);
  }, [data]);
```

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `ModelViewerInner.tsx` or `repairMaterials.ts`

- [x] **Step 4: Verify against the real file**

Start the app, open a package containing `Rohit Resort Villas.glb`, and confirm:
- The previously pitch-black geometry (roughly one third of the model — walls and slabs) now shades as grey and responds to orbiting.
- Textured surfaces (render-image materials) are unchanged.
- Coloured glass/transmission surfaces are unchanged.

If a model that was previously fine now looks washed out, the signature is matching too widely — check that `material.name` is genuinely empty on the affected material before loosening anything.

- [x] **Step 5: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "fix(viewer): apply exporter-default material repair on model load"
```

---

## Task 3: Lossless GLB optimizer

The core of the performance fix. Pure and testable; knows nothing about workers, uploads or the DOM.

**Files:**
- Create: `lib/model/optimizeGlb.ts`
- Test: `scripts/tests/optimizeGlb.test.mjs`
- Modify: `package.json` (dependencies)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `optimizeGlb(input: ArrayBuffer): Promise<OptimizeResult>`
  - `interface OptimizeCounts { primitives: number; triangles: number; nodes: number; bytes: number }`
  - `interface OptimizeStats { before: OptimizeCounts; after: OptimizeCounts }`
  - `interface OptimizeResult { buffer: ArrayBuffer; stats: OptimizeStats }`

- [x] **Step 1: Install the dependencies**

```bash
npm install @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
```

- [x] **Step 2: Write the failing test**

Create `scripts/tests/optimizeGlb.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, WebIO } from '@gltf-transform/core';
import { optimizeGlb } from '../../lib/model/optimizeGlb.ts';

/**
 * A stand-in for what Rhino produces: one node, one mesh and one primitive per triangle,
 * merged by nothing. `materialCount` distinct materials are dealt round-robin.
 *
 * The materials must differ from each other — dedup() correctly collapses identical
 * materials, so a test built from N *identical* default materials would join to a single
 * primitive and silently prove nothing about material grouping.
 */
function fragmentedGlb(primitiveCount, materialCount = 1) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const materials = Array.from({ length: materialCount }, (_, m) =>
    doc.createMaterial().setBaseColorFactor([m / materialCount, 0.5, 0.5, 1])
  );

  for (let i = 0; i < primitiveCount; i++) {
    const position = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0]))
      .setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', position)
      .setMaterial(materials[i % materialCount]);
    scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  }
  return doc;
}

async function toArrayBuffer(doc) {
  const bin = await new WebIO().writeBinary(doc);
  return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
}

test('thousands of single-triangle primitives collapse to one per material', async () => {
  const input = await toArrayBuffer(fragmentedGlb(600, 5));
  const { stats } = await optimizeGlb(input);
  assert.equal(stats.before.primitives, 600);
  assert.equal(stats.after.primitives, 5, 'expected exactly one primitive per material');
});

test('triangle count is preserved exactly — the lossless guarantee', async () => {
  // The single most important assertion in this file. Stiko is a review tool; people
  // approve and measure against these meshes, so the optimizer must never remove geometry.
  const input = await toArrayBuffer(fragmentedGlb(600, 5));
  const { stats } = await optimizeGlb(input);
  assert.equal(stats.after.triangles, stats.before.triangles);
  assert.equal(stats.after.triangles, 600);
});

test('a single-material model collapses to exactly one primitive', async () => {
  const input = await toArrayBuffer(fragmentedGlb(200, 1));
  const { stats } = await optimizeGlb(input);
  assert.equal(stats.after.primitives, 1);
  assert.equal(stats.after.triangles, 200);
});

test('node count collapses along with the primitives', async () => {
  const input = await toArrayBuffer(fragmentedGlb(200, 2));
  const { stats } = await optimizeGlb(input);
  assert.equal(stats.before.nodes, 200);
  assert.ok(stats.after.nodes <= 2, `expected at most 2 nodes, got ${stats.after.nodes}`);
});

test('returns a real ArrayBuffer that can be re-read as glTF', async () => {
  const input = await toArrayBuffer(fragmentedGlb(50, 2));
  const { buffer } = await optimizeGlb(input);
  assert.ok(buffer instanceof ArrayBuffer);
  const reread = await new WebIO().readBinary(new Uint8Array(buffer));
  assert.equal(reread.getRoot().listMeshes().length, 2);
});

test('byte counts are reported for both sides', async () => {
  const input = await toArrayBuffer(fragmentedGlb(300, 3));
  const { buffer, stats } = await optimizeGlb(input);
  assert.equal(stats.before.bytes, input.byteLength);
  assert.equal(stats.after.bytes, buffer.byteLength);
});

test('merging across differently-placed nodes preserves world positions', async () => {
  // This is what keeps comment pins valid. Pins are stored in model-local space, so if
  // merging moved geometry relative to the model root, every existing pin would drift.
  //
  // Note what preservation actually looks like here: join() does NOT flatten everything to
  // identity. It keeps one surviving node and rebases the merged vertices against that
  // node's transform. World position is therefore transform x local vertex — asserting on
  // raw vertex values alone would wrongly look like corruption.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial().setBaseColorFactor([1, 0, 0, 1]);
  const offsets = [[10, 20, 30], [100, 0, 0], [0, 50, 0]];

  for (const translation of offsets) {
    const position = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material);
    scene.addChild(
      doc.createNode().setTranslation(translation).setMesh(doc.createMesh().addPrimitive(prim))
    );
  }

  const { buffer: out, stats } = await optimizeGlb(await toArrayBuffer(doc));
  assert.equal(stats.after.primitives, 1, 'the three nodes should merge into one primitive');

  const reread = await new WebIO().readBinary(new Uint8Array(out));
  const [nodeX, nodeY, nodeZ] = reread.getRoot().listNodes()[0].getTranslation();
  const attribute = reread.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');

  const worldPositions = [];
  for (let i = 0; i < attribute.getCount(); i++) {
    const v = [];
    attribute.getElement(i, v);
    worldPositions.push([
      Math.round(v[0] + nodeX),
      Math.round(v[1] + nodeY),
      Math.round(v[2] + nodeZ),
    ]);
  }

  for (const [x, y, z] of offsets) {
    assert.ok(
      worldPositions.some((w) => w[0] === x && w[1] === y && w[2] === z),
      `corner ${[x, y, z]} is missing from world space after merging`
    );
  }
});

test('an already-optimal model survives a second pass unchanged', async () => {
  // Idempotence matters: nothing should degrade if a file is optimized twice.
  const input = await toArrayBuffer(fragmentedGlb(100, 2));
  const first = await optimizeGlb(input);
  const second = await optimizeGlb(first.buffer);
  assert.equal(second.stats.after.primitives, first.stats.after.primitives);
  assert.equal(second.stats.after.triangles, first.stats.after.triangles);
});
```

- [x] **Step 3: Run the test and verify it fails**

Run: `node --test scripts/tests/optimizeGlb.test.mjs`
Expected: FAIL — `Cannot find module .../lib/model/optimizeGlb.ts`

- [x] **Step 4: Write the implementation**

Create `lib/model/optimizeGlb.ts`:

```ts
import { WebIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, weld } from '@gltf-transform/functions';

/**
 * Collapses a fragmented glTF export into as few draw calls as its materials allow.
 *
 * CAD exporters — Rhino in particular — emit one node, one mesh and one primitive per
 * object *and* per material, merging nothing. The reference file that prompted this work
 * carried 7,995 primitives at a median of two triangles each. GPUs are indifferent to the
 * 228k triangles involved; they are not indifferent to 8,000 state changes per frame. That
 * file leaves here with 26 primitives and exactly the same triangles.
 *
 * WebIO rather than NodeIO on purpose: this runs in a Web Worker, and readBinary /
 * writeBinary never touch the filesystem or the network, so the same code path is what the
 * tests exercise under Node.
 */

export interface OptimizeCounts {
  primitives: number;
  triangles: number;
  nodes: number;
  bytes: number;
}

export interface OptimizeStats {
  before: OptimizeCounts;
  after: OptimizeCounts;
}

export interface OptimizeResult {
  buffer: ArrayBuffer;
  stats: OptimizeStats;
}

/** glTF primitive mode 4 is TRIANGLES. Line and point primitives carry no triangles. */
const MODE_TRIANGLES = 4;

function measure(doc: Document, bytes: number): OptimizeCounts {
  let primitives = 0;
  let triangles = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      if (prim.getMode() !== MODE_TRIANGLES) continue;
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : prim.getAttribute('POSITION')!.getCount();
      triangles += count / 3;
    }
  }

  return { primitives, triangles: Math.round(triangles), nodes: doc.getRoot().listNodes().length, bytes };
}

export async function optimizeGlb(input: ArrayBuffer): Promise<OptimizeResult> {
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(input));

  const before = measure(doc, input.byteLength);

  // Order is load-bearing. weld() must precede join(): run the other way round, join()
  // leaves a KHR_mesh_primitive_restart state that weld() refuses outright.
  await doc.transform(
    dedup(),                        // merge identical accessors / materials / textures
    flatten(),                      // bake node transforms, collapse the hierarchy
    dedup(),                        // flatten exposes duplicates the first pass could not see
    weld(),                         // index and merge co-located vertices
    join({ keepNamed: false }),     // merge primitives by material — the whole point
    prune({ keepLeaves: false })    // drop whatever the above orphaned
  );

  const output = await io.writeBinary(doc);
  // writeBinary hands back a Uint8Array that may be a view into a larger buffer; slice to
  // an exact, transferable ArrayBuffer so postMessage can hand it over without copying.
  const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;

  return { buffer, stats: { before, after: measure(doc, buffer.byteLength) } };
}
```

- [x] **Step 5: Run the test and verify it passes**

Run: `node --test scripts/tests/optimizeGlb.test.mjs`
Expected: PASS — 8 tests, 0 failures

- [x] **Step 6: Verify against the real reference file**

```bash
node --input-type=module -e "
import fs from 'fs';
import { optimizeGlb } from './lib/model/optimizeGlb.ts';
const raw = fs.readFileSync('/Users/user/Downloads/Rohit Resort Villas.glb');
const { stats } = await optimizeGlb(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
console.log(JSON.stringify(stats, null, 1));
"
```

Expected: `before.primitives` 7995 → `after.primitives` 26, and `triangles` **227463 on both sides**. If the triangle counts differ, stop — the lossless guarantee is broken.

- [x] **Step 7: Run the whole suite and commit**

Run: `npm test` → Expected: 169 passing, 0 failing

```bash
git add lib/model/optimizeGlb.ts scripts/tests/optimizeGlb.test.mjs package.json package-lock.json
git commit -m "feat(viewer): add lossless GLB draw-call optimizer"
```

---

## Task 4: Worker wrapper and browser-side launcher

Runs the optimizer off the main thread, in a process that can die without taking the tab with it.

**Files:**
- Create: `lib/model/optimizeWorker.ts`
- Create: `lib/model/runOptimize.ts`

**Interfaces:**
- Consumes: `optimizeGlb`, `OptimizeStats` from Task 3.
- Produces:
  - `OPTIMIZABLE_EXTENSIONS: ReadonlySet<string>`
  - `MAX_OPTIMIZE_BYTES: number`
  - `shouldOptimize(filename: string, bytes: number): boolean`
  - `runOptimize(file: File): Promise<OptimizeResult | null>` — resolves `null` on **any** failure.

- [x] **Step 1: Write the worker entry point**

Create `lib/model/optimizeWorker.ts`:

```ts
/// <reference lib="webworker" />
import { optimizeGlb } from './optimizeGlb';

/**
 * Worker entry. This module is the ONLY place @gltf-transform may enter the bundle graph —
 * it is large, and a reviewer who never uploads a model must not download it.
 *
 * Running here is not merely about keeping the main thread responsive. The optimizer peaks
 * at roughly 24x the input file in memory (523 MB on a 22 MB file), and an allocation that
 * large can fail outright. In a worker that failure kills the worker; on the main thread it
 * would kill the tab mid-upload.
 */

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const { buffer, stats } = await optimizeGlb(event.data);
    // Transfer rather than copy — this buffer is megabytes.
    (self as unknown as Worker).postMessage({ ok: true, buffer, stats }, [buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
```

- [x] **Step 2: Write the launcher**

Create `lib/model/runOptimize.ts`:

```ts
import type { OptimizeResult } from './optimizeGlb';

/**
 * Browser-side front door to the optimizer. Every failure path resolves `null`, which the
 * caller reads as "upload the original" — optimization is an improvement, never a gate.
 */

/** gltf-transform operates on glTF documents; nothing else in Stiko's format list is one. */
export const OPTIMIZABLE_EXTENSIONS: ReadonlySet<string> = new Set(['glb', 'gltf']);

/**
 * Measured peak memory ran ~24x the input size, so this projects to roughly 2.4 GB — near
 * the ceiling of what a browser tab will hand a worker before the allocation simply fails.
 * Above this the file uploads unoptimized rather than risking a long doomed attempt.
 */
export const MAX_OPTIMIZE_BYTES = 100 * 1024 * 1024;

/** Generous next to the ~6s the 22 MB reference file takes, tight enough to not strand an upload. */
const TIMEOUT_MS = 120_000;

export function shouldOptimize(filename: string, bytes: number): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = filename.slice(dot + 1).toLowerCase();
  return OPTIMIZABLE_EXTENSIONS.has(ext) && bytes <= MAX_OPTIMIZE_BYTES;
}

export function runOptimize(file: File): Promise<OptimizeResult | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      // new URL(..., import.meta.url) is how webpack 5 — and therefore Next 14 — discovers
      // and bundles a worker as a separate chunk.
      worker = new Worker(new URL('./optimizeWorker.ts', import.meta.url));
    } catch (error) {
      console.warn('Model optimization unavailable; uploading original.', error);
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (result: OptimizeResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.warn(`Model optimization exceeded ${TIMEOUT_MS}ms; uploading original.`);
      finish(null);
    }, TIMEOUT_MS);

    worker.onmessage = (event) => {
      const data = event.data as
        | { ok: true; buffer: ArrayBuffer; stats: OptimizeResult['stats'] }
        | { ok: false; error: string };
      if (!data.ok) {
        console.warn('Model optimization failed; uploading original.', data.error);
        finish(null);
        return;
      }
      finish({ buffer: data.buffer, stats: data.stats });
    };

    // Fires when the worker dies outright, which is the out-of-memory case.
    worker.onerror = (event) => {
      console.warn('Model optimization worker crashed; uploading original.', event.message);
      finish(null);
    };

    file
      .arrayBuffer()
      .then((buffer) => worker.postMessage(buffer, [buffer]))
      .catch(() => finish(null));
  });
}
```

- [x] **Step 3: Make `@gltf-transform` bundleable for the browser**

`@gltf-transform/core` ships `NodeIO` and `WebIO` in one bundle, and `NodeIO` does `import("node:fs")`. Webpack parses that whether or not `NodeIO` is reachable, so a browser-targeted build fails with `UnhandledSchemeError` the moment anything on the client imports the optimizer. The package's `browser` field maps bare `fs`/`path` to `false` but does not cover the `node:`-prefixed form.

In `next.config.mjs`, take webpack from the options argument (the app has no direct `webpack` dependency — importing it fails with `ERR_MODULE_NOT_FOUND`):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer, webpack }) => {
    config.resolve.alias.canvas = false;

    // Scoped to exactly `node:fs` and `node:path`. A blanket /^node:/ rule would also
    // rewrite any OTHER Node built-in a dependency drags in, turning a loud build failure
    // into a silent empty module — which is how a server-only import ends up shipped.
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:(fs|path)$/, (resource) => {
          resource.request = resource.request.slice('node:'.length);
        })
      );
    }

    return config;
  },
};

export default nextConfig;
```

- [x] **Step 4: Verify the worker chunk builds**

Run: `npm run build`
Expected: build succeeds. Confirm a separate worker chunk was emitted and that `@gltf-transform` is **not** in the main app chunks:

```bash
grep -rl "gltf-transform" .next/static/chunks/ | head
```

A plain `grep` proves little on its own, because a chunk being *emitted* does not tell you whether a page loads it. The decisive check is whether any page manifest references it:

```bash
for c in $(grep -rl "KHR_materials_transmission" .next/static/chunks/ | xargs -n1 basename | sed 's/\.js$//'); do
  echo "$c -> $(grep -o "$c" .next/build-manifest.json .next/app-build-manifest.json | wc -l) page refs"
done
```

Expected: **0 page refs** for every chunk carrying `@gltf-transform` — they load only via the worker. Also confirm `sharp` is absent: `grep -rl sharp .next/static/chunks/` should return nothing.

Note: in a workspace without `DATABASE_URL`, `npm run build` still fails at the *page-data collection* stage, which runs after client compilation. Client chunks are emitted regardless, so the checks above remain valid. Only a bundling error invalidates them.

- [x] **Step 5: Commit**

Two commits, because the build-config change is infrastructure that stands on its own and should be revertable independently of the worker:

```bash
git add lib/model/optimizeWorker.ts lib/model/runOptimize.ts
git commit -m "feat(viewer): run GLB optimization in an isolated web worker"

git add next.config.mjs
git commit -m "build: let @gltf-transform reach the browser worker bundle"
```

---

## Task 5: API support for the optimized variant

Both S3 keys are presigned in ONE call. The server mints the file id and derives both keys itself, so the client never names an object and there is no ordering problem to solve.

**Files:**
- Create: `lib/storageKeys.ts`
- Test: `scripts/tests/storageKeys.test.mjs`
- Modify: `app/api/files/upload/route.ts`
- Modify: `app/api/files/complete/route.ts`
- Modify: `lib/model/runOptimize.ts` (import the shared extension set instead of redeclaring it)

**Interfaces:**
- Produces:
  - `optimizedVariantKey(originalStorageKey: string): string` — pure, in `lib/storageKeys.ts`
  - `OPTIMIZABLE_EXTENSIONS: ReadonlySet<string>` and `isOptimizableFilename(filename: string): boolean` — same module
  - `POST /api/files/upload` additionally returns `variantPresignedUrl` and `variantStorageKey` when the filename is optimizable, and `null` for both otherwise
  - `POST /api/files/complete` accepts optional `hasOptimizedVariant: boolean`, defaulting to `false`

### Why one call, and why the client never names the key

Two earlier drafts were rejected on security grounds, both flagged by automated review and by the task review:

1. The client sending `convertedStorageKey` as a string — that makes a **client-controlled value the authoritative pointer the 3D viewer loads**.
2. The client sending `variantOfStorageKey` — that hands out a presigned PUT for an arbitrary `uploads/**` key, letting anyone overwrite another package's variant.

A third shape (look the key up by `variantOfFileId`) removed the arbitrary-write primitive but needed the file row to exist before the variant was presigned, and `/api/files/complete` does an `INSERT`. Making it an upsert was rejected: that removes the primary-key collision protection and widens the IDOR.

Presigning both keys in the same call dissolves all of it. The server already mints `fileId` and builds `storageKey` there, so it can derive the variant key in the same breath. **Zero new client-controlled input** — the only thing the client later asserts is a boolean.

**This does NOT fix the pre-existing gap** that `/api/files/upload` and `/api/files/complete` have no authentication while `/api/files` and `/api/files/url` do. That is tracked separately. This design simply needs no authentication to be safe, because it adds no new trust surface.

- [x] **Step 1: Write the failing test for the key helpers**

Create `scripts/tests/storageKeys.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  optimizedVariantKey,
  isOptimizableFilename,
} from '../../lib/storageKeys.ts';

test('the variant key replaces the extension of the last segment', () => {
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.glb'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('a .gltf original still yields a .glb variant', () => {
  // The optimizer always writes binary GLB, whatever the input was.
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.gltf'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('an original with no extension still gets one', () => {
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('a dot in the directory prefix is not mistaken for the extension', () => {
  assert.equal(
    optimizedVariantKey('uploads/my.project/po.1/v/abc-123.glb'),
    'uploads/my.project/po.1/v/abc-123.optimized.glb'
  );
});

test('deriving from an already-optimized key is idempotent', () => {
  // Guards against `.optimized.optimized.glb` if the helper is ever applied twice.
  const once = optimizedVariantKey('uploads/p/po/v/abc-123.glb');
  assert.equal(optimizedVariantKey(once), once);
});

test('only glb and gltf are optimizable', () => {
  for (const name of ['m.glb', 'm.gltf', 'M.GLB', 'a.b.glb']) {
    assert.equal(isOptimizableFilename(name), true, name);
  }
  for (const name of ['m.step', 'm.obj', 'm.stl', 'm.pdf', 'noext', '.glb']) {
    assert.equal(isOptimizableFilename(name), false, name);
  }
});
```

Note `'.glb'` is expected `false`: a leading dot is a hidden file with no extension, not a GLB.

- [x] **Step 2: Run it and watch it fail**

Run: `node --test scripts/tests/storageKeys.test.mjs`
Expected: FAIL — `Cannot find module .../lib/storageKeys.ts`

- [x] **Step 3: Write `lib/storageKeys.ts`**

```ts
/**
 * S3 key derivation, kept pure and free of environment access.
 *
 * Deliberately NOT in lib/s3.ts: that module throws at import time when the R2 env vars
 * are absent, so nothing there can be unit tested.
 *
 * The variant key is always DERIVED, never accepted from a caller. An earlier draft let
 * the client name it, which hands out a presigned PUT for an arbitrary key — and that
 * object is exactly what the 3D viewer loads.
 */

/** gltf-transform operates on glTF documents; no other format Stiko accepts is one. */
export const OPTIMIZABLE_EXTENSIONS: ReadonlySet<string> = new Set(['glb', 'gltf']);

const OPTIMIZED_SUFFIX = '.optimized.glb';

export function isOptimizableFilename(filename: string): boolean {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  // dot === 0 is a hidden file ('.glb'), which has no extension at all.
  if (dot <= 0) return false;
  return OPTIMIZABLE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

export function optimizedVariantKey(originalStorageKey: string): string {
  if (originalStorageKey.endsWith(OPTIMIZED_SUFFIX)) return originalStorageKey;

  const slash = originalStorageKey.lastIndexOf('/');
  const directory = originalStorageKey.slice(0, slash + 1);
  const base = originalStorageKey.slice(slash + 1);

  // Only the last segment is examined, so a dot in a project or portal name is safe.
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;

  return `${directory}${stem}${OPTIMIZED_SUFFIX}`;
}
```

- [x] **Step 4: Run it and watch it pass**

Run: `node --test scripts/tests/storageKeys.test.mjs`
Expected: PASS — 6 tests

- [x] **Step 5: Presign both keys in the upload route**

Replace the body of `POST` in `app/api/files/upload/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPresignedUrl, getPublicUrl } from '@/lib/s3';
import { isOptimizableFilename, optimizedVariantKey } from '@/lib/storageKeys';

// Step 1: Request a presigned URL for direct S3 upload
export async function POST(request: NextRequest) {
  const { versionId, projectId, portalId, filename, contentType } = await request.json();

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const fileId = uuidv4();
  const storageKey = `uploads/${projectId}/${portalId}/${versionId}/${fileId}${ext}`;

  const presignedUrl = await getUploadPresignedUrl(storageKey, contentType);

  // The optimized variant is presigned HERE, in the same call, rather than in a later
  // round trip. The server has just minted the id and built the original key, so it can
  // derive the variant key itself — the client never names an object it will later read
  // back, and there is no window in which the file row must already exist.
  //
  // Presigning a variant the client may never use costs nothing: the URL simply expires.
  const variantStorageKey = isOptimizableFilename(filename)
    ? optimizedVariantKey(storageKey)
    : null;

  return NextResponse.json({
    fileId,
    presignedUrl,
    storageKey,
    publicUrl: getPublicUrl(storageKey),
    variantStorageKey,
    variantPresignedUrl: variantStorageKey
      ? await getUploadPresignedUrl(variantStorageKey, 'model/gltf-binary')
      : null,
  });
}
```

- [x] **Step 6: Record the variant when registering the file**

Replace the body of `POST` in `app/api/files/complete/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { optimizedVariantKey } from '@/lib/storageKeys';

// Step 2: After the client has uploaded to S3, register the file in the DB
export async function POST(request: NextRequest) {
  const {
    fileId, versionId, filename, storageKey, fileSize, fileType, folderPath,
    hasOptimizedVariant,
  } = await request.json();

  // Derived from the original key, never accepted from the caller. The client asserts only
  // THAT a variant exists; the server decides where it is.
  const convertedStorageKey = hasOptimizedVariant ? optimizedVariantKey(storageKey) : null;

  // conversion_status stays NULL here on purpose. 'completed' means a CloudConvert job
  // finished, and the STEP flow reads it that way; a client-optimized GLB is not that.
  // converted_storage_key is populated independently of the status column.
  const rows = await sql`
    INSERT INTO files (id, version_id, filename, storage_key, file_size, file_type, folder_path, converted_storage_key)
    VALUES (${fileId}, ${versionId}, ${filename}, ${storageKey}, ${fileSize}, ${fileType}, ${folderPath || null}, ${convertedStorageKey})
    RETURNING id, version_id AS "versionId", filename, storage_key AS "storageKey",
              file_size AS "fileSize", file_type AS "fileType",
              conversion_status AS "conversionStatus",
              converted_storage_key AS "convertedStorageKey",
              folder_path AS "folderPath",
              created_at AS "createdAt"
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
```

- [x] **Step 7: Point `runOptimize` at the shared extension set**

In `lib/model/runOptimize.ts`, delete its local `OPTIMIZABLE_EXTENSIONS` declaration and re-export the shared one so there is exactly one definition:

```ts
import { isOptimizableFilename } from '@/lib/storageKeys';
export { OPTIMIZABLE_EXTENSIONS } from '@/lib/storageKeys';
```

Then `shouldOptimize` becomes:

```ts
export function shouldOptimize(filename: string, bytes: number): boolean {
  return isOptimizableFilename(filename) && bytes <= MAX_OPTIMIZE_BYTES;
}
```

- [x] **Step 8: Typecheck, test and commit**

Run: `npx tsc --noEmit` → clean
Run: `npm test` → 175 passing, 0 failing (169 + 6 new)

Do NOT run `npm run build`: this workspace has no `DATABASE_URL`, so it always fails at page-data collection for unrelated reasons.

```bash
git add lib/storageKeys.ts scripts/tests/storageKeys.test.mjs app/api/files/upload/route.ts app/api/files/complete/route.ts lib/model/runOptimize.ts
git commit -m "feat(files): presign the optimized variant alongside the original"
```

---

## Task 6: Optimize during upload

**Files:**
- Modify: `lib/useUpload.ts`
- Modify: `components/ui/UploadProgress.tsx` (the `UploadState` union and the progress label)

**Interfaces:**
- Consumes: `runOptimize`, `shouldOptimize` from Task 4; `variantPresignedUrl` from Task 5's `/api/files/upload`; `hasOptimizedVariant` on `/api/files/complete`.
- Produces: `UploadState` gains `'optimizing'`.

### Call order

Because Task 5 presigns both keys in one call, the sequence stays as simple as it was before any of the variant work — a single `/api/files/complete` at the end, no upsert, no second round trip:

1. `POST /api/files/upload` → returns `presignedUrl` **and** `variantPresignedUrl`.
2. PUT the original to `presignedUrl`.
3. If `variantPresignedUrl` exists and the file is worth optimizing: optimize locally, and on success PUT the optimized bytes to `variantPresignedUrl`.
4. `POST /api/files/complete` once, with `hasOptimizedVariant` reflecting whether step 3 actually succeeded.

`state: 'done'` is set only after step 4, exactly as it is today.

- [x] **Step 1: Add the `optimizing` state to the UI type**

In `components/ui/UploadProgress.tsx`, line 6:

```ts
export type UploadState = 'pending' | 'uploading' | 'optimizing' | 'done' | 'failed';
```

Then replace the progress-label block (currently line 77):

```tsx
          {item.state === 'optimizing' && (
            <span className="text-stiko-muted">Optimising…</span>
          )}
          {(item.state === 'uploading' || item.state === 'pending') && (
            <span className="text-stiko-muted">
              {item.progress}% · {formatSize(item.bytes)}
            </span>
          )}
```

The existing `track` fallback already covers the new state — anything that is not `done` or `failed` uses `#F1F3FF`.

- [x] **Step 2: Add the import and widen the presign destructure**

In `lib/useUpload.ts`:

```ts
import { runOptimize, shouldOptimize } from '@/lib/model/runOptimize';
```

Then widen the existing destructure of the presign response to pick up the variant URL:

```ts
const { fileId, presignedUrl, storageKey, variantPresignedUrl } = await presignRes.json();
```

- [x] **Step 3: Optimize between the original PUT and the complete call**

In `uploadOne`, immediately after the original upload's `await new Promise<void>(...)` block and before the `const folderPath = ...` line, insert:

```ts
        // Optimization happens AFTER the original is safely in S3, so a failure here can
        // never cost the upload. The original is what the uploader downloads; the
        // optimized copy is only ever what the viewer loads.
        //
        // The variant URL was presigned in the SAME call that presigned the original, so
        // there is no second round trip and the client never names the object it uploads.
        //
        // The entire optimization block — including the runOptimize call — is wrapped in
        // try/finally to enforce the invariant that state is ALWAYS restored on every path,
        // even if runOptimize (or any future change) unexpectedly rejects.
        let hasOptimizedVariant = false;
        if (variantPresignedUrl && shouldOptimize(entry.file.name, entry.file.size)) {
          patch(entry.path, { state: 'optimizing' });
          try {
            const optimized = await runOptimize(entry.file);

            if (optimized) {
              try {
                const put = await fetch(variantPresignedUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'model/gltf-binary' },
                  body: optimized.buffer,
                });
                if (!put.ok) throw new Error(`Variant upload failed (${put.status})`);

                hasOptimizedVariant = true;
                const { before, after } = optimized.stats;
                console.info(
                  `Optimised ${entry.file.name}: ${before.primitives} → ${after.primitives} draw calls, ` +
                    `${after.triangles} triangles preserved, ` +
                    `${Math.round(before.bytes / 1024)}KB → ${Math.round(after.bytes / 1024)}KB`
                );
              } catch (err) {
                // Same policy as everywhere else here: the original is already uploaded and
                // the viewer falls back to it, so this is a downgrade, not a failure.
                console.warn(`Could not store optimised copy of ${entry.file.name}`, err);
                hasOptimizedVariant = false;
              }
            }
          } catch (err) {
            // Optimization may fail at any step: worker unavailable, timeout, out of memory,
            // or any error from runOptimize. None of these should block or fail the upload.
            console.warn(`Optimization failed for ${entry.file.name}`, err);
            hasOptimizedVariant = false;
          } finally {
            patch(entry.path, { state: 'uploading' });
          }
        }
```

- [x] **Step 4: Report the variant when registering the file**

Add one line to the `/api/files/complete` request body, after `folderPath`. The client reports only *that* a variant exists; the server derives *where* it is:

```ts
            folderPath,
            hasOptimizedVariant,
```

- [x] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit` → clean
Run: `npm test` → 175 passing, 0 failing (unchanged by this task)

Do NOT run `npm run build`: this workspace has no `DATABASE_URL`, so it always fails at page-data collection for unrelated reasons.

- [x] **Step 6: Verify end to end**

Upload `Rohit Resort Villas.glb` through the submit flow and confirm in the browser console:

```
Optimised Rohit Resort Villas.glb: 7995 → 26 draw calls, 227463 triangles preserved, 22191KB → 9575KB
```

Then confirm in S3 that both objects exist — `{fileId}.glb` and `{fileId}.optimized.glb` — and that the `files` row has `converted_storage_key` set with `conversion_status` still `NULL`.

- [x] **Step 7: Commit**

```bash
git add lib/useUpload.ts components/ui/UploadProgress.tsx
git commit -m "feat(upload): optimize GLB uploads in the browser before registering them"
```

---

## Task 7: Serve the optimized model to the viewer

The step that actually makes the viewer fast. Deliberately last of the geometry work, so the data exists and has been eyeballed before anything depends on it.

**Files:**
- Modify: `components/viewers/ViewerContainer.tsx` (the presigned-URL `useEffect`, currently lines 73–86)
- Modify: `lib/types.ts` if `ViewerContainer`'s local file prop type does not already carry `convertedStorageKey`

**Interfaces:**
- Consumes: `convertedStorageKey`, already returned by `/api/files` and `/api/files/complete` and already present on `lib/types.ts`, `FileList.tsx` and `FileTreeSidebar.tsx`.

- [x] **Step 1: Prefer the optimized key**

In `components/viewers/ViewerContainer.tsx`, replace the presigned-URL effect:

```tsx
  // The optimized copy is what the viewer wants whenever one exists; downloads elsewhere
  // still serve file.storageKey, so an uploader always gets their own file back untouched.
  //
  // This branches on convertedStorageKey alone and never on conversionStatus: a
  // client-optimized GLB leaves conversion_status NULL, because that column means "a
  // CloudConvert job reached this state" and nothing else.
  const viewerKey = file.convertedStorageKey ?? file.storageKey;

  useEffect(() => {
    setUrl(null);
    setError(false);

    fetch(`/api/files/url?key=${encodeURIComponent(viewerKey)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to get file URL');
        return res.json();
      })
      .then(data => setUrl(data.url))
      .catch(() => setError(true));
  }, [viewerKey]);
```

- [x] **Step 2: Make sure the prop type carries the field**

Check the `file` prop type used by `ViewerContainerProps`. If it does not include `convertedStorageKey`, add it:

```ts
  convertedStorageKey: string | null;
```

Run: `npx tsc --noEmit`
Expected: no errors. A `Property 'convertedStorageKey' does not exist` error means this step was needed and is not yet done.

- [x] **Step 3: Verify the payoff**

Open the package containing the optimized `Rohit Resort Villas.glb` and confirm:
- Orbit, pan and zoom are smooth.
- The network tab fetches the `.optimized.glb` object, not the original.
- In the console, `renderer.info.render.calls` is in the tens rather than the thousands.
- Comment pins still land exactly where clicked, and existing pins appear in the right place.
- Cross-section still cuts, the transform gizmo still moves the model, and snapshots still capture.

Pin placement is the one to watch: `flatten()` bakes node transforms into vertex data, so world positions are preserved — but this is the assumption worth confirming with a real click rather than trusting.

- [x] **Step 4: Commit**

```bash
git add components/viewers/ViewerContainer.tsx lib/types.ts
git commit -m "feat(viewer): load the optimized model variant when one exists"
```

---

## Task 8: Stop rendering an idle scene

Independent polish. **Revert this whole task rather than debug it under pressure** — the geometry and material fixes do not depend on it.

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx` (the `Canvas`, currently line 520)

- [x] **Step 1: Cap the device pixel ratio**

Add to the `Canvas` props:

```tsx
        // A 3x display renders 9x the fragments of a 1x one for no reviewable detail.
        dpr={[1, 2]}
```

Run: `npm run build` and confirm the viewer still renders. This change is low risk and can stand alone.

- [x] **Step 2: Commit the safe half**

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "perf(viewer): cap device pixel ratio at 2x"
```

### Deferred — needs browser verification

Steps 3–5 require interactive verification in a running browser. No browser is available in the automated environment, and this task was scoped to deliver the safe half (Steps 1–2) first. The work below is complete and ready; whoever runs the next phase should use the checklist to verify all eight interactive controls before committing.

- [ ] **Step 3: Switch to on-demand rendering**

Add to the `Canvas` props:

```tsx
        // Nothing moves in a review viewport most of the time. On demand, a frame is drawn
        // when something invalidates it rather than 60 times a second regardless.
        frameloop="demand"
```

- [ ] **Step 4: Audit every control that changes the scene without moving the camera**

`OrbitControls` with `makeDefault` invalidates on change, so orbit/pan/zoom are covered. Everything driven by React state is not, and needs `invalidate()` from `useThree()` when it changes. Walk this list in the running app and confirm each one visibly updates:

- [ ] Orbit, pan, zoom
- [ ] Focal length slider (`FocalLengthControl` → `ApplyFocalLength`)
- [ ] Cross-section axis, offset and flip (`CrossSectionControl`)
- [ ] Transform gizmo move and rotate (`TransformGizmo`)
- [ ] View gizmo cube faces (`ViewGizmo`)
- [ ] Comment pin placement, and pin screen positions after a camera move
- [ ] Initial model load and camera fit (`FitCameraToModel`)
- [ ] **Snapshot capture** (`CleanFrameRenderer`, `gl.preserveDrawingBuffer`)

For any that fails to update, add `invalidate()` at the point the state changes:

```ts
const invalidate = useThree((state) => state.invalidate);
// ...call invalidate() after the change that should be visible
```

- [ ] **Step 5: Decide**

If every item passes, commit:

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "perf(viewer): render on demand instead of continuously"
```

If snapshot capture produces a blank or stale image and an `invalidate()` before capture does not fix it, revert this step and leave the `dpr` cap in place:

```bash
git checkout components/viewers/ModelViewerInner.tsx
```

Then record in the spec's Out of scope section that on-demand rendering was attempted and reverted, and why.

---

## Final verification

- [x] `npm test` → 177 passing, 0 failing (grew from the 169 this line originally named as later tasks and the final review pass added their own tests)
- [x] `npx tsc --noEmit` → clean
- [ ] `npm run build` → succeeds, and `@gltf-transform` appears only in a standalone worker chunk — not verified in this workspace; it has no `DATABASE_URL`, so the build always fails at page-data collection regardless of this change
- [ ] Upload `Rohit Resort Villas.glb`: console reports 7995 → 26 draw calls with 227463 triangles preserved
- [ ] The previously black third of the model shades correctly
- [ ] Orbit is smooth; `renderer.info.render.calls` is in the tens
- [ ] Comment pins, cross-section, transform gizmo and snapshots all still work
- [ ] Upload a non-glTF model (STL or OBJ): uploads normally, `converted_storage_key` is `NULL`, viewer still loads it, material repair still applies
- [ ] Upload a non-model file (PDF or image): entirely unaffected
