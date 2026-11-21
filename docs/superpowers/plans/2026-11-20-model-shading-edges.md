# Model Shading & Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 3D models in the viewer look the way they do in Onshape. That means thin dark crease
edges, a semi-gloss finish on Stiko's own CAD conversions, and camera-relative key/fill/hemisphere
lighting instead of the headlight.

**Architecture:**
- **Edges:** each part's geometry is copied to a web worker. The worker finds crease edges
  (faces meeting at 30° or more) with a pure, three-free extractor. The main thread bakes each
  part's placement into the segments and merges them into ONE `LineSegments`, with per-part
  index ranges so hiding a part hides its edges.
- **Finish:** a viewer-side pass changes the converters' exact `roughness 0.6 / metal 0 / no maps`
  signature to 0.38.
- **Lighting:** a rewrite of `SceneLighting.tsx`, driven by a small pure helper that places a
  light from a camera-space offset.

**Tech Stack:**
- three r169, @react-three/fiber 8, @react-three/drei 9, Next.js (webpack worker via
  `new Worker(new URL(...))`)
- tests: `node --test` on `.mjs` files that import `.ts` directly (Node 25 type stripping)

**Spec:** `docs/superpowers/specs/2026-11-20-model-shading-edges-design.md`

## Global Constraints

- **Edges:**
  - 1 px `LineBasicMaterial`, colour `#2b2f36`, opaque.
  - They never change with part colour or highlight.
  - `raycast` is a no-op.
- **Crease threshold:** `30` degrees, as a named constant.
- **Edge triangle budget:** `1_500_000` triangles. Above it there are no edges.
  - This changes the spec's reasoning but not its number. The spec assumed synchronous work, and
    measured `THREE.EdgesGeometry` takes **5.5 s** on 1.5 M triangles on the main thread. The
    custom extractor in a worker takes **~1.25 s**, off the main thread.
- **Finish:** converter signature `metalness === 0`, `|roughness − 0.6| < 1e-6`, no maps.
  - It becomes roughness `0.38`.
  - Colour and metalness are never touched.
  - Converters (`lib/model/stepToGlb.ts`, `cad-worker/usd_to_glb.py`) are NOT changed.
- **Lights** (starting values, tuned in Task 7):

  | Light | Camera-space offset (x, y, z) | Intensity |
  |---|---|---|
  | Key | `(-0.58, 0.70, 1)` | 1.4 |
  | Fill | `(0.70, -0.15, 1)` | 0.45 |
  | Hemisphere | sky `#ffffff` / ground `#b8bcc4` | 0.5 |
  | Environment | `studio` | 0.7 |

  The ambient light is removed.
- **Polygon offset:** every face material in a loaded model gets `polygonOffset: true`,
  `polygonOffsetFactor: 1`, `polygonOffsetUnits: 1`. So do `DEFAULT_MATERIAL` and
  `VERTEX_COLOR_MATERIAL`.
- **Node-test import rules:**
  - Modules under `lib/` that tests import must NOT use the `@/` alias.
  - Relative imports between tested lib modules carry the `.ts` extension, as
    `lib/model/buildBatches.ts` does.
- **Map iteration:** use `.forEach`, never `for...of` (TS2802 under `next build`).
- **Git:**
  - Never `git add -A` or `git add .`; three untracked handoff dirs sit in the working tree. Add
    files by name.
  - Work on branch `feature/model-shading-edges`, which already exists.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Typecheck command:** `npx tsc --noEmit -p .`. Expected: no output, exit 0.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/model/cadFinish.ts` | create | `applyCadFinish(root)`: semi-gloss for converter-default materials |
| `lib/threeMaterials.ts` | modify | add `offsetFacesBehindEdges(root)` |
| `lib/model/creaseEdges.ts` | create | `extractCreaseEdges(positions, index, thresholdDeg)`: pure, no three import |
| `lib/model/buildEdges.ts` | create | collect per-part sources; assemble merged `LineSegments`; `setHidden` |
| `lib/model/edgeWorker.ts` | create | worker entry that runs `extractCreaseEdges` per job |
| `lib/model/runEdges.ts` | create | `computeModelEdges(sources)`: budget check, worker lifecycle, cancel |
| `lib/sceneLights.ts` | create | `placeCameraRelativeLight(...)` plus the rig constants |
| `components/viewers/SceneLighting.tsx` | rewrite | key + fill + hemisphere + environment |
| `components/viewers/ModelViewerInner.tsx` | modify | wire finish, polygon offset, edges, hiding |
| `lib/model/repairMaterials.ts` | modify | comment only: environment 0.15 becomes 0.7 |
| `scripts/tests/cadFinish.test.mjs` | create | |
| `scripts/tests/threeMaterials.test.mjs` | modify | polygon-offset tests |
| `scripts/tests/creaseEdges.test.mjs` | create | |
| `scripts/tests/buildEdges.test.mjs` | create | |
| `scripts/tests/sceneLights.test.mjs` | create | |

---

### Task 1: Semi-gloss finish for converter-default materials

**Files:**
- Create: `lib/model/cadFinish.ts`
- Test: `scripts/tests/cadFinish.test.mjs`
- Modify: `components/viewers/ModelViewerInner.tsx`:
  - the import block (around line 20)
  - `DEFAULT_MATERIAL` / `VERTEX_COLOR_MATERIAL` (lines 213-225)
  - the repair `useMemo` (around lines 351-357)

**Interfaces:**
- Produces: `applyCadFinish<T extends THREE.Object3D>(root: T): T`, `CAD_FINISH_ROUGHNESS = 0.38`,
  `CONVERTER_ROUGHNESS = 0.6`

- [ ] **Step 1: Write the failing test.** Create `scripts/tests/cadFinish.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyCadFinish, CAD_FINISH_ROUGHNESS } from '../../lib/model/cadFinish.ts';

const wrap = (...materials) => {
  const root = new THREE.Group();
  for (const material of materials) root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  return root;
};
/** Exactly what lib/model/stepToGlb.ts and cad-worker/usd_to_glb.py emit. */
const converterDefault = (overrides = {}) =>
  new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0, roughness: 0.6, ...overrides });

test('a converter-default material becomes semi-gloss', () => {
  const material = converterDefault();
  applyCadFinish(wrap(material));
  assert.equal(material.roughness, CAD_FINISH_ROUGHNESS);
});

test('the float32 round-trip of 0.6 still matches', () => {
  const material = converterDefault({ roughness: Math.fround(0.6) });
  applyCadFinish(wrap(material));
  assert.equal(material.roughness, CAD_FINISH_ROUGHNESS);
});

test('colour and metalness are never touched', () => {
  const material = converterDefault({ color: 0xc8a05a });
  applyCadFinish(wrap(material));
  assert.equal(material.color.getHexString(), 'c8a05a');
  assert.equal(material.metalness, 0);
});

test('an authored finish is left alone', () => {
  const rougher = converterDefault({ roughness: 0.5 });
  const metal = converterDefault({ metalness: 1 });
  const textured = converterDefault({ map: new THREE.Texture() });
  const normalMapped = converterDefault({ normalMap: new THREE.Texture() });
  applyCadFinish(wrap(rougher, metal, textured, normalMapped));
  assert.equal(rougher.roughness, 0.5);
  assert.equal(metal.roughness, 0.6);
  assert.equal(textured.roughness, 0.6);
  assert.equal(normalMapped.roughness, 0.6);
});

test('non-PBR materials are skipped without throwing', () => {
  const basic = new THREE.MeshBasicMaterial();
  assert.doesNotThrow(() => applyCadFinish(wrap(basic)));
});

test('material arrays are handled', () => {
  const a = converterDefault();
  const b = converterDefault();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), [a, b]));
  applyCadFinish(root);
  assert.equal(a.roughness, CAD_FINISH_ROUGHNESS);
  assert.equal(b.roughness, CAD_FINISH_ROUGHNESS);
});

test('a second pass is a no-op (useLoader caches the tree)', () => {
  const material = converterDefault();
  const root = wrap(material);
  applyCadFinish(root);
  applyCadFinish(root);
  assert.equal(material.roughness, CAD_FINISH_ROUGHNESS);
});

test('returns root for inline use', () => {
  const root = wrap(converterDefault());
  assert.equal(applyCadFinish(root), root);
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `node --test scripts/tests/cadFinish.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/model/cadFinish.ts`

- [ ] **Step 3: Implement.** Create `lib/model/cadFinish.ts`:

```ts
import * as THREE from 'three';

/**
 * Gives Stiko's own CAD conversions a semi-gloss finish, in the viewer.
 *
 * Both converters (lib/model/stepToGlb.ts and cad-worker/usd_to_glb.py) write every part as
 * `roughness 0.6, metallic 0`. Under that matte finish a curved face has no highlight gradient,
 * which is the eye's main cue for curvature, so a cylinder, a fillet and a flat face all read
 * as the same flat tone. Onshape-style semi-gloss puts that cue back.
 *
 * Done here rather than in the converters so files already uploaded get it too, with no
 * re-conversion. The signature is exact: a designer-authored glTF finish almost never sits at
 * precisely 0.6 with no maps, so their work is left as they made it.
 *
 * Runs after repairExporterDefaults (whose repaired materials sit at 0.8 and so never match)
 * and before buildBatches (which reads roughness into its appearance key). Idempotent:
 * useLoader caches the tree, and a second pass finds 0.38, not 0.6.
 *
 * Deliberately no `needsUpdate`: roughness is a uniform.
 */

/** What both converters write. */
export const CONVERTER_ROUGHNESS = 0.6;

/**
 * The finish they get in the viewer. Tuned on screenshots. Lower washes pale parts out into
 * glare, which loses detail instead of adding it.
 */
export const CAD_FINISH_ROUGHNESS = 0.38;

/** glTF stores factors as float32; 0.6 comes back as 0.6000000238. */
const TOLERANCE = 1e-6;

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;

function isConverterDefault(material: THREE.Material): material is THREE.MeshStandardMaterial {
  const standard = material as THREE.MeshStandardMaterial;
  if (standard.isMeshStandardMaterial !== true) return false;
  if (standard.metalness !== 0) return false;
  if (Math.abs(standard.roughness - CONVERTER_ROUGHNESS) > TOLERANCE) return false;
  return MAP_KEYS.every((key) => !standard[key]);
}

export function applyCadFinish<T extends THREE.Object3D>(root: T): T {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (isConverterDefault(material)) material.roughness = CAD_FINISH_ROUGHNESS;
    }
  });
  return root;
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `node --test scripts/tests/cadFinish.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Wire it into the viewer.** In `components/viewers/ModelViewerInner.tsx`:

  1. Add the import after the `repairExporterDefaults` import (line 20):

  ```ts
  import { applyCadFinish, CAD_FINISH_ROUGHNESS } from '@/lib/model/cadFinish';
  ```

  2. In `DEFAULT_MATERIAL` and `VERTEX_COLOR_MATERIAL`, replace `roughness: 0.6,` with
     `roughness: CAD_FINISH_ROUGHNESS,` (both occurrences).

  3. In the `useMemo` that runs `repairExporterDefaults(root); makeDoubleSided(root);`, insert
     `applyCadFinish(root);` between them:

  ```ts
      repairExporterDefaults(root);
      applyCadFinish(root);
      makeDoubleSided(root);
  ```

  4. Extend the comment above that memo by one sentence: "The CAD finish runs after repair
     (a repaired material sits at 0.8 and never matches) and before batching (roughness is part
     of the batch appearance key)."

- [ ] **Step 6: Typecheck and run the full suite.**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc silent; all tests pass

- [ ] **Step 7: Commit.**

```bash
git add lib/model/cadFinish.ts scripts/tests/cadFinish.test.mjs components/viewers/ModelViewerInner.tsx
git commit -m "feat(viewer): semi-gloss finish for Stiko's own CAD conversions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Polygon offset so faces sit behind their own edges

**Files:**
- Modify: `lib/threeMaterials.ts` (append a function)
- Test: `scripts/tests/threeMaterials.test.mjs` (append tests)

**Interfaces:**
- Produces: `offsetFacesBehindEdges<T extends THREE.Object3D>(root: T): T`. It sets
  `polygonOffset=true, polygonOffsetFactor=1, polygonOffsetUnits=1` on every material of every
  `isMesh` object. Lines and points are skipped, because polygon offset does nothing for them.

- [ ] **Step 1: Write the failing test.** Append to `scripts/tests/threeMaterials.test.mjs`.
  Change the existing import line from `import { setClippingPlanes } from '../../lib/threeMaterials.ts';`
  to:

```js
import { setClippingPlanes, offsetFacesBehindEdges } from '../../lib/threeMaterials.ts';
```

Then append:

```js
test('offsetFacesBehindEdges pushes every mesh material back, arrays included', () => {
  const single = new THREE.MeshStandardMaterial();
  const a = new THREE.MeshStandardMaterial();
  const b = new THREE.MeshStandardMaterial();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), single));
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), [a, b]));

  offsetFacesBehindEdges(root);

  for (const material of [single, a, b]) {
    assert.equal(material.polygonOffset, true);
    assert.equal(material.polygonOffsetFactor, 1);
    assert.equal(material.polygonOffsetUnits, 1);
  }
});

test('offsetFacesBehindEdges leaves line materials alone', () => {
  const lineMaterial = new THREE.LineBasicMaterial();
  const root = new THREE.Group();
  root.add(new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial));

  offsetFacesBehindEdges(root);

  assert.equal(lineMaterial.polygonOffset, false);
});

test('offsetFacesBehindEdges survives the clone buildBatches makes', () => {
  // buildBatches' batchMaterialFrom() clones the source material; Material.copy carries the
  // offset over, which is why offsetting the loaded tree is enough for the batched path too.
  const source = new THREE.MeshStandardMaterial();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), source));
  offsetFacesBehindEdges(root);

  const clone = source.clone();
  assert.equal(clone.polygonOffset, true);
  assert.equal(clone.polygonOffsetFactor, 1);
  assert.equal(clone.polygonOffsetUnits, 1);
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `node --test scripts/tests/threeMaterials.test.mjs`
Expected: FAIL, with `offsetFacesBehindEdges is not a function`, or a SyntaxError on the missing
named export

- [ ] **Step 3: Implement.** Append to `lib/threeMaterials.ts`:

```ts
/**
 * Nudges every face in `root` slightly back in depth so the edge lines drawn on top of them
 * (lib/model/buildEdges.ts) win the depth test cleanly instead of z-fighting into a dashed
 * shimmer while the camera moves. An edge sits exactly on the boundary of the faces it
 * separates, so without this half its pixels lose to its own faces.
 *
 * Faces only: polygon offset has no effect on lines or points, and the edge material itself
 * must NOT be offset, or the lines would sink behind the faces they outline.
 *
 * Mutates in place (loader results are cached and shared by useLoader) and returns `root`.
 * Idempotent. buildBatches clones these materials, and Material.copy carries the offset over.
 */
export function offsetFacesBehindEdges<T extends THREE.Object3D>(root: T): T {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh !== true || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = 1;
      material.polygonOffsetUnits = 1;
    }
  });
  return root;
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `node --test scripts/tests/threeMaterials.test.mjs`
Expected: PASS (existing tests plus 3 new)

- [ ] **Step 5: Commit.** This task does no viewer wiring; Task 5 wires it together with the
  edges, since it means nothing without them.

```bash
git add lib/threeMaterials.ts scripts/tests/threeMaterials.test.mjs
git commit -m "feat(viewer): offsetFacesBehindEdges, so edge lines do not z-fight their faces

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure crease-edge extractor

**Files:**
- Create: `lib/model/creaseEdges.ts`. It must NOT import three: it runs inside the worker, and
  importing three would pull all of three into the worker chunk.
- Test: `scripts/tests/creaseEdges.test.mjs`

**Interfaces:**
- Produces:
  - `extractCreaseEdges(positions: Float32Array, index: Uint32Array | null, thresholdDeg: number): Float32Array`
    returns segment endpoints `[x0,y0,z0, x1,y1,z1, ...]`, 6 floats per segment, in the same
    (local) space as `positions`.
  - `CREASE_THRESHOLD_DEG = 30`

Behaviour it must match: `THREE.EdgesGeometry(geometry, 30)`. Measured on 2026-11-20 with a
prototype of exactly this algorithm: box 12/12, non-indexed box 12/12, 64-segment cylinder
128/128, torus knot 0/0, and 1.5 M-triangle sphere 0/0 in 1253 ms (three: 5511 ms).

- [ ] **Step 1: Write the failing test.** Create `scripts/tests/creaseEdges.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { extractCreaseEdges, CREASE_THRESHOLD_DEG } from '../../lib/model/creaseEdges.ts';

const arrays = (geometry) => ({
  positions: geometry.getAttribute('position').array,
  index: geometry.index ? Uint32Array.from(geometry.index.array) : null,
});
const segmentsOf = (geometry, threshold = CREASE_THRESHOLD_DEG) => {
  const { positions, index } = arrays(geometry);
  return extractCreaseEdges(positions, index, threshold).length / 6;
};
const threeCount = (geometry) =>
  new THREE.EdgesGeometry(geometry, CREASE_THRESHOLD_DEG).getAttribute('position').count / 2;

test('threshold constant is 30 degrees', () => {
  assert.equal(CREASE_THRESHOLD_DEG, 30);
});

test('a box has exactly its 12 edges', () => {
  assert.equal(segmentsOf(new THREE.BoxGeometry(1, 1, 1)), 12);
});

test('a non-indexed box welds its duplicated corners and still finds 12', () => {
  assert.equal(segmentsOf(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()), 12);
});

test('a smooth cylinder gives only its two rim loops', () => {
  // 64 segments -> 5.6 degrees between side facets: no side lines, 64 per rim.
  assert.equal(segmentsOf(new THREE.CylinderGeometry(1, 1, 2, 64)), 128);
});

test('smooth closed surfaces give no edges', () => {
  assert.equal(segmentsOf(new THREE.SphereGeometry(1, 32, 16)), 0);
  assert.equal(segmentsOf(new THREE.TorusKnotGeometry(1, 0.3, 100, 16)), 0);
});

test('agrees with THREE.EdgesGeometry on a mixed shape', () => {
  const geometry = new THREE.CylinderGeometry(0.5, 1, 1, 6); // hexagonal frustum: real creases
  assert.equal(segmentsOf(geometry), threeCount(geometry));
});

test('an open edge (one triangle) is a boundary and is emitted', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.equal(extractCreaseEdges(positions, null, 30).length / 6, 3);
});

test('degenerate triangles are skipped without throwing', () => {
  const positions = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0]);
  assert.equal(extractCreaseEdges(positions, null, 30).length, 0);
});

test('a lower threshold finds the cylinder sides too', () => {
  // 5.6 degrees between facets: a 5 degree threshold makes every side seam a crease.
  assert.ok(segmentsOf(new THREE.CylinderGeometry(1, 1, 2, 64), 5) > 128);
});

test('endpoints are real model positions', () => {
  const out = extractCreaseEdges(arrays(new THREE.BoxGeometry(2, 2, 2)).positions,
    arrays(new THREE.BoxGeometry(2, 2, 2)).index, 30);
  for (const value of out) assert.equal(Math.abs(value), 1);
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `node --test scripts/tests/creaseEdges.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement.** Create `lib/model/creaseEdges.ts`:

```ts
/**
 * Finds the crease edges of a triangle mesh: every edge where two faces meet at
 * `thresholdDeg` or more, plus every open (single-face) boundary edge. This matches
 * THREE.EdgesGeometry's output.
 *
 * Exists instead of EdgesGeometry for two reasons, both measured (2026-11-20):
 *  - Speed: EdgesGeometry keys its hash maps on strings and takes 5.5 s on 1.5 M triangles;
 *    this takes ~1.25 s, using an integer open-addressing weld table and numeric edge keys.
 *  - Bundle: this runs inside lib/model/edgeWorker.ts, and importing three there would ship
 *    all of three in the worker chunk. This module imports nothing.
 *
 * WELDING IS THE POINT. CAD tessellation gives every B-rep face its own vertices, so two faces
 * that meet at a chamfer share positions but no indices. Without welding by position every face
 * boundary looks open and gets drawn, smooth seams included. Positions are quantised to 1e-4
 * (EdgesGeometry's own default precision) before comparison.
 */

export const CREASE_THRESHOLD_DEG = 30;

const WELD_PRECISION = 1e4;

export function extractCreaseEdges(
  positions: Float32Array,
  index: Uint32Array | null,
  thresholdDeg: number,
): Float32Array {
  const vertexCount = positions.length / 3;
  const triangleCount = index ? index.length / 3 : vertexCount / 3;

  // --- Weld: quantised position -> first vertex seen at that position.
  let capacity = 1;
  while (capacity < vertexCount * 2) capacity <<= 1;
  const mask = capacity - 1;
  const slots = new Int32Array(capacity).fill(-1);
  const qx = new Int32Array(vertexCount);
  const qy = new Int32Array(vertexCount);
  const qz = new Int32Array(vertexCount);
  const weld = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const x = Math.round(positions[v * 3] * WELD_PRECISION);
    const y = Math.round(positions[v * 3 + 1] * WELD_PRECISION);
    const z = Math.round(positions[v * 3 + 2] * WELD_PRECISION);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const s = slots[h];
      if (s === -1) {
        slots[h] = v;
        qx[v] = x;
        qy[v] = y;
        qz[v] = z;
        weld[v] = v;
        break;
      }
      if (qx[s] === x && qy[s] === y && qz[s] === z) {
        weld[v] = s;
        break;
      }
      h = (h + 1) & mask;
    }
  }

  // --- Pair faces across each welded edge and compare their normals.
  const cosThreshold = Math.cos((thresholdDeg * Math.PI) / 180);
  const normals = new Float32Array(triangleCount * 3);
  // Edge key -> the first triangle seen on it, or -1 once a second triangle has been compared.
  // lo * vertexCount + hi stays far below 2^53 for any mesh that fits in memory.
  const firstFace = new Map<number, number>();
  const out: number[] = [];
  const emit = (a: number, b: number) => {
    out.push(
      positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2],
      positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2],
    );
  };
  const corners = [0, 0, 0];

  for (let t = 0; t < triangleCount; t++) {
    const a = weld[index ? index[t * 3] : t * 3];
    const b = weld[index ? index[t * 3 + 1] : t * 3 + 1];
    const c = weld[index ? index[t * 3 + 2] : t * 3 + 2];
    if (a === b || b === c || a === c) continue;

    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length === 0) continue;
    normals[t * 3] = nx / length;
    normals[t * 3 + 1] = ny / length;
    normals[t * 3 + 2] = nz / length;

    corners[0] = a;
    corners[1] = b;
    corners[2] = c;
    for (let k = 0; k < 3; k++) {
      const p = corners[k];
      const r = corners[(k + 1) % 3];
      const lo = p < r ? p : r;
      const hi = p < r ? r : p;
      const key = lo * vertexCount + hi;
      const other = firstFace.get(key);
      if (other === undefined) {
        firstFace.set(key, t);
        continue;
      }
      if (other === -1) continue; // a third face on a non-manifold edge: already decided
      const dot =
        normals[other * 3] * normals[t * 3] +
        normals[other * 3 + 1] * normals[t * 3 + 1] +
        normals[other * 3 + 2] * normals[t * 3 + 2];
      if (dot <= cosThreshold) emit(lo, hi);
      firstFace.set(key, -1);
    }
  }

  // --- Edges only one face ever touched are open boundaries: always drawn.
  firstFace.forEach((face, key) => {
    if (face === -1) return;
    const lo = Math.floor(key / vertexCount);
    emit(lo, key - lo * vertexCount);
  });

  return new Float32Array(out);
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `node --test scripts/tests/creaseEdges.test.mjs`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit.**

```bash
git add lib/model/creaseEdges.ts scripts/tests/creaseEdges.test.mjs
git commit -m "feat(viewer): pure crease-edge extractor, 4.5x faster than EdgesGeometry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Edge sources, merged LineSegments, per-part hiding, and the worker

**Files:**
- Create: `lib/model/buildEdges.ts` (tested), `lib/model/edgeWorker.ts`, `lib/model/runEdges.ts`
  (browser-only, not unit tested)
- Test: `scripts/tests/buildEdges.test.mjs`

**Interfaces:**
- Consumes: `extractCreaseEdges`, `CREASE_THRESHOLD_DEG` from `lib/model/creaseEdges.ts`;
  `flattenParts`, `PartNode` from `lib/model/partTree.ts`
- Produces (`lib/model/buildEdges.ts`):
  - `interface EdgeSource { key: string; positions: Float32Array; index: Uint32Array | null; matrix: THREE.Matrix4; triangles: number }`
  - `collectEdgeSources(parts: PartNode[]): EdgeSource[]` for the batched path; matrices are root-relative
  - `collectEdgeSourcesForObject(root: THREE.Object3D): EdgeSource[]` for the unbatched path and
    STL/PLY; matrices are in `root`'s PARENT frame; every key is `''`
  - `assembleEdges(sources: EdgeSource[], segments: Float32Array[]): ModelEdges | null`, where
    `segments[i]` belongs to `sources[i]` and is in that source's local space
  - `interface ModelEdges { lines: THREE.LineSegments; setHidden(isHidden: (key: string) => boolean): void; dispose(): void }`
  - `EDGE_COLOR = '#2b2f36'`, `EDGE_MAX_TRIANGLES = 1_500_000`
- Produces (`lib/model/runEdges.ts`):
  `computeModelEdges(sources: EdgeSource[]): { promise: Promise<ModelEdges | null>; cancel(): void }`

- [ ] **Step 1: Write the failing test.** Create `scripts/tests/buildEdges.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  collectEdgeSources,
  collectEdgeSourcesForObject,
  assembleEdges,
  EDGE_COLOR,
} from '../../lib/model/buildEdges.ts';
import { extractCreaseEdges, CREASE_THRESHOLD_DEG } from '../../lib/model/creaseEdges.ts';

const boxMesh = (x = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.position.x = x;
  return mesh;
};
const part = (key, ...meshes) => {
  const group = new THREE.Group();
  meshes.forEach((m) => group.add(m));
  return { key, name: key, children: [], meshes, triangles: 12 * meshes.length };
};
/** What the worker does, run inline. */
const extractAll = (sources) =>
  sources.map((s) => extractCreaseEdges(s.positions, s.index, CREASE_THRESHOLD_DEG));
const build = (sources) => assembleEdges(sources, extractAll(sources));
const drawnSegments = (edges) => edges.lines.geometry.drawRange.count / 2;
const xs = (edges) => {
  const position = edges.lines.geometry.getAttribute('position');
  const out = [];
  for (let i = 0; i < position.count; i++) out.push(position.getX(i));
  return out;
};

test('one box part gives 12 segments in one LineSegments', () => {
  const edges = build(collectEdgeSources([part('0', boxMesh())]));
  assert.ok(edges.lines.isLineSegments);
  assert.equal(drawnSegments(edges), 12);
});

test('edge material is thin, dark, opaque and unpickable', () => {
  const edges = build(collectEdgeSources([part('0', boxMesh())]));
  assert.ok(edges.lines.material.isLineBasicMaterial);
  assert.equal(`#${edges.lines.material.color.getHexString()}`, EDGE_COLOR);
  assert.equal(edges.lines.material.transparent, false);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  raycaster.params.Line.threshold = 10;
  assert.deepEqual(raycaster.intersectObject(edges.lines), []);
});

test('part placement is baked into the segments', () => {
  const edges = build(collectEdgeSources([part('0', boxMesh(5))]));
  for (const x of xs(edges)) assert.ok(x >= 4.5 - 1e-6 && x <= 5.5 + 1e-6, `x=${x}`);
});

test('hiding a part removes only its segments; showing restores them', () => {
  const edges = build(collectEdgeSources([part('a', boxMesh(0)), part('b', boxMesh(3))]));
  assert.equal(drawnSegments(edges), 24);

  edges.setHidden((key) => key === 'b');
  assert.equal(drawnSegments(edges), 12);
  const index = edges.lines.geometry.index;
  const position = edges.lines.geometry.getAttribute('position');
  for (let i = 0; i < edges.lines.geometry.drawRange.count; i++) {
    assert.ok(position.getX(index.getX(i)) <= 0.5 + 1e-6, 'only part a is drawn');
  }

  edges.setHidden(() => false);
  assert.equal(drawnSegments(edges), 24);
});

test('setHidden reuses one index buffer (no GPU buffer per toggle)', () => {
  const edges = build(collectEdgeSources([part('a', boxMesh(0)), part('b', boxMesh(3))]));
  const before = edges.lines.geometry.index;
  edges.setHidden((key) => key === 'a');
  assert.equal(edges.lines.geometry.index, before);
});

test('meshes the model ships hidden are skipped, as buildBatches does', () => {
  const hidden = boxMesh(9);
  hidden.visible = false;
  const sources = collectEdgeSources([part('0', boxMesh(0), hidden)]);
  assert.equal(sources.length, 1);
});

test('sources copy geometry, so transferring them cannot detach the live buffers', () => {
  const mesh = boxMesh();
  const [source] = collectEdgeSources([part('0', mesh)]);
  assert.notEqual(source.positions.buffer, mesh.geometry.getAttribute('position').array.buffer);
  assert.equal(source.triangles, 12);
});

test('unbatched root: baked in the PARENT frame, never doubling the mounted transform', () => {
  // The legacy path renders `root` itself, so by the time this runs React has attached it under
  // the transform group / <Center>. The edges render as root's SIBLING, so they must carry
  // root's own transform but not its ancestors'.
  const parent = new THREE.Group();
  parent.position.x = 100;
  const root = new THREE.Group();
  root.position.x = 3;
  root.add(boxMesh(0));
  parent.add(root);

  const edges = build(collectEdgeSourcesForObject(root));
  for (const x of xs(edges)) assert.ok(x >= 2.5 - 1e-6 && x <= 3.5 + 1e-6, `x=${x}`);
});

test('a bare mesh (STL/PLY) works as its own root', () => {
  const sources = collectEdgeSourcesForObject(boxMesh(0));
  assert.equal(sources.length, 1);
  assert.equal(drawnSegments(build(sources)), 12);
});

test('instanced and batched meshes are skipped: their geometry is not their placement', () => {
  const root = new THREE.Group();
  root.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2));
  assert.equal(collectEdgeSourcesForObject(root).length, 0);
});

test('a model with no crease edges assembles to null', () => {
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16));
  assert.equal(build(collectEdgeSourcesForObject(sphere)), null);
});

test('quantised (normalised Int16) positions are read through the attribute', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const float = geometry.getAttribute('position');
  const ints = new Int16Array(float.count * 3);
  for (let i = 0; i < float.count * 3; i++) ints[i] = Math.round(float.array[i] * 32767);
  geometry.setAttribute('position', new THREE.BufferAttribute(ints, 3, true));
  const sources = collectEdgeSourcesForObject(new THREE.Mesh(geometry));
  assert.equal(drawnSegments(build(sources)), 12);
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `node --test scripts/tests/buildEdges.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement the tested module.** Create `lib/model/buildEdges.ts`:

```ts
import * as THREE from 'three';
import { flattenParts, type PartNode } from './partTree.ts';

/**
 * Onshape-style edge lines: thin dark lines wherever two faces meet at a crease.
 *
 * The crease search itself (lib/model/creaseEdges.ts) runs in a worker (lib/model/runEdges.ts).
 * This module is the main-thread half on either side of it:
 *  - collect: copy each part's geometry out, with the placement it renders at
 *  - assemble: bake that placement into the worker's local-space segments and merge every
 *    part into ONE LineSegments, so edges cost one draw call however many parts there are
 *
 * Hiding a part rewrites the index in place to only the visible parts' ranges and moves the
 * draw range. It is O(edges) per toggle and nothing per frame. drawRange alone cannot do it
 * (hidden parts are not contiguous), and swapping in a new index attribute would orphan the old
 * GPU buffer on every toggle.
 *
 * The lines do not pick: raycast is a no-op, so measurement snapping, comment pins and part
 * clicks see exactly the faces they saw before. They are clipped by the section planes for
 * free (setClippingPlanes in lib/threeMaterials.ts sets planes on ANY object with a material),
 * and SectionCaps skips them because it only reads `isMesh` objects.
 */

export const EDGE_COLOR = '#2b2f36';

/**
 * Above this many triangles in a model, no edges are drawn. The worker would take roughly
 * 1.25 s per 1.5 M triangles (measured 2026-11-20), plus copying the geometry over; past this
 * the copy's memory starts to matter on the files the 200 MB audit is about.
 */
export const EDGE_MAX_TRIANGLES = 1_500_000;

export interface EdgeSource {
  /** Part key; `''` on paths with no parts. */
  key: string;
  /** A COPY. Safe to transfer to the worker without detaching the live geometry. */
  positions: Float32Array;
  index: Uint32Array | null;
  /** Where these local positions render, in the frame the LineSegments is mounted in. */
  matrix: THREE.Matrix4;
  triangles: number;
}

export interface ModelEdges {
  lines: THREE.LineSegments;
  setHidden(isHidden: (key: string) => boolean): void;
  dispose(): void;
}

interface Range {
  start: number;
  count: number;
}

function isPlainMesh(object: THREE.Object3D): object is THREE.Mesh {
  const candidate = object as THREE.Mesh & THREE.InstancedMesh & THREE.BatchedMesh & THREE.SkinnedMesh;
  if (candidate.isMesh !== true) return false;
  // Their geometry is not where they render: per-instance matrices or a skeleton pose it.
  return !candidate.isInstancedMesh && !candidate.isBatchedMesh && !candidate.isSkinnedMesh;
}

/** Float32 copy of the positions, de-interleaved and de-quantised through the attribute. */
function copyPositions(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const plain = attribute as THREE.BufferAttribute;
  if (
    !(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
    plain.array instanceof Float32Array &&
    plain.itemSize === 3 &&
    !plain.normalized
  ) {
    return plain.array.slice(0, plain.count * 3);
  }
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    out[i * 3] = attribute.getX(i);
    out[i * 3 + 1] = attribute.getY(i);
    out[i * 3 + 2] = attribute.getZ(i);
  }
  return out;
}

function sourceFor(key: string, mesh: THREE.Mesh, matrix: THREE.Matrix4): EdgeSource | null {
  const position = mesh.geometry?.getAttribute('position');
  if (!position || position.count === 0) return null;
  const indexAttribute = mesh.geometry.getIndex();
  const index = indexAttribute ? Uint32Array.from(indexAttribute.array as ArrayLike<number>) : null;
  return {
    key,
    positions: copyPositions(position),
    index,
    matrix,
    triangles: (index ? index.length : position.count) / 3,
  };
}

/**
 * Batched path. The loaded root is never mounted there (only the batches are), so a mesh's
 * matrixWorld after updateWorldMatrix(true, false) is root-relative: the exact matrix
 * buildBatches puts on the instance, so the lines and the faces share one frame.
 */
export function collectEdgeSources(parts: PartNode[]): EdgeSource[] {
  const sources: EdgeSource[] = [];
  flattenParts(parts).forEach((part) => {
    part.meshes.forEach((mesh) => {
      if (!mesh.visible || !isPlainMesh(mesh)) return;
      mesh.updateWorldMatrix(true, false);
      const source = sourceFor(part.key, mesh, mesh.matrixWorld.clone());
      if (source) sources.push(source);
    });
  });
  return sources;
}

/**
 * Unbatched path and STL/PLY. Here `root` itself IS mounted, under the transform group and
 * <Center>, by the time an effect runs, so a mesh's matrixWorld includes those ancestors.
 * The lines render as root's sibling, under the same parent, so they need root's own transform
 * and none of its ancestors': root.matrix x root.matrixWorld^-1 x mesh.matrixWorld.
 */
export function collectEdgeSourcesForObject(root: THREE.Object3D): EdgeSource[] {
  root.updateWorldMatrix(true, true);
  const toParentFrame = root.matrix.clone().multiply(root.matrixWorld.clone().invert());
  const sources: EdgeSource[] = [];
  root.traverseVisible((object) => {
    if (!isPlainMesh(object)) return;
    const source = sourceFor('', object, toParentFrame.clone().multiply(object.matrixWorld));
    if (source) sources.push(source);
  });
  return sources;
}

export function assembleEdges(sources: EdgeSource[], segments: Float32Array[]): ModelEdges | null {
  let total = 0;
  segments.forEach((s) => (total += s.length));
  if (total === 0) return null;

  const positions = new Float32Array(total);
  const ranges = new Map<string, Range[]>();
  const point = new THREE.Vector3();
  let offset = 0;
  segments.forEach((local, i) => {
    if (local.length === 0) return;
    const matrix = sources[i].matrix;
    for (let p = 0; p < local.length; p += 3) {
      point.set(local[p], local[p + 1], local[p + 2]).applyMatrix4(matrix);
      positions[offset + p] = point.x;
      positions[offset + p + 1] = point.y;
      positions[offset + p + 2] = point.z;
    }
    const list = ranges.get(sources[i].key) ?? [];
    list.push({ start: offset / 3, count: local.length / 3 });
    ranges.set(sources[i].key, list);
    offset += local.length;
  });

  const vertexCount = total / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const indexArray = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indexArray[i] = i;
  const index = new THREE.BufferAttribute(indexArray, 1);
  geometry.setIndex(index);
  geometry.setDrawRange(0, vertexCount);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'stiko-edges';
  lines.raycast = () => {};

  return {
    lines,
    setHidden(isHidden) {
      let written = 0;
      ranges.forEach((list, key) => {
        if (isHidden(key)) return;
        list.forEach((range) => {
          for (let i = 0; i < range.count; i++) indexArray[written++] = range.start + i;
        });
      });
      geometry.setDrawRange(0, written);
      index.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `node --test scripts/tests/buildEdges.test.mjs`
Expected: PASS, 12 tests

- [ ] **Step 5: Create the worker.** Create `lib/model/edgeWorker.ts`:

```ts
/// <reference lib="webworker" />
import { extractCreaseEdges } from './creaseEdges';

/**
 * Worker entry for edge lines. Imports only creaseEdges.ts, which imports nothing, so this
 * chunk stays tiny: no three. Runs off the main thread because even the fast extractor takes
 * ~1.25 s on 1.5 M triangles, and a frozen tab while a model opens is the one thing this
 * feature must never cause.
 */

export interface EdgeJobRequest {
  jobs: { positions: Float32Array; index: Uint32Array | null }[];
  thresholdDeg: number;
}

self.onmessage = (event: MessageEvent<EdgeJobRequest>) => {
  try {
    const { jobs, thresholdDeg } = event.data;
    const segments = jobs.map((job) => extractCreaseEdges(job.positions, job.index, thresholdDeg));
    (self as unknown as Worker).postMessage(
      { ok: true, segments },
      segments.map((s) => s.buffer),
    );
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
```

- [ ] **Step 6: Create the runner.** Create `lib/model/runEdges.ts`:

```ts
import { assembleEdges, EDGE_MAX_TRIANGLES, type EdgeSource, type ModelEdges } from './buildEdges';
import { CREASE_THRESHOLD_DEG } from './creaseEdges';

/**
 * Runs the crease search for a whole model in a worker and assembles the result.
 *
 * Resolves `null`, never rejects, for: an empty model, a model over EDGE_MAX_TRIANGLES, no
 * Worker support, or any worker failure. A model without edges is exactly what the viewer
 * showed before this feature existed, so every failure degrades to that.
 *
 * `cancel()` terminates the worker. The caller must also dispose a result that arrives after it
 * stopped caring; ModelViewerInner's effect does this with a `cancelled` flag.
 */
export function computeModelEdges(sources: EdgeSource[]): {
  promise: Promise<ModelEdges | null>;
  cancel(): void;
} {
  let triangles = 0;
  sources.forEach((s) => (triangles += s.triangles));
  if (sources.length === 0 || triangles > EDGE_MAX_TRIANGLES || typeof Worker === 'undefined') {
    return { promise: Promise.resolve(null), cancel() {} };
  }

  let created: Worker;
  try {
    created = new Worker(new URL('./edgeWorker.ts', import.meta.url));
  } catch {
    return { promise: Promise.resolve(null), cancel() {} };
  }
  // `live` is the non-null handle the handlers use; `worker` is what cancel() clears.
  const live = created;
  let worker: Worker | null = live;

  const promise = new Promise<ModelEdges | null>((resolve) => {
    live.onmessage = (event: MessageEvent<{ ok: boolean; segments?: Float32Array[]; error?: string }>) => {
      live.terminate();
      worker = null;
      if (!event.data.ok || !event.data.segments) {
        console.warn('[edges] worker failed:', event.data.error);
        resolve(null);
        return;
      }
      try {
        resolve(assembleEdges(sources, event.data.segments));
      } catch (error) {
        console.warn('[edges] assemble failed:', error);
        resolve(null);
      }
    };
    live.onerror = (event) => {
      console.warn('[edges] worker error:', event.message);
      live.terminate();
      worker = null;
      resolve(null);
    };
    // Each source's arrays are already private copies (collectEdgeSources), so transferring
    // them cannot detach the live geometry. They are not read on this side again, because
    // assembleEdges only reads `matrix` and `key`.
    const jobs = sources.map((s) => ({ positions: s.positions, index: s.index }));
    const transfer: Transferable[] = [];
    jobs.forEach((j) => {
      transfer.push(j.positions.buffer);
      if (j.index) transfer.push(j.index.buffer);
    });
    live.postMessage({ jobs, thresholdDeg: CREASE_THRESHOLD_DEG }, transfer);
  });

  return {
    promise,
    cancel() {
      worker?.terminate();
      worker = null;
    },
  };
}
```

  Note: a cancelled job's promise never settles. That is intentional: the effect has already
  moved on, and an unresolved promise holds nothing once the worker is gone.

- [ ] **Step 7: Typecheck and run the full suite.**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc silent; all tests pass

- [ ] **Step 8: Commit.**

```bash
git add lib/model/buildEdges.ts lib/model/edgeWorker.ts lib/model/runEdges.ts scripts/tests/buildEdges.test.mjs
git commit -m "feat(viewer): merged per-part edge lines computed in a worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire edges and polygon offset into the viewer

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx` (the `Model` component, roughly lines
  286-580)

**Interfaces:**
- Consumes:
  - `offsetFacesBehindEdges` (Task 2)
  - `collectEdgeSources`, `collectEdgeSourcesForObject`, `type ModelEdges` (Task 4)
  - `computeModelEdges` (Task 4)

- [ ] **Step 1: Add the imports.** Change line 19 and add two lines after the `buildBatches`
  import (line 23):

```ts
import { makeDoubleSided, offsetFacesBehindEdges } from '@/lib/threeMaterials';
```

```ts
import { collectEdgeSources, collectEdgeSourcesForObject, type ModelEdges } from '@/lib/model/buildEdges';
import { computeModelEdges } from '@/lib/model/runEdges';
```

- [ ] **Step 2: Offset the faces.**
  1. In `DEFAULT_MATERIAL` and `VERTEX_COLOR_MATERIAL`, add these three lines after
     `side: THREE.DoubleSide,`:

     ```ts
       polygonOffset: true,
       polygonOffsetFactor: 1,
       polygonOffsetUnits: 1,
     ```

  2. In the repair memo, after `makeDoubleSided(root);`, add:

     ```ts
         // Before batching: batchMaterialFrom clones these, and the clone keeps the offset.
         offsetFacesBehindEdges(root);
     ```

- [ ] **Step 3: Compute the edges.** Directly after
  `useEffect(() => () => batches?.dispose(), [batches]);` (around line 465), add:

```ts
  // Edge lines (lib/model/buildEdges.ts). Computed in a worker, so they arrive a moment after
  // the model is already on screen: on a small part immediately, on a ~1.5 M-triangle model
  // after a second or so. Until then, and for anything over the budget, the model renders
  // exactly as it did before edges existed.
  //
  // An EFFECT, not a memo, unlike `batches`: the unbatched path's sources must be read after
  // `root` is mounted, and collectEdgeSourcesForObject is written for that (it bakes in root's
  // parent frame, so the ancestors React attached are never applied twice). The batched path
  // never mounts root, so its matrices are root-relative either way.
  const [edges, setEdges] = useState<ModelEdges | null>(null);
  useEffect(() => {
    const sources = batches
      ? collectEdgeSources(parts)
      : root
        ? collectEdgeSourcesForObject(root)
        : data instanceof THREE.BufferGeometry
          ? collectEdgeSourcesForObject(new THREE.Mesh(data))
          : [];
    const job = computeModelEdges(sources);
    let cancelled = false;
    let current: ModelEdges | null = null;
    job.promise.then((result) => {
      if (cancelled) {
        result?.dispose();
        return;
      }
      current = result;
      setEdges(result);
    });
    return () => {
      cancelled = true;
      job.cancel();
      current?.dispose();
      setEdges(null);
    };
  }, [batches, parts, root, data]);
```

- [ ] **Step 4: Hide edges with their parts.** Replace the hidden-parts effect (the one whose
  body calls `applyPartVisibility`) with:

```ts
  useEffect(() => {
    if (!batches) return;
    const hidden = new Set(hiddenParts);
    const cascadedHidden = cascadeToDescendants(parts, (key) => (hidden.has(key) ? true : undefined));
    batches.instances.forEach((_instances, key) => {
      applyPartVisibility(batches, key, !cascadedHidden.get(key));
    });
    // Same cascaded map, so hiding an assembly row hides its descendants' edges exactly as it
    // hides their faces. Re-runs when `edges` arrives, since the worker usually finishes after
    // the user's saved hidden set was first applied.
    edges?.setHidden((key) => cascadedHidden.get(key) === true);
  }, [batches, parts, hiddenParts, edges]);
```

- [ ] **Step 5: Render the lines.** Replace the three return paths at the end of `Model`:

```ts
  const edgeLines = edges ? <primitive object={edges.lines} /> : null;

  if (ext === '.stl' || ext === '.ply') {
    const geometry = data as THREE.BufferGeometry;
    const material = geometry.hasAttribute('color')
      ? VERTEX_COLOR_MATERIAL
      : DEFAULT_MATERIAL;
    return (
      <>
        <mesh geometry={geometry} material={material} />
        {edgeLines}
      </>
    );
  }

  // No parts found — a legacy upload whose hierarchy was flattened at import, or a format
  // that never carried one. Render the tree as-is rather than pretending to segment it.
  if (!batches || !root) {
    return (
      <>
        <primitive object={root ?? data} />
        {edgeLines}
      </>
    );
  }

  return (
    <>
      {batches.meshes.map((mesh, i) => (
        <primitive key={`batch-${i}`} object={mesh} />
      ))}
      {/* Carried unbatched: no part key, so no colour/hide/pick — see the drawables memo's
          comment above and collectDrawables' own doc comment in partTree.ts. */}
      {drawables.map((drawable, i) => (
        <primitive key={`drawable-${i}`} object={drawable} />
      ))}
      {edgeLines}
    </>
  );
```

  Keep the existing comments that were attached to these returns; the only changes are the
  fragments and the `{edgeLines}` entries.

- [ ] **Step 6: Typecheck and run the suite.**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc silent; all tests pass

- [ ] **Step 7: Build. This step catches the worker bundling and TS2802.**

Run: `npm run build 2>&1 | tail -25`
Expected: `✓ Compiled successfully`, with no type errors, and a separate worker chunk emitted
(webpack names it from `edgeWorker`)

- [ ] **Step 8: Commit.**

```bash
git add components/viewers/ModelViewerInner.tsx
git commit -m "feat(viewer): draw crease edges on every model; faces offset behind them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Camera-relative key/fill/hemisphere lighting

**Files:**
- Create: `lib/sceneLights.ts`
- Test: `scripts/tests/sceneLights.test.mjs`
- Rewrite: `components/viewers/SceneLighting.tsx`
- Modify: `lib/model/repairMaterials.ts` (comment only)

**Interfaces:**
- Produces:
  - `placeCameraRelativeLight(light: THREE.DirectionalLight, offset: THREE.Vector3, camera: THREE.Camera, target: THREE.Vector3, scratch: THREE.Vector3): void`
  - constants `KEY_OFFSET`, `FILL_OFFSET`, `KEY_INTENSITY`, `FILL_INTENSITY`,
    `HEMISPHERE_SKY`, `HEMISPHERE_GROUND`, `HEMISPHERE_INTENSITY`, `ENVIRONMENT_INTENSITY`

- [ ] **Step 1: Write the failing test.** Create `scripts/tests/sceneLights.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { placeCameraRelativeLight, KEY_OFFSET, FILL_OFFSET } from '../../lib/sceneLights.ts';

const cameraAt = (x, y, z) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
};
const place = (offset, camera, target = new THREE.Vector3()) => {
  const light = new THREE.DirectionalLight();
  placeCameraRelativeLight(light, offset, camera, target, new THREE.Vector3());
  return light;
};

test('key light comes from above, left and in front of the viewer', () => {
  const light = place(KEY_OFFSET, cameraAt(0, 0, 10));
  assert.ok(light.position.x < 0, 'left');
  assert.ok(light.position.y > 0, 'above');
  assert.ok(light.position.z > 0, 'viewer side');
});

test('fill light comes from the opposite side, slightly low', () => {
  const light = place(FILL_OFFSET, cameraAt(0, 0, 10));
  assert.ok(light.position.x > 0, 'right');
  assert.ok(light.position.y < 0, 'below');
});

test('the rig turns with the camera: from +x, "left" is +z', () => {
  // Looking down -x with y up, the camera's right is -z, so its left is +z.
  const light = place(KEY_OFFSET, cameraAt(10, 0, 0));
  assert.ok(light.position.z > 0, 'left of a camera on +x');
  assert.ok(light.position.y > 0, 'still above');
  assert.ok(light.position.x > 0, 'still on the viewer side');
});

test('the light aims at the orbit target and refreshes its matrix', () => {
  const target = new THREE.Vector3(5, 2, -3);
  const light = place(KEY_OFFSET, cameraAt(5, 2, 7), target);
  assert.deepEqual(light.target.position.toArray(), [5, 2, -3]);
  const world = new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld);
  assert.deepEqual(world.toArray(), [5, 2, -3]);
  // Direction (position - target) equals the rotated offset regardless of target.
  const direction = light.position.clone().sub(target).normalize();
  assert.ok(direction.y > 0 && direction.z > 0);
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `node --test scripts/tests/sceneLights.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement the helper.** Create `lib/sceneLights.ts`:

```ts
import * as THREE from 'three';

/**
 * The viewer's light rig, as data, plus the one bit of maths it needs.
 *
 * Every light is placed in CAMERA space and re-placed each frame. That is what keeps the old
 * headlight's best property (no side of the model ever goes dark while orbiting) while dropping
 * its worst: a light aimed straight down the view lights every face turned towards you equally,
 * so a chamfer, a fillet and a flat face all came out the same tone. A key light offset up and
 * to the side shades them differently. That gives the Onshape look, and it is what the
 * 2026-11-20 shading spec is for.
 *
 * Offsets use camera axes: +x right, +y up, +z towards the viewer (the camera looks down -z).
 */

/** About 35° above and 30° left of the view direction. */
export const KEY_OFFSET = new THREE.Vector3(-0.58, 0.7, 1).normalize();
export const KEY_INTENSITY = 1.4;

/** Opposite side and slightly low, so the key's shadow side is lifted, not flattened. */
export const FILL_OFFSET = new THREE.Vector3(0.7, -0.15, 1).normalize();
export const FILL_INTENSITY = 0.45;

/** World-up sky/ground tint: tops of parts read a touch lighter than undersides. */
export const HEMISPHERE_SKY = '#ffffff';
export const HEMISPHERE_GROUND = '#b8bcc4';
export const HEMISPHERE_INTENSITY = 0.5;

/**
 * Studio reflections. Raised from 0.15: the semi-gloss CAD finish (lib/model/cadFinish.ts)
 * needs something to reflect, or curved faces get no gradient. Too high washes pale parts out.
 */
export const ENVIRONMENT_INTENSITY = 0.7;

/**
 * Places a directional light so it shines from `offset` (camera space) onto `target`.
 *
 * A directional light only cares about direction, so the distance is arbitrary (unit length);
 * this behaves identically at model radius 1 and 10,000.
 *
 * The light's target is a bare Object3D outside the scene graph, so nothing else refreshes its
 * world matrix, and the light reads its direction from that matrix.
 */
export function placeCameraRelativeLight(
  light: THREE.DirectionalLight,
  offset: THREE.Vector3,
  camera: THREE.Camera,
  target: THREE.Vector3,
  scratch: THREE.Vector3,
): void {
  scratch.copy(offset).applyQuaternion(camera.quaternion);
  light.position.copy(target).add(scratch);
  light.target.position.copy(target);
  light.target.updateMatrixWorld();
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `node --test scripts/tests/sceneLights.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Rewrite `components/viewers/SceneLighting.tsx`** with the following complete
  content:

```tsx
'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import {
  ENVIRONMENT_INTENSITY,
  FILL_INTENSITY,
  FILL_OFFSET,
  HEMISPHERE_GROUND,
  HEMISPHERE_INTENSITY,
  HEMISPHERE_SKY,
  KEY_INTENSITY,
  KEY_OFFSET,
  placeCameraRelativeLight,
} from '@/lib/sceneLights';

/**
 * How the viewer is lit: a key light from above-left, a softer fill from the other side, a
 * sky/ground tint, and studio reflections. The two directional lights follow the camera, so no
 * side of the model ever goes dark; see lib/sceneLights.ts for why this replaced the
 * SketchUp-style headlight (2026-11-20, docs/superpowers/specs/2026-11-20-model-shading-edges-design.md).
 */

const ORIGIN = new THREE.Vector3();

function CameraRig() {
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const scratch = useRef(new THREE.Vector3());
  const { camera, controls } = useThree();

  useFrame(() => {
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? ORIGIN;
    if (key.current) placeCameraRelativeLight(key.current, KEY_OFFSET, camera, target, scratch.current);
    if (fill.current) placeCameraRelativeLight(fill.current, FILL_OFFSET, camera, target, scratch.current);
  });

  return (
    <>
      <directionalLight ref={key} intensity={KEY_INTENSITY} />
      <directionalLight ref={fill} intensity={FILL_INTENSITY} />
    </>
  );
}

export default function SceneLighting() {
  return (
    <>
      <CameraRig />
      <hemisphereLight args={[HEMISPHERE_SKY, HEMISPHERE_GROUND, HEMISPHERE_INTENSITY]} />
      <Environment preset="studio" environmentIntensity={ENVIRONMENT_INTENSITY} />
    </>
  );
}
```

  Before replacing the file, check how the old headlight read the orbit target. It used
  `(controls as unknown as { target?: THREE.Vector3 } | null)?.target`; keep that exact read.
  If `controls` is drei `CameraControls` (it is, per the import at the top of
  `ModelViewerInner.tsx`), that object has no `.target` Vector3, and the old code then left the
  target at the origin. To keep parity, falling back to `ORIGIN` is correct. Do not "fix" it to
  `getTarget()` in this task; the lights only need a direction, and the direction is the same
  for any target.

- [ ] **Step 6: Update two stale comments in `lib/model/repairMaterials.ts`.** These are
  comments only; no code changes.

  Replace this exact text:

```
 * Metals have no diffuse response — they show reflections and nothing else — and
 * SceneLighting deliberately runs the environment at 0.15 because the headlight is meant
 * to do the lighting. The result is geometry that renders pitch black with no way to
 * recover, which is exactly what one third of the reference model did.
```

  with:

```
 * Metals have no diffuse response — they show reflections and nothing else — and the
 * viewer's environment (lib/sceneLights.ts) is a modest fill, not the main light. The result
 * is geometry that renders near-black with no way to recover, which is exactly what one
 * third of the reference model did.
```

  Then replace `/** Matte enough to read as an untextured CAD surface under the headlight. */`
  with `/** Matte enough to read as an untextured CAD surface under the viewer's lights. */`.

- [ ] **Step 7: Typecheck and run the suite.**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc silent; all tests pass

- [ ] **Step 8: Commit.**

```bash
git add lib/sceneLights.ts scripts/tests/sceneLights.test.mjs components/viewers/SceneLighting.tsx lib/model/repairMaterials.ts
git commit -m "feat(viewer): camera-relative key/fill/hemisphere lighting replaces the headlight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Browser verification and tuning

**Files:**
- Temporary, never committed: `app/portal/harness-3d/page.tsx` and `public/uploads/*`
- Possibly modify (tuning only): `lib/sceneLights.ts` constants, `CAD_FINISH_ROUGHNESS`,
  `EDGE_COLOR`

This is the recipe from the seamless-ground work (memory: `stiko-seamless-ground`):
- the temporary harness renders `<ModelViewer>` with its 6 required props
- headless Chrome through Playwright with `--use-angle=swiftshader --enable-unsafe-swiftshader`
- wait about 12 s

- [ ] **Step 1: Stage the models.**

```bash
mkdir -p public/uploads
cp public/jet_engine.glb public/uploads/jet_engine.glb
cp "$HOME/Downloads/Clamp 9inch reach.stp" public/uploads/clamp.stp
```

  The clamp is a real STEP part. STEP converts in the viewer through `lib/STEPLoader.ts`, so the
  harness needs no server.

- [ ] **Step 2: Create the harness.** Create `app/portal/harness-3d/page.tsx`:

```tsx
'use client';
import { useSearchParams } from 'next/navigation';
import ModelViewer from '@/components/viewers/ModelViewer';

export default function Harness() {
  const params = useSearchParams();
  const file = params.get('f') ?? 'jet_engine.glb';
  const hidden = params.get('hide');
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ModelViewer
        url={`/uploads/${file}`}
        bytes={1}
        partColors={{}}
        hiddenParts={hidden ? [hidden] : []}
        highlightedPart={null}
        measurePreviewColor="#ff0000"
      />
    </div>
  );
}
```

  If tsc complains about a missing required prop, read `ModelViewerInnerProps` and pass the
  minimal value. Do not change the viewer to suit the harness.

- [ ] **Step 3: Take BEFORE screenshots from `main`.** Run them in a temporary worktree so this
  branch is untouched:

```bash
git worktree add ../stiko-before main
```

  In the worktree:
  1. Copy in the harness file and `public/uploads/`.
  2. Run `npm install` and `npm run build && npx next start -p 3101`.
  3. Screenshot `http://localhost:3101/portal/harness-3d?f=jet_engine.glb` and
     `?f=clamp.stp` at 1300×1330, after a 12 s wait.
  4. Save them to the session scratchpad as `before-jet.png` and `before-clamp.png`.
  5. Stop the server and run `git worktree remove ../stiko-before --force`.

  Use `next start`, not `next dev`: the dev server cannot load some workers (pdf.js; memory
  `stiko-pdf-sidebar-scroll`), and the edge worker is the thing under test.

- [ ] **Step 4: Take AFTER screenshots from this branch.** Run `npm run build && npx next start -p 3100`,
  then take the same two screenshots, named `after-*.png`. Open both pairs with the Read tool
  and check:
  - Edges are visible, 1 px and dark grey, on chamfers, holes and rims, with none striped
    across smooth curved faces.
  - Head face, chamfer and recess read as distinct tones.
  - Nothing is blown out to white glare, and no face is black.
  - The model did not shift position when the edges arrived. Compare against a screenshot taken
    at 2 s, before the worker finished.

- [ ] **Step 5: Tune.** If a check in Step 4 fails, adjust only the constants and re-shoot:
  - Glare: raise `CAD_FINISH_ROUGHNESS` towards 0.45, or lower `ENVIRONMENT_INTENSITY` towards 0.5.
  - Flat: raise `KEY_INTENSITY` or lower `FILL_INTENSITY`.
  - Edges too loud: lighten `EDGE_COLOR` towards `#4a4f57`.

  Record the final values and why in the commit message.

- [ ] **Step 6: Behaviour checks in the same browser session.**
  1. **Part hiding.** Use the clamp, not the jet engine. `jet_engine.glb` carries no
     `stikoPart` markers, so it takes the unbatched path, which has no parts to hide.
     `stepToGlb` marks every STEP part, so the clamp is batched.
     - To get its part keys, temporarily add to the harness:
       `onPartsLoaded={(p) => console.log('PART KEYS', JSON.stringify(p.map((n) => n.key)))}`.
       Check `ModelViewerInnerProps` for the exact prop name.
     - Read the keys with chrome-devtools `list_console_messages`.
     - Load `?f=clamp.stp&hide=<first key>`. That part's faces AND edges must both be gone.
       If the clamp is a single part, the canvas shows only the ground and axes.
  2. Orbit with a mouse drag (chrome-devtools `drag`) and screenshot mid-orbit. No edge
     shimmer or dashing (polygon offset working).
  3. Cross-section: the harness has no section UI. Instead, evaluate in the page to find the
     LineSegments named `stiko-edges` and confirm its `material.clippingPlanes` is non-empty
     after a plane is enabled. If that cannot be driven from the harness, verify it in the real
     portal on production after merge, and say so in the hand-off.
  4. Measure: confirm `edges.lines.raycast` is the no-op by evaluating it. Snapping is
     unchanged because raycast never sees the lines.

- [ ] **Step 7: Clean up.** The harness and uploads must not be committed:

```bash
rm -rf app/portal/harness-3d public/uploads/jet_engine.glb public/uploads/clamp.stp
git status --short
```

  Expected: only the three handoff dirs, `logo/` and `stiko_handoff/` remain untracked. No
  `app/portal/harness-3d`.

- [ ] **Step 8: Commit any tuning.** Skip this step if nothing changed.

```bash
git add lib/sceneLights.ts lib/model/cadFinish.ts lib/model/buildEdges.ts
git commit -m "tune(viewer): lighting/finish/edge values from browser screenshots

<one line per changed constant: old -> new, and what the screenshot showed>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Hand off.** Send the user the before/after pairs with SendUserFile. Then give
  one merge+push paste block per memory `stiko-user-pushes-main`: say which terminal and which
  folder, `git fetch` first, merge with `--no-ff`, and include the rollback line
  `git revert -m 1 <merge sha>`. The user pushes `main`; do not push unless they say so.
