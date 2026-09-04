# Per-Part Colouring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone with `canTransform` colour the individual parts of a 3D model, and let anyone hide parts, from a Parts panel in the viewport — without regressing draw calls.

**Architecture:** A part is a node in the model's own assembly tree. The import pipeline currently destroys that tree in two places and is changed to preserve it, stamping each part node with a `stikoPart` marker in glTF `extras`. At load the viewer reads those markers back out of `userData`, builds a part tree, and renders the model as `THREE.BatchedMesh` groups — which makes draw calls independent of part count and gives per-part colour (`setColorAt`), visibility (`setVisibleAt`) and picking (`intersect.batchId`) natively. Colours persist in a new `part_colors` table; visibility is session-only.

**Tech Stack:** Next.js 14 (App Router), React, three.js r169, @react-three/fiber, @gltf-transform/core + /functions 4.4.2, occt-import-js, Neon Postgres, Tailwind, `node --test`.

## Global Constraints

- **A part is a node in the assembly tree** — never a primitive, never a material group, never a connected component.
- **Part key = index path from the scene root**, e.g. `0/2/1`. Names are display-only and may be absent or duplicated.
- **Stable-key invariant:** keys are stable only because an uploaded file's bytes never change after upload. Never re-optimize a stored file without migrating or deliberately dropping its `part_colors` rows.
- **Colours persist and are gated on `canTransform`** (`lib/capabilities.ts:16`). **Visibility is session-only and available to every role** — hiding is a way of looking, exactly as cross-section plane poses are.
- **Auto-colours are never stored.** They are a deterministic pure function of the part tree.
- **Never call `BatchedMesh.optimize()`** — it has a known id/index mismatch (`node_modules/three/src/objects/BatchedMesh.js:780`).
- **Legacy files degrade honestly.** Files uploaded before this ships have no tree in their bytes; they render exactly as today and the panel says they have no separable parts. Never silently load the slow unoptimized original instead.
- **The server is the authority.** The client hiding a control and the API returning 403 must never be able to disagree.
- Tests run with `npm test` (`node --test scripts/tests/*.mjs`), import `.ts` sources directly, and use the `../../lib/...` relative path — **not** the `@/` alias, which `node --test` does not resolve.
- Migrations are applied manually and have been forgotten twice. Check `schema_migrations` before deploying.

---

### Task 1: Part tree from a loaded scene

**Files:**
- Create: `lib/model/partTree.ts`
- Test: `scripts/tests/partTree.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `PART_MARKER: 'stikoPart'`, `interface PartNode { key: string; name: string; children: PartNode[]; meshes: THREE.Mesh[]; triangles: number }`, `buildPartTree(root: THREE.Object3D): PartNode[]`, `flattenParts(parts: PartNode[]): PartNode[]`, `hasAuthoredColors(root: THREE.Object3D): boolean`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/partTree.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPartTree, flattenParts, hasAuthoredColors, PART_MARKER } from '../../lib/model/partTree.ts';

/** A mesh with `tris` triangles, so triangle-count ranking is testable. */
function mesh(name, tris = 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8899aa }));
  m.name = name;
  return m;
}

function group(name, marked, ...children) {
  const g = new THREE.Group();
  g.name = name;
  if (marked) g.userData[PART_MARKER] = true;
  for (const c of children) g.add(c);
  return g;
}

test('unmarked scene treats direct children of the root as parts', () => {
  const root = new THREE.Group();
  root.add(mesh('Body'), mesh('Bonnet'));

  const parts = buildPartTree(root);

  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.key), ['0', '1']);
  assert.deepEqual(parts.map((p) => p.name), ['Body', 'Bonnet']);
  assert.equal(parts[0].children.length, 0);
});

test('marked scene nests parts and keys them by object-graph index path', () => {
  const rim = group('Rim', true, mesh('rim_geo'));
  const tire = group('Tire', true, mesh('tire_geo'));
  const wheel = group('Wheel_FL', true, rim, tire);
  const root = new THREE.Group();
  root.add(group('Body', true, mesh('body_geo')), wheel);

  const parts = buildPartTree(root);

  assert.deepEqual(parts.map((p) => p.key), ['0', '1']);
  const wheelNode = parts[1];
  assert.equal(wheelNode.name, 'Wheel_FL');
  assert.deepEqual(wheelNode.children.map((c) => c.key), ['1/0', '1/1']);
  assert.deepEqual(wheelNode.children.map((c) => c.name), ['Rim', 'Tire']);
});

test('a part owns its own meshes but not those of a nested part', () => {
  const rim = group('Rim', true, mesh('rim_geo'));
  const wheel = group('Wheel_FL', true, mesh('hub_geo'), rim);
  const root = new THREE.Group();
  root.add(wheel);

  const [wheelNode] = buildPartTree(root);

  assert.deepEqual(wheelNode.meshes.map((m) => m.name), ['hub_geo']);
  assert.deepEqual(wheelNode.children[0].meshes.map((m) => m.name), ['rim_geo']);
});

test('a part with several primitives is one part, not several', () => {
  // Two materials on one part: GLTFLoader gives a Group with two Mesh children.
  const rim = group('Rim', true, mesh('rim_steel'), mesh('rim_chrome'));
  const root = new THREE.Group();
  root.add(rim);

  const parts = buildPartTree(root);

  assert.equal(parts.length, 1);
  assert.equal(parts[0].children.length, 0);
  assert.equal(parts[0].meshes.length, 2);
});

test('triangles accumulate through descendants', () => {
  const rim = group('Rim', true, mesh('rim_geo', 10));
  const wheel = group('Wheel_FL', true, mesh('hub_geo', 5), rim);
  const root = new THREE.Group();
  root.add(wheel);

  const [wheelNode] = buildPartTree(root);

  assert.equal(wheelNode.children[0].triangles, 10);
  assert.equal(wheelNode.triangles, 15);
});

test('unmarked intermediate nodes are skipped, not turned into parts', () => {
  // Marked mode: an unmarked wrapper between the root and a real part.
  const wrapper = new THREE.Group();
  wrapper.name = 'RootNode';
  wrapper.add(group('Body', true, mesh('body_geo')));
  const root = new THREE.Group();
  root.add(wrapper);

  const parts = buildPartTree(root);

  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, 'Body');
  assert.equal(parts[0].key, '0/0');
});

test('an empty scene has no parts', () => {
  assert.deepEqual(buildPartTree(new THREE.Group()), []);
});

test('flattenParts walks the tree depth-first', () => {
  const wheel = group('Wheel_FL', true, group('Rim', true, mesh('r')), group('Tire', true, mesh('t')));
  const root = new THREE.Group();
  root.add(group('Body', true, mesh('b')), wheel);

  assert.deepEqual(
    flattenParts(buildPartTree(root)).map((p) => p.name),
    ['Body', 'Wheel_FL', 'Rim', 'Tire']
  );
});

test('hasAuthoredColors is false when every material is the same colour', () => {
  const root = new THREE.Group();
  root.add(mesh('a'), mesh('b'));
  assert.equal(hasAuthoredColors(root), false);
});

test('hasAuthoredColors is true when materials differ in colour', () => {
  const root = new THREE.Group();
  const brass = mesh('b');
  brass.material = new THREE.MeshStandardMaterial({ color: 0xc8a05a });
  root.add(mesh('a'), brass);
  assert.equal(hasAuthoredColors(root), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="part"`
Expected: FAIL — `Cannot find module '../../lib/model/partTree.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/model/partTree.ts`:

```ts
import * as THREE from 'three';

/**
 * The assembly tree, read back out of a loaded model.
 *
 * A part is a NODE, never a primitive and never a material group. A rim modelled as 200
 * fragments under one node is one part; a rim carrying two materials is still one part, even
 * though GLTFLoader hands it to us as a Group with two Mesh children.
 *
 * Two sources of truth, in order:
 *
 * 1. `userData.stikoPart`, stamped into glTF node `extras` by our import pipeline and copied
 *    into userData by GLTFLoader (GLTFLoader.js:2306). This is authoritative and nests.
 * 2. No marker anywhere — a legacy upload, or a format that never passes through our import
 *    (OBJ, DAE, 3DS). Then the direct children of the scene root are the parts and nothing
 *    nests. This is a fallback, not a guess dressed up as structure: where a file has no
 *    hierarchy at all the answer is genuinely "one part", and the panel says so.
 *
 * Pure: no rendering, no DOM, no React. Unit-tested under `node --test`.
 */

/** The glTF `extras` key our import stamps, surfacing as `object.userData[PART_MARKER]`. */
export const PART_MARKER = 'stikoPart';

export interface PartNode {
  /** Index path from the scene root — `0/2/1`. Stable because stored files are immutable. */
  key: string;
  /** Display only. May be empty, and may be duplicated across parts. */
  name: string;
  children: PartNode[];
  /** Meshes owned by this node directly — never those belonging to a nested part. */
  meshes: THREE.Mesh[];
  /** This part's own triangles plus every descendant's. Drives auto-colour ranking. */
  triangles: number;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function isBoundary(object: THREE.Object3D): boolean {
  return object.userData?.[PART_MARKER] === true;
}

function trianglesOf(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry) return 0;
  const index = geometry.getIndex();
  const count = index ? index.count : (geometry.getAttribute('position')?.count ?? 0);
  return Math.floor(count / 3);
}

/** True if any node under `root` carries the import marker. */
function hasMarkers(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if (isBoundary(object)) found = true;
  });
  return found;
}

/**
 * Meshes under `object` that belong to `object` itself, stopping at any nested part boundary.
 * `object` is the boundary we started from, so its own marker must not stop the walk.
 */
function ownMeshes(object: THREE.Object3D, isStart: boolean): THREE.Mesh[] {
  if (!isStart && isBoundary(object)) return [];
  const out: THREE.Mesh[] = [];
  if (isMesh(object)) out.push(object);
  for (const child of object.children) out.push(...ownMeshes(child, false));
  return out;
}

function makePart(object: THREE.Object3D, key: string): PartNode {
  const children = boundariesUnder(object, key);
  const meshes = ownMeshes(object, true);
  const triangles =
    meshes.reduce((sum, m) => sum + trianglesOf(m), 0) +
    children.reduce((sum, c) => sum + c.triangles, 0);
  return { key, name: object.name ?? '', children, meshes, triangles };
}

/**
 * The part boundaries directly beneath `object`, descending through unmarked intermediates.
 * Exporters routinely insert an unnamed wrapper node between the scene root and the real
 * assembly; treating that wrapper as a part would put every model inside a single useless row.
 */
function boundariesUnder(object: THREE.Object3D, prefix: string): PartNode[] {
  const out: PartNode[] = [];
  object.children.forEach((child, i) => {
    const key = prefix === '' ? String(i) : `${prefix}/${i}`;
    if (isBoundary(child)) out.push(makePart(child, key));
    else out.push(...boundariesUnder(child, key));
  });
  return out;
}

export function buildPartTree(root: THREE.Object3D): PartNode[] {
  if (hasMarkers(root)) return boundariesUnder(root, '');

  return root.children.map((child, i) => {
    const meshes = ownMeshes(child, true);
    return {
      key: String(i),
      name: child.name ?? '',
      children: [],
      meshes,
      triangles: meshes.reduce((sum, m) => sum + trianglesOf(m), 0),
    };
  });
}

/** Depth-first, parents before children — the order the panel renders rows in. */
export function flattenParts(parts: PartNode[]): PartNode[] {
  const out: PartNode[] = [];
  const walk = (nodes: PartNode[]) => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(parts);
  return out;
}

/**
 * Whether the model arrived carrying colour information of its own.
 *
 * Auto-colouring must never overwrite a designer's intent, the same principle
 * repairMaterials.ts follows in only ever touching the exporter-default signature. "Carries
 * colour" is read as "not every material is the same colour" — a model where everything is
 * one grey is exactly the bland case this feature exists to fix.
 */
export function hasAuthoredColors(root: THREE.Object3D): boolean {
  const seen = new Set<string>();
  root.traverse((object) => {
    if (!isMesh(object) || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const color = (material as THREE.MeshStandardMaterial).color;
      if (color) seen.add(color.getHexString());
    }
  });
  return seen.size > 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="part"`
Expected: PASS — 10 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/model/partTree.ts scripts/tests/partTree.test.mjs
git commit -m "feat: derive a part tree from a loaded model"
```

---

### Task 2: The auto-colour rule

**Files:**
- Create: `lib/model/autoColor.ts`
- Test: `scripts/tests/autoColor.test.mjs`

**Interfaces:**
- Consumes: `PartNode` from `lib/model/partTree.ts`.
- Produces: `BASE_GREY: string`, `ACCENTS: readonly string[]`, `MAX_AUTO_COLORED: number`, `autoColors(parts: PartNode[], authored: boolean): Map<string, string>`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/autoColor.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoColors, ACCENTS, MAX_AUTO_COLORED } from '../../lib/model/autoColor.ts';

/** A PartNode shaped just enough for the ranking — autoColors reads key and triangles only. */
function part(key, triangles) {
  return { key, name: key, children: [], meshes: [], triangles };
}

test('the largest assembly stays grey and the next four take accents', () => {
  const parts = [
    part('0', 1000), part('1', 900), part('2', 800),
    part('3', 700), part('4', 600), part('5', 500),
  ];

  const colors = autoColors(parts, false);

  assert.equal(colors.has('0'), false, 'largest keeps the base grey');
  assert.deepEqual([...colors.keys()], ['1', '2', '3', '4']);
  assert.deepEqual([...colors.values()], [...ACCENTS]);
  assert.equal(colors.size, MAX_AUTO_COLORED);
});

test('a sixth assembly and beyond stay grey', () => {
  const parts = Array.from({ length: 12 }, (_, i) => part(String(i), 1000 - i));
  assert.equal(autoColors(parts, false).size, MAX_AUTO_COLORED);
});

test('ranking is by triangle count, not declaration order', () => {
  const parts = [part('0', 10), part('1', 5000), part('2', 20)];
  const colors = autoColors(parts, false);

  assert.equal(colors.has('1'), false, 'the biggest part is the one left grey');
  assert.deepEqual([...colors.keys()], ['2', '0']);
});

test('a model with one top-level assembly gets no colour at all', () => {
  assert.equal(autoColors([part('0', 500)], false).size, 0);
});

test('an empty model gets no colour', () => {
  assert.equal(autoColors([], false).size, 0);
});

test('a model with authored colours is left alone', () => {
  const parts = [part('0', 1000), part('1', 900), part('2', 800)];
  assert.equal(autoColors(parts, true).size, 0);
});

test('equal triangle counts break ties by key, so the result is deterministic', () => {
  const parts = [part('2', 100), part('0', 100), part('1', 100), part('3', 100)];

  const first = autoColors(parts, false);
  const second = autoColors([...parts].reverse(), false);

  assert.deepEqual([...first.entries()], [...second.entries()]);
  assert.equal(first.has('0'), false, 'lowest key wins the tie and stays grey');
});

test('only top-level assemblies are considered — children are never auto-coloured', () => {
  const wheel = { ...part('1', 900), children: [part('1/0', 500), part('1/1', 400)] };
  const colors = autoColors([part('0', 1000), wheel], false);

  assert.deepEqual([...colors.keys()], ['1']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="colour|color"`
Expected: FAIL — `Cannot find module '../../lib/model/autoColor.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/model/autoColor.ts`:

```ts
import type { PartNode } from './partTree.ts';

/**
 * Restraint, not decoration.
 *
 * A real CAD assembly is mostly one neutral material with a few accents — grey steel, brass
 * flanges, a copper stem. Dealing a distinct colour to every part turns a 3,000-part model
 * into noise and makes the viewer LESS legible, not more. So: the largest top-level assembly
 * keeps the base grey, at most four others take a muted accent, and everything else stays
 * grey.
 *
 * Deterministic, so every viewer computes the same result and nothing needs storing. A user's
 * explicit override simply displaces the result for that part.
 *
 * Relative import, not the '@/' alias: unit-tested by `node --test`, which does not resolve it.
 */

/** Matches DEFAULT_MATERIAL in components/viewers/ModelViewerInner.tsx. */
export const BASE_GREY = '#8899AA';

/**
 * Muted on purpose — these sit against BASE_GREY under a headlight, and saturated hues read
 * as a rendering fault rather than as a material. Brass, steel blue, copper, olive.
 */
export const ACCENTS = ['#C8A05A', '#5B7FA6', '#A8563F', '#6E8A6B'] as const;

export const MAX_AUTO_COLORED = ACCENTS.length;

/**
 * Ranked by triangle count rather than bounding volume deliberately: volume ranks a large
 * hollow shell above the dense mechanism inside it, which is the opposite of what a viewer
 * reads as "the main body".
 */
export function autoColors(parts: PartNode[], authored: boolean): Map<string, string> {
  const colors = new Map<string, string>();
  if (authored) return colors;
  // One assembly means nothing to differentiate FROM, so colour would only mislead.
  if (parts.length < 2) return colors;

  const ranked = [...parts].sort(
    (a, b) => b.triangles - a.triangles || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );

  ranked.slice(1, 1 + MAX_AUTO_COLORED).forEach((partNode, i) => {
    colors.set(partNode.key, ACCENTS[i]);
  });

  return colors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="colour|color"`
Expected: PASS — 8 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/model/autoColor.ts scripts/tests/autoColor.test.mjs
git commit -m "feat: add the restrained auto-colour rule"
```

---

### Task 3: STEP import preserves the assembly hierarchy

**Files:**
- Modify: `types/occt-import-js.d.ts`
- Modify: `lib/model/stepToGlb.ts:85-140`
- Test: `scripts/tests/stepToGlb.test.mjs`

**Interfaces:**
- Consumes: `PART_MARKER` from `lib/model/partTree.ts`.
- Produces: a GLB whose node hierarchy mirrors OCCT's `root`, with `extras.stikoPart === true` on every part node.

- [ ] **Step 1: Write the failing test**

Read the existing `scripts/tests/stepToGlb.test.mjs` first to match its fixture style, then append:

```js
import { WebIO } from '@gltf-transform/core';
import { PART_MARKER } from '../../lib/model/partTree.ts';

/** Names of a node's children, so nesting can be asserted without depending on indices. */
function childNames(node) {
  return node.listChildren().map((c) => c.getName());
}

test('the OCCT assembly hierarchy is reproduced as nested glTF nodes', async () => {
  // Two solids under one assembly node, which is what a wheel looks like coming out of OCCT.
  const fake = {
    success: true,
    root: {
      name: 'Car',
      meshes: [],
      children: [
        { name: 'Wheel_FL', meshes: [], children: [
          { name: 'Rim', meshes: [0], children: [] },
          { name: 'Tire', meshes: [1], children: [] },
        ] },
      ],
    },
    meshes: [triangleMesh('Rim'), triangleMesh('Tire')],
  };

  const glb = await buildGlbFromResult(fake);
  const doc = await new WebIO().readBinary(glb);
  const [carNode] = doc.getRoot().listScenes()[0].listChildren();

  assert.equal(carNode.getName(), 'Car');
  assert.deepEqual(childNames(carNode), ['Wheel_FL']);
  assert.deepEqual(childNames(carNode.listChildren()[0]), ['Rim', 'Tire']);
});

test('every node in the hierarchy is stamped as a part', async () => {
  const fake = {
    success: true,
    root: { name: 'Car', meshes: [], children: [{ name: 'Body', meshes: [0], children: [] }] },
    meshes: [triangleMesh('Body')],
  };

  const doc = await new WebIO().readBinary(await buildGlbFromResult(fake));
  const [carNode] = doc.getRoot().listScenes()[0].listChildren();

  assert.equal(carNode.getExtras()[PART_MARKER], true);
  assert.equal(carNode.listChildren()[0].getExtras()[PART_MARKER], true);
});

test('a result with no root falls back to a flat list of stamped solids', async () => {
  // Older occt-import-js builds, and any file whose product structure is empty.
  const fake = { success: true, meshes: [triangleMesh('solid_a'), triangleMesh('solid_b')] };

  const doc = await new WebIO().readBinary(await buildGlbFromResult(fake));
  const children = doc.getRoot().listScenes()[0].listChildren();

  assert.deepEqual(children.map((c) => c.getName()), ['solid_a', 'solid_b']);
  assert.ok(children.every((c) => c.getExtras()[PART_MARKER] === true));
});
```

Add these two helpers at the top of the file if the existing fixtures do not already provide equivalents:

```js
/** One triangle, which is the least geometry OCCT could plausibly hand back. */
function triangleMesh(name) {
  return {
    name,
    index: { array: [0, 1, 2] },
    attributes: {
      position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    },
  };
}

/**
 * Drives stepToGlb's document-building with a canned OCCT result, so the hierarchy can be
 * tested without a 7.6 MB WASM tessellation on every run.
 */
async function buildGlbFromResult(result) {
  const { buildGlbDocument } = await import('../../lib/model/stepToGlb.ts');
  return buildGlbDocument(result);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="hierarchy|stamped|flat list"`
Expected: FAIL — `buildGlbDocument is not a function`.

- [ ] **Step 3: Declare `root` in the OCCT types**

In `types/occt-import-js.d.ts`, add the node interface and extend `OcctResult`:

```ts
  /**
   * The assembly hierarchy OCCT reads out of the STEP product structure. Previously not
   * declared at all, which is why stepToGlb flattened every model to a list of sibling
   * solids and threw the tree away — the data was always there.
   */
  interface OcctNode {
    name?: string;
    /** Indices into OcctResult.meshes owned by this node directly. */
    meshes?: number[];
    children?: OcctNode[];
  }

  interface OcctResult {
    success: boolean;
    /** Absent on older builds and on files whose product structure is empty. */
    root?: OcctNode;
    meshes: OcctMesh[];
  }
```

- [ ] **Step 4: Rebuild the hierarchy in `stepToGlb.ts`**

Replace the mesh loop and `return` in `lib/model/stepToGlb.ts` (currently lines ~85-140, the block from `const doc = new Document();` to the end of `stepToGlb`) with:

```ts
import { PART_MARKER } from './partTree.ts';
import type { OcctNode, OcctResult } from 'occt-import-js';

/**
 * Builds the glTF document for an OCCT result, hierarchy included.
 *
 * Split out of stepToGlb so the tree can be unit-tested against a canned result rather than
 * a 7.6 MB WASM tessellation.
 */
export async function buildGlbDocument(result: OcctResult): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  /** One glTF node per OCCT mesh, stamped so the viewer can find it again. */
  const nodeForMesh = (index: number): Node => {
    const mesh = result.meshes[index];
    const name = mesh.name || `solid_${index}`;

    const primitive = doc.createPrimitive().setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3')
        .setArray(new Float32Array(mesh.attributes.position.array)).setBuffer(buffer)
    );

    if (mesh.attributes.normal?.array?.length) {
      primitive.setAttribute(
        'NORMAL',
        doc.createAccessor().setType('VEC3')
          .setArray(new Float32Array(mesh.attributes.normal.array)).setBuffer(buffer)
      );
    }

    if (mesh.index?.array?.length) {
      primitive.setIndices(
        doc.createAccessor().setType('SCALAR')
          .setArray(new Uint32Array(mesh.index.array)).setBuffer(buffer)
      );
    }

    const [r, g, b] = mesh.color ?? DEFAULT_COLOR;
    primitive.setMaterial(
      doc.createMaterial(`${name}_material`)
        .setBaseColorFactor([r, g, b, 1])
        // metallic=0 on purpose. glTF defaults both factors to 1, which is exactly the
        // pitch-black-mesh trap repairMaterials.ts exists to undo; do not emit it here.
        .setMetallicFactor(0)
        .setRoughnessFactor(0.6)
        // CAD parts are frequently thin or perforated, and a single-sided wall disappears
        // when viewed through an opening. Matches makeDoubleSided() in the viewer.
        .setDoubleSided(true)
    );

    return doc.createNode(name)
      .setMesh(doc.createMesh(name).addPrimitive(primitive))
      .setExtras({ [PART_MARKER]: true });
  };

  /**
   * An OCCT node becomes one glTF node carrying its own meshes and its children.
   *
   * A node owning several meshes gets them as child nodes rather than as several primitives
   * on one mesh: the panel must be able to show "Rim" as one row, and buildPartTree already
   * treats unmarked children as geometry belonging to their nearest marked ancestor.
   */
  const buildNode = (occt: OcctNode, fallbackName: string): Node => {
    const node = doc.createNode(occt.name || fallbackName).setExtras({ [PART_MARKER]: true });

    const own = occt.meshes ?? [];
    if (own.length === 1) {
      // The common case — one solid, one node. Attach the mesh directly so the tree has no
      // pass-through row between the part and its geometry.
      const meshNode = nodeForMesh(own[0]);
      node.setMesh(meshNode.getMesh());
      meshNode.dispose();
    } else {
      for (const index of own) {
        // Unmarked on purpose: these are this part's geometry, not parts of their own.
        node.addChild(nodeForMesh(index).setExtras({}));
      }
    }

    (occt.children ?? []).forEach((child, i) => node.addChild(buildNode(child, `node_${i}`)));
    return node;
  };

  if (result.root) {
    scene.addChild(buildNode(result.root, 'root'));
  } else {
    // No product structure — every solid is its own top-level part.
    result.meshes.forEach((_, i) => scene.addChild(nodeForMesh(i)));
  }

  return new WebIO().writeBinary(doc);
}
```

Then reduce the tail of `stepToGlb` itself to:

```ts
  return buildGlbDocument(result);
}
```

Add `Node` to the `@gltf-transform/core` import at the top of the file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="hierarchy|stamped|flat list"`
Expected: PASS — 3 passing tests.

Run: `npm test`
Expected: PASS — the whole suite, including the pre-existing `stepToGlb` tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add types/occt-import-js.d.ts lib/model/stepToGlb.ts scripts/tests/stepToGlb.test.mjs
git commit -m "feat: keep the STEP assembly hierarchy through import"
```

---

### Task 4: GLB optimization preserves parts

**Files:**
- Modify: `lib/model/optimizeGlb.ts:31-45` (`OptimizeCounts`), `:60-85` (`measure`), `:120-140` (the transform chain)
- Test: `scripts/tests/optimizeGlb.test.mjs`

**Interfaces:**
- Consumes: `PART_MARKER` from `lib/model/partTree.ts`.
- Produces: `OptimizeCounts` gains `parts: number`. Output GLB keeps one stamped node per part.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tests/optimizeGlb.test.mjs`:

```js
import { PART_MARKER } from '../../lib/model/partTree.ts';

/**
 * What a CAD exporter emits: `partCount` named objects, each fragmented into
 * `fragmentsPerPart` primitives, dealt `materialCount` materials round-robin. This is the
 * shape that used to collapse to one primitive per material with every name erased.
 */
function fragmentedParts(partCount, fragmentsPerPart, materialCount = 2) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const materials = Array.from({ length: materialCount }, (_, m) =>
    doc.createMaterial(`mat_${m}`).setBaseColorFactor([m / materialCount, 0.5, 0.5, 1])
  );

  for (let p = 0; p < partCount; p++) {
    const mesh = doc.createMesh(`part_${p}`);
    for (let f = 0; f < fragmentsPerPart; f++) {
      const position = doc.createAccessor().setType('VEC3')
        .setArray(new Float32Array([f, p, 0, f + 1, p, 0, f, p + 1, 0])).setBuffer(buffer);
      mesh.addPrimitive(
        doc.createPrimitive().setAttribute('POSITION', position).setMaterial(materials[f % materialCount])
      );
    }
    scene.addChild(doc.createNode(`part_${p}`).setMesh(mesh).setExtras({ [PART_MARKER]: true }));
  }
  return doc;
}

test('parts survive optimization while their fragments are merged away', async () => {
  const input = await toArrayBuffer(fragmentedParts(6, 50, 2));

  const { stats, buffer } = await optimizeGlb(input);

  assert.equal(stats.before.parts, 6);
  assert.equal(stats.after.parts, 6, 'six parts in, six parts out');
  // 6 parts x 50 fragments = 300 primitives in; 6 parts x 2 materials = 12 out.
  assert.equal(stats.before.primitives, 300);
  assert.equal(stats.after.primitives, 12);
  assert.equal(stats.after.triangles, stats.before.triangles);

  const doc = await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(buffer));
  const nodes = doc.getRoot().listNodes().filter((n) => n.getExtras()[PART_MARKER] === true);
  assert.equal(nodes.length, 6);
  assert.deepEqual(nodes.map((n) => n.getName()).sort(), [
    'part_0', 'part_1', 'part_2', 'part_3', 'part_4', 'part_5',
  ]);
});

test('part names survive — the regression this feature exists to fix', async () => {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const materials = [
    doc.createMaterial('SteelGrey').setBaseColorFactor([0.6, 0.6, 0.62, 1]),
    doc.createMaterial('Brass').setBaseColorFactor([0.7, 0.55, 0.2, 1]),
  ];
  ['Body', 'Flange_A', 'Flange_B', 'Bonnet', 'Stem', 'Handwheel'].forEach((name, i) => {
    const position = doc.createAccessor().setType('VEC3')
      .setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0])).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(materials[i % 2]);
    scene.addChild(
      doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim))
        .setExtras({ [PART_MARKER]: true })
    );
  });

  const { stats } = await optimizeGlb(await toArrayBuffer(doc));

  // Before this change: 6 nodes / 6 primitives in, 2 nodes / 2 primitives out.
  assert.equal(stats.after.parts, 6);
});

test('same-named siblings become one part, not one per material', async () => {
  // What Rhino emits: one node per object AND per material, so a two-material rim is two
  // sibling nodes both called "Rim".
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const materials = [
    doc.createMaterial('Steel').setBaseColorFactor([0.6, 0.6, 0.62, 1]),
    doc.createMaterial('Chrome').setBaseColorFactor([0.9, 0.9, 0.92, 1]),
  ];
  [['Rim', 0], ['Rim', 1], ['Tire', 0]].forEach(([name, m], i) => {
    const position = doc.createAccessor().setType('VEC3')
      .setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0])).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(materials[m]);
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  });

  const { buffer: out } = await optimizeGlb(await toArrayBuffer(doc));
  const result = await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(out));
  const topLevel = result.getRoot().listScenes()[0].listChildren();

  assert.deepEqual(topLevel.map((n) => n.getName()).sort(), ['Rim', 'Tire']);
  const rim = topLevel.find((n) => n.getName() === 'Rim');
  assert.equal(rim.listChildren().length, 2, 'both material pieces live under the one Rim part');
});

test('unnamed siblings are never grouped together', async () => {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial('Steel').setBaseColorFactor([0.6, 0.6, 0.62, 1]);
  for (let i = 0; i < 3; i++) {
    const position = doc.createAccessor().setType('VEC3')
      .setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0])).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material);
    scene.addChild(doc.createNode('').setMesh(doc.createMesh('').addPrimitive(prim)));
  }

  const { stats } = await optimizeGlb(await toArrayBuffer(doc));

  assert.equal(stats.after.parts, 3, 'three unnamed nodes stay three parts');
});

test('a document built without our stamps still optimizes, and conserves its parts', async () => {
  // fragmentedGlb builds nodes the way a raw exporter would. Once optimizeGlb stamps every
  // geometry-carrying node (Step 8), these count as parts too — so the guarantee under test
  // is conservation, which holds either way, not a particular count.
  const { stats } = await optimizeGlb(await toArrayBuffer(fragmentedGlb(100, 2)));

  assert.equal(stats.after.parts, stats.before.parts);
  assert.ok(stats.after.primitives < stats.before.primitives, 'still merged');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="parts survive|part names survive|conserves its parts|same-named|unnamed siblings"`
Expected: FAIL — `stats.before.parts` is `undefined`.

- [ ] **Step 3: Count parts in `measure()`**

In `lib/model/optimizeGlb.ts`, add to the `OptimizeCounts` interface, after `lineIndices`:

```ts
  /**
   * Nodes stamped as parts. Counted for the same reason lineIndices is: the lossless
   * guarantee has to be able to SEE everything it claims to preserve. join() used to erase
   * part identity while "triangles unchanged" stayed green.
   */
  parts: number;
```

Add the import at the top:

```ts
import { PART_MARKER } from './partTree.ts';
```

And in `measure()`, before the `return`:

```ts
  const parts = doc.getRoot().listNodes()
    .filter((node) => node.getExtras()[PART_MARKER] === true).length;
```

then add `parts,` to the returned object.

- [ ] **Step 4: Run the test to confirm the counting works and the merge still fails**

Run: `npm test -- --test-name-pattern="parts survive"`
Expected: FAIL — `stats.after.parts` is `0`, not `6`. `flatten()` and `join()` are still erasing the nodes.

- [ ] **Step 5: Replace `flatten()` + `join()` with per-part merging**

In `lib/model/optimizeGlb.ts`, change the `@gltf-transform/functions` import: drop `flatten` and `join`, add `joinPrimitives`.

Replace the `doc.transform(...)` call and the comment above it with:

```ts
  // Order is load-bearing. weld() must precede the per-part merge, so co-located vertices are
  // already indexed and merged by the time primitives are concatenated.
  // One dedup, not two. The original ran a second pass because flatten() sat between them and
  // exposed duplicates the first could not see; with flatten gone the second pass finds
  // nothing and is pure cost.
  await doc.transform(
    dedup(),                        // merge identical accessors / materials / textures
    weld(),                         // index and merge co-located vertices
    prune({ keepLeaves: true })     // drop what the above orphaned; keepLeaves protects parts
  );

  // flatten() + join() used to live here. They collapsed the node hierarchy and merged every
  // primitive sharing a material, taking a 7,995-primitive Rhino export to 26 draw calls —
  // and erasing every part in the process. A synthetic six-part export came out the far side
  // as two nodes with no names.
  //
  // Merging WITHIN each part instead keeps the win where it actually comes from. The Rhino
  // file's fragmentation is intra-part: hundreds of two-triangle primitives per object. Those
  // still merge. What no longer merges is one part into another, which is the whole point.
  // Draw calls are no longer the concern they were either — the viewer batches parts at
  // runtime with THREE.BatchedMesh, so the count here governs load time, not frame time.
  //
  // prune() above uses keepLeaves: true because a part node whose geometry has been merged
  // into a sibling would otherwise be pruned as an empty leaf, silently losing a row from the
  // parts panel.
  for (const mesh of doc.getRoot().listMeshes()) {
    const byMaterial = new Map<string, Primitive[]>();
    for (const prim of mesh.listPrimitives()) {
      // Mode as well as material: joinPrimitives cannot concatenate LINES into TRIANGLES, and
      // CAD exports carry both. Normalisation above has already reduced these to LINES/TRIANGLES.
      const key = `${prim.getMaterial()?.getName() ?? ''}#${prim.getMode()}`;
      const group = byMaterial.get(key);
      if (group) group.push(prim);
      else byMaterial.set(key, [prim]);
    }

    for (const group of byMaterial.values()) {
      if (group.length < 2) continue;
      // joinPrimitives throws when primitives are not compatible, and grouping by material
      // does not guarantee they are — one CAD primitive may carry UVs where its neighbour
      // does not. An uncaught throw here would abandon the WHOLE optimization (runOptimize
      // reads any throw as "upload the original"), trading every other part's merge for one
      // awkward group. Skip the group instead: those primitives stay unmerged, which is
      // slower to load and completely correct.
      let merged;
      try {
        merged = joinPrimitives(group);
      } catch {
        continue;
      }
      // dispose() detaches each primitive from its mesh, which is the documented idiom.
      for (const prim of group) prim.dispose();
      mesh.addPrimitive(merged);
    }
  }

  await doc.transform(prune({ keepLeaves: true }));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="parts survive|part names survive|conserves its parts|same-named|unnamed siblings"`
Expected: PASS — 3 passing tests.

Run: `npm test`
Expected: PASS. The pre-existing lossless assertions on triangles and `lineIndices` must still hold — if the primitive-restart test now reports a different `lineIndices`, the mode key above is wrong and must be fixed rather than the assertion relaxed.

- [ ] **Step 7: Update the summary line in `runOptimize.ts`**

In `lib/model/runOptimize.ts`, in `prepareViewerVariantNow`, change the summary template to report parts:

```ts
    summary:
      `Optimised ${file.name}: ${before.primitives} → ${after.primitives} primitives, ` +
      `${after.parts} parts preserved, ${after.triangles} triangles preserved, ` +
      `${Math.round(before.bytes / 1024)}KB → ${Math.round(after.bytes / 1024)}KB`,
```

- [ ] **Step 8: Stamp parts on GLB import**

Files uploaded as GLB carry no `stikoPart` marker of their own. Add to `optimizeGlb.ts`, immediately after the primitive-mode normalisation loop and **before** `const before = measure(doc, input.byteLength);`:

```ts
  // Stamp the exporter's own nodes as parts. A node that carries geometry — directly or
  // through descendants — is a part; a pure transform node is not. Read back from userData at
  // load time (GLTFLoader copies extras verbatim), this is what lets the viewer rebuild a tree
  // the exporter authored and we no longer destroy.
  //
  // First, though: same-named siblings are ONE object, not several. Rhino emits one node per
  // object AND per material, so a rim with a steel body and a chrome lip arrives as two
  // sibling nodes both named "Rim". Stamping each would put the same physical part on two
  // panel rows and let someone colour half a rim. Grouping them under one stamped wrapper
  // recovers the object the modeller actually made.
  //
  // The wrapper carries an identity transform, so its children keep the world placement their
  // own transforms give them — this is why the group is NOT reparented under its first member,
  // which would compose that member's transform onto its siblings.
  const carriesGeometry = (node: Node): boolean =>
    node.getMesh() !== null || node.listChildren().some(carriesGeometry);

  /** Parents whose children may need grouping: the scene roots, and every node. */
  const parents: { list: () => Node[]; add: (n: Node) => void; remove: (n: Node) => void }[] = [
    ...doc.getRoot().listScenes().map((scene) => ({
      list: () => scene.listChildren(),
      add: (n: Node) => { scene.addChild(n); },
      remove: (n: Node) => { scene.removeChild(n); },
    })),
    ...doc.getRoot().listNodes().map((node) => ({
      list: () => node.listChildren(),
      add: (n: Node) => { node.addChild(n); },
      remove: (n: Node) => { node.removeChild(n); },
    })),
  ];

  for (const parent of parents) {
    const byName = new Map<string, Node[]>();
    for (const child of parent.list()) {
      const name = child.getName();
      // Unnamed nodes are not evidence of anything — grouping every unnamed sibling together
      // would fuse unrelated geometry into one row.
      if (!name || !carriesGeometry(child)) continue;
      const group = byName.get(name);
      if (group) group.push(child);
      else byName.set(name, [child]);
    }

    for (const [name, group] of byName) {
      if (group.length < 2) continue;
      const wrapper = doc.createNode(name);
      for (const child of group) {
        parent.remove(child);
        wrapper.addChild(child);
      }
      parent.add(wrapper);
    }
  }

  for (const node of doc.getRoot().listNodes()) {
    if (carriesGeometry(node)) node.setExtras({ ...node.getExtras(), [PART_MARKER]: true });
  }
```

The stamping loop runs **after** the grouping loop, so wrappers are stamped along with everything else. A wrapper's children end up stamped too — which is correct and intended: `buildPartTree` will show the rim as one row that can be expanded to its two material pieces, and colouring the rim row colours the subtree.

Add `Node` to the `@gltf-transform/core` import.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS, with no test edits needed — the conservation assertions were written to hold both before and after stamping.

- [ ] **Step 10: Commit**

```bash
git add lib/model/optimizeGlb.ts lib/model/runOptimize.ts scripts/tests/optimizeGlb.test.mjs
git commit -m "feat: preserve part identity through GLB optimization"
```

---

### Task 5: Persistence — table, API, and payload

**Files:**
- Create: `lib/migrations/009-part-colors.sql`
- Create: `app/api/files/[id]/part-colors/route.ts`
- Modify: `lib/schema.sql` (append the table so a fresh database gets it)
- Modify: `app/api/files/route.ts:25-45` and `:67-80`

**Interfaces:**
- Consumes: `getFileAccess` from `lib/access.ts`, `sql` from `lib/db`, `auth` from `lib/auth`.
- Produces: `PATCH /api/files/[id]/part-colors` accepting `{ partKey: string, color: string | null }`; each file in `GET /api/files?versionId=` gains `partColors: Record<string, string>`.

- [ ] **Step 1: Write the migration**

Create `lib/migrations/009-part-colors.sql`:

```sql
-- Per-part colours for a 3D model, saved on the file so everyone opening the
-- package sees the same thing.
--
-- A table rather than a JSONB column on files, specifically so two reviewers
-- colouring different parts of the same model cannot clobber one another's
-- writes. Rows are sparse: only deliberate overrides land here, because the
-- automatic colouring is a deterministic function of the part tree and needs
-- no storage.
--
-- part_key is an index path into the model's node hierarchy ("0/2/1"), stable
-- only because an uploaded file's bytes never change. Re-optimizing a stored
-- file would renumber every part and silently reassign every colour here.
CREATE TABLE IF NOT EXISTS part_colors (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  part_key TEXT NOT NULL,
  color TEXT NOT NULL,
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_id, part_key)
);

CREATE INDEX IF NOT EXISTS part_colors_file_id_idx ON part_colors(file_id);
```

Append the same `CREATE TABLE` block to `lib/schema.sql` after the `markups` table, so a fresh database gets it without the migration.

- [ ] **Step 2: Verify the migration is well-formed**

Run: `npm run migrate -- --dry`
Expected: lists `009-part-colors.sql` as outstanding and touches nothing. If `DATABASE_URL` is unset the command exits with the instruction to load `.env.local` — that is the expected local outcome and does not block this task.

- [ ] **Step 3: Write the route**

Create `app/api/files/[id]/part-colors/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';

/**
 * Set or clear the colour of one part of a 3D model, for everyone who opens the package.
 *
 * The client hides the colour pill for roles that may not do this, but that is presentation
 * only — this route is the actual boundary. Same shape and same gate as the transform route
 * beside it: colouring a part and moving the object are the same class of shared-scene edit,
 * which is why canTransform covers both rather than a parallel capability being invented.
 *
 * Visibility deliberately has no endpoint. Hiding a part is a way of LOOKING at a model and
 * is session-only, exactly as a cross-section plane's pose is.
 */

/** Six-digit hex with a leading #. Anything else would render as black with no error shown. */
const HEX = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canTransform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const partKey = body?.partKey;
  const color = body?.color;

  if (typeof partKey !== 'string' || partKey.length === 0 || partKey.length > 200) {
    return NextResponse.json({ error: 'Invalid part' }, { status: 400 });
  }
  if (color !== null && (typeof color !== 'string' || !HEX.test(color))) {
    return NextResponse.json({ error: 'Invalid colour' }, { status: 400 });
  }

  if (color === null) {
    // Clearing an override returns the part to whatever the model itself says, which may be
    // an auto-colour or its original material. Deleting the row IS the reset.
    await sql`
      DELETE FROM part_colors WHERE file_id = ${params.id} AND part_key = ${partKey}
    `;
    return NextResponse.json({ ok: true });
  }

  await sql`
    INSERT INTO part_colors (id, file_id, part_key, color, set_by)
    VALUES (${randomUUID()}, ${params.id}, ${partKey}, ${color}, ${session.user.id})
    ON CONFLICT (file_id, part_key)
    DO UPDATE SET color = EXCLUDED.color, set_by = EXCLUDED.set_by
  `;

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Include colours in the files payload**

In `app/api/files/route.ts`, after the `counts` query, add:

```ts
  // Sparse by construction — only deliberate overrides are rows — so one query for the whole
  // version is cheaper than a join that would repeat every file row per coloured part.
  const colorRows = await sql`
    SELECT pc.file_id AS "fileId", pc.part_key AS "partKey", pc.color
    FROM part_colors pc
    JOIN files f ON f.id = pc.file_id
    WHERE f.version_id = ${versionId}
  `;
  const colorsByFile = new Map<string, Record<string, string>>();
  for (const row of colorRows) {
    const forFile = colorsByFile.get(row.fileId as string) ?? {};
    forFile[row.partKey as string] = row.color as string;
    colorsByFile.set(row.fileId as string, forFile);
  }
```

Then in the `files = rows.map(...)` return object, add:

```ts
      partColors: colorsByFile.get(row.id as string) ?? {},
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/migrations/009-part-colors.sql lib/schema.sql app/api/files/[id]/part-colors/route.ts app/api/files/route.ts
git commit -m "feat: persist per-part colours on the file"
```

---

### Task 6: Batch the model for rendering

**Files:**
- Create: `lib/model/buildBatches.ts`
- Test: `scripts/tests/buildBatches.test.mjs`

**Interfaces:**
- Consumes: `PartNode` from `lib/model/partTree.ts`.
- Produces: `interface PartInstance { mesh: THREE.BatchedMesh; instanceId: number; baseColor: THREE.Color }`, `interface PartBatches { meshes: THREE.BatchedMesh[]; instances: Map<string, PartInstance[]>; dispose(): void }`, `buildBatches(parts: PartNode[]): PartBatches | null`, `applyPartColor(batches, key, color: THREE.Color | null)`, `applyPartVisibility(batches, key, visible: boolean)`, `partKeyAt(batches, mesh: THREE.Object3D, batchId: number): string | null`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/buildBatches.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBatches, applyPartColor, applyPartVisibility } from '../../lib/model/buildBatches.ts';

function part(key, name, materials, tris = 2) {
  const meshes = materials.map((material) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
    geometry.setIndex(Array.from({ length: tris * 3 }, (_, i) => i));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    return mesh;
  });
  return { key, name, children: [], meshes, triangles: tris };
}

const grey = () => new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.6, metalness: 0 });
const brass = () => new THREE.MeshStandardMaterial({ color: 0xc8a05a, roughness: 0.6, metalness: 0 });
const shiny = () => new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.1, metalness: 1 });

test('materials differing only in colour share one batch', () => {
  const batches = buildBatches([part('0', 'Body', [grey()]), part('1', 'Flange', [brass()])]);

  assert.equal(batches.meshes.length, 1, 'one draw call for the whole model');
  assert.equal(batches.instances.size, 2);
});

test('materials differing in anything else get separate batches', () => {
  const batches = buildBatches([part('0', 'Body', [grey()]), part('1', 'Trim', [shiny()])]);

  assert.equal(batches.meshes.length, 2);
});

test('each part original colour is baked into its instance', () => {
  const batches = buildBatches([part('0', 'Body', [grey()]), part('1', 'Flange', [brass()])]);

  const [instance] = batches.instances.get('1');
  const read = new THREE.Color();
  instance.mesh.getColorAt(instance.instanceId, read);

  assert.equal(read.getHexString(), 'c8a05a');
  assert.equal(instance.baseColor.getHexString(), 'c8a05a');
});

test('the batch material is white so setColorAt is the whole colour', () => {
  const batches = buildBatches([part('0', 'Body', [grey()])]);
  const material = batches.meshes[0].material;

  assert.equal(material.color.getHexString(), 'ffffff');
  assert.equal(material.vertexColors, true);
});

test('a part with two materials becomes two instances under one key', () => {
  const batches = buildBatches([part('0', 'Rim', [grey(), shiny()])]);

  assert.equal(batches.instances.get('0').length, 2);
});

test('nested parts are batched too', () => {
  const rim = part('1/0', 'Rim', [grey()]);
  const wheel = { ...part('1', 'Wheel', [grey()]), children: [rim] };

  const batches = buildBatches([part('0', 'Body', [grey()]), wheel]);

  assert.deepEqual([...batches.instances.keys()].sort(), ['0', '1', '1/0']);
});

test('applyPartColor sets the colour and null restores the original', () => {
  const batches = buildBatches([part('0', 'Body', [grey()])]);
  const read = new THREE.Color();

  applyPartColor(batches, '0', new THREE.Color('#ff0000'));
  batches.meshes[0].getColorAt(0, read);
  assert.equal(read.getHexString(), 'ff0000');

  applyPartColor(batches, '0', null);
  batches.meshes[0].getColorAt(0, read);
  assert.equal(read.getHexString(), '8899aa');
});

test('applyPartVisibility hides and shows the part', () => {
  const batches = buildBatches([part('0', 'Body', [grey()])]);

  applyPartVisibility(batches, '0', false);
  assert.equal(batches.meshes[0].getVisibleAt(0), false);

  applyPartVisibility(batches, '0', true);
  assert.equal(batches.meshes[0].getVisibleAt(0), true);
});

test('applying to an unknown key is a no-op, not a crash', () => {
  const batches = buildBatches([part('0', 'Body', [grey()])]);

  applyPartColor(batches, '9/9', new THREE.Color('#ff0000'));
  applyPartVisibility(batches, '9/9', false);
});

test('a model with no parts batches to null', () => {
  assert.equal(buildBatches([]), null);
});

test('a part with no geometry does not produce an instance', () => {
  const empty = { key: '0', name: 'Empty', children: [], meshes: [], triangles: 0 };
  assert.equal(buildBatches([empty]), null);
});

test('partKeyAt maps a raycast batchId back to its part', () => {
  const batches = buildBatches([part('0', 'Body', [grey()]), part('1', 'Flange', [brass()])]);
  const flange = batches.instances.get('1')[0];

  assert.equal(partKeyAt(batches, flange.mesh, flange.instanceId), '1');
  assert.equal(partKeyAt(batches, flange.mesh, 99), null);
});
```

Add `partKeyAt` to the import at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="batch"`
Expected: FAIL — `Cannot find module '../../lib/model/buildBatches.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/model/buildBatches.ts`:

```ts
import * as THREE from 'three';
import { flattenParts, type PartNode } from './partTree.ts';

/**
 * Renders a part tree as as few draw calls as its materials allow, with per-part colour.
 *
 * THREE.BatchedMesh is doing the work this module exists to set up: many geometries in one
 * buffer, one multi-draw, and — the reason it was chosen over separate meshes or a custom
 * vertex-colour scheme — per-instance colour (setColorAt), per-instance visibility
 * (setVisibleAt) and per-instance picking (intersect.batchId) all native.
 *
 * The batch material is WHITE with vertexColors on, and each part's original colour is baked
 * in through setColorAt. The shader multiplies the batch colour into vColor
 * (color_vertex.glsl, USE_BATCHING_COLOR), so a white base makes setColorAt the entire colour
 * rather than a tint over one. That is also what lets materials differing only in colour
 * share a batch — which, in CAD exports, is nearly all of them.
 *
 * Never call BatchedMesh.optimize(): it can make instance ids stop matching indices
 * (BatchedMesh.js:780), and every id here is a durable handle held in `instances`.
 */

export interface PartInstance {
  mesh: THREE.BatchedMesh;
  instanceId: number;
  /** What the model itself said this part's colour was, for restoring after an override. */
  baseColor: THREE.Color;
}

export interface PartBatches {
  meshes: THREE.BatchedMesh[];
  instances: Map<string, PartInstance[]>;
  dispose(): void;
}

/**
 * Everything about a material EXCEPT its base colour. Two materials agreeing here share a
 * batch; anything else — a map, a different roughness, a different side — gets its own.
 */
function appearanceKey(material: THREE.Material): string {
  const standard = material as THREE.MeshStandardMaterial;
  return [
    material.type,
    standard.roughness ?? '',
    standard.metalness ?? '',
    material.side,
    material.transparent ? standard.opacity : 1,
    standard.map?.uuid ?? '',
    standard.normalMap?.uuid ?? '',
    standard.emissive?.getHexString() ?? '',
  ].join('|');
}

/** The material a batch is drawn with: the source's properties, colour removed. */
function batchMaterialFrom(source: THREE.Material): THREE.MeshStandardMaterial {
  const material = (source as THREE.MeshStandardMaterial).clone();
  material.color = new THREE.Color(0xffffff);
  material.vertexColors = true;
  return material;
}

/**
 * BatchedMesh requires every geometry it holds to share one attribute layout, and CAD
 * geometry arrives inconsistent — some primitives carry UVs, some do not. Reduce each to
 * position + normal + index, which is all an untextured CAD surface needs, and add uv only
 * where the batch's material actually samples one.
 */
function normalized(source: THREE.BufferGeometry, needsUv: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const position = source.getAttribute('position');
  geometry.setAttribute('position', position);
  geometry.setAttribute(
    'normal',
    source.getAttribute('normal') ?? new THREE.BufferAttribute(new Float32Array(position.count * 3), 3)
  );
  if (needsUv) {
    geometry.setAttribute(
      'uv',
      source.getAttribute('uv') ?? new THREE.BufferAttribute(new Float32Array(position.count * 2), 2)
    );
  }
  geometry.setIndex(
    source.getIndex() ??
      new THREE.BufferAttribute(new Uint32Array(Array.from({ length: position.count }, (_, i) => i)), 1)
  );
  return geometry;
}

interface Pending {
  material: THREE.Material;
  entries: { partKey: string; mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[];
  vertices: number;
  indices: number;
}

export function buildBatches(parts: PartNode[]): PartBatches | null {
  const groups = new Map<string, Pending>();

  for (const part of flattenParts(parts)) {
    for (const mesh of part.meshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const material = materials[0];
      if (!material || !mesh.geometry?.getAttribute('position')) continue;

      const key = appearanceKey(material);
      const pending = groups.get(key) ?? { material, entries: [], vertices: 0, indices: 0 };
      const geometry = normalized(mesh.geometry, Boolean((material as THREE.MeshStandardMaterial).map));

      pending.entries.push({ partKey: part.key, mesh, geometry });
      pending.vertices += geometry.getAttribute('position').count;
      pending.indices += geometry.getIndex().count;
      groups.set(key, pending);
    }
  }

  if (groups.size === 0) return null;

  const meshes: THREE.BatchedMesh[] = [];
  const instances = new Map<string, PartInstance[]>();

  for (const pending of groups.values()) {
    const batched = new THREE.BatchedMesh(
      pending.entries.length,
      pending.vertices,
      pending.indices,
      batchMaterialFrom(pending.material)
    );
    // Frustum culling is per instance inside BatchedMesh; culling the batch as a whole would
    // drop the entire model the moment its bounds left the frustum.
    batched.frustumCulled = false;

    for (const entry of pending.entries) {
      const geometryId = batched.addGeometry(entry.geometry);
      const instanceId = batched.addInstance(geometryId);
      // Geometry stays in its own local space; placement rides on the instance matrix, so a
      // part keeps whatever transform its node carried.
      entry.mesh.updateMatrixWorld(true);
      batched.setMatrixAt(instanceId, entry.mesh.matrixWorld);

      const source = (Array.isArray(entry.mesh.material) ? entry.mesh.material[0] : entry.mesh.material) as
        THREE.MeshStandardMaterial;
      const baseColor = source.color ? source.color.clone() : new THREE.Color(0xffffff);
      batched.setColorAt(instanceId, baseColor);

      const list = instances.get(entry.partKey) ?? [];
      list.push({ mesh: batched, instanceId, baseColor });
      instances.set(entry.partKey, list);
    }

    meshes.push(batched);
  }

  return {
    meshes,
    instances,
    dispose() {
      for (const mesh of meshes) {
        mesh.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
  };
}

/** `null` restores whatever the model itself said the part's colour was. */
export function applyPartColor(batches: PartBatches, key: string, color: THREE.Color | null): void {
  for (const instance of batches.instances.get(key) ?? []) {
    instance.mesh.setColorAt(instance.instanceId, color ?? instance.baseColor);
  }
}

export function applyPartVisibility(batches: PartBatches, key: string, visible: boolean): void {
  for (const instance of batches.instances.get(key) ?? []) {
    instance.mesh.setVisibleAt(instance.instanceId, visible);
  }
}

/**
 * Which part a raycast hit. `batchId` comes off the intersection BatchedMesh produces
 * (BatchedMesh.js:947); this is the reverse of the index built above.
 *
 * Linear over instances rather than a second map: it runs once per click, never per frame,
 * and a second map would be one more thing to keep in step with the first.
 */
export function partKeyAt(batches: PartBatches, mesh: THREE.Object3D, batchId: number): string | null {
  for (const [key, list] of batches.instances) {
    for (const instance of list) {
      if (instance.mesh === mesh && instance.instanceId === batchId) return key;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="batch|partKeyAt"`
Expected: PASS — 12 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/model/buildBatches.ts scripts/tests/buildBatches.test.mjs
git commit -m "feat: batch a part tree into BatchedMesh draw calls"
```

---

### Task 7: Render batches in the viewer

**Files:**
- Modify: `components/viewers/ModelViewerInner.tsx:148-201` (the `Model` component) and its props interface
- Modify: `components/viewers/ModelViewer.tsx`
- Modify: `components/viewers/ViewerContainer.tsx:163`

**Interfaces:**
- Consumes: `buildPartTree`, `hasAuthoredColors` (Task 1); `autoColors`, `BASE_GREY` (Task 2); `buildBatches`, `applyPartColor`, `applyPartVisibility` (Task 6).
- Produces: `ModelViewer` gains props `partColors: Record<string, string>`, `hiddenParts: string[]`, `highlightedPart: string | null`, `onPartsLoaded?: (parts: PartNode[], authored: boolean) => void`, `onPartPick?: (key: string) => void`. These thread unchanged through `ViewerContainer`.

- [ ] **Step 1: Replace the GLB/STEP branches of `Model` with a batched renderer**

In `components/viewers/ModelViewerInner.tsx`, add imports:

```ts
import { buildPartTree, hasAuthoredColors, type PartNode } from '@/lib/model/partTree';
import { autoColors } from '@/lib/model/autoColor';
import { buildBatches, applyPartColor, applyPartVisibility, partKeyAt, type PartBatches } from '@/lib/model/buildBatches';
```

Give `Model` the new props and replace its `return` for the GLTF, STEP, OBJ, 3DS and DAE branches — the formats that can carry a hierarchy — with a single batched path. STL and PLY keep their existing `<mesh>` branch untouched: they are single geometries and have no parts to find.

```tsx
function Model({
  url,
  partColors,
  hiddenParts,
  highlightedPart,
  onPartsLoaded,
  onBatchesReady,
}: {
  url: string;
  partColors: Record<string, string>;
  hiddenParts: string[];
  highlightedPart: string | null;
  onPartsLoaded?: (parts: PartNode[], authored: boolean) => void;
  /** Hands the batches to SceneInteraction so a click can be mapped back to a part. */
  onBatchesReady?: (batches: PartBatches | null) => void;
}) {
  const ext = getExtFromUrl(url);
  const LoaderClass = getLoaderForExt(ext);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = useLoader(LoaderClass as any, url);

  useMemo(() => {
    if (ext === '.ply' && data instanceof THREE.BufferGeometry) data.computeVertexNormals();
  }, [ext, data]);

  const root = useMemo<THREE.Object3D | null>(() => {
    if (data instanceof THREE.BufferGeometry) return null;
    return data instanceof THREE.Object3D ? data : ((data as GLTF | Collada)?.scene ?? null);
  }, [data]);

  // Repair runs first and on the LOADED tree, before batching: it only ever touches materials
  // the exporter left at glTF's metal=1/rough=1 defaults, and buildBatches reads those same
  // materials to decide appearance groups and baked colours. Batching a pitch-black material
  // would bake pitch black.
  useMemo(() => {
    if (!root) return;
    repairExporterDefaults(root);
    makeDoubleSided(root);
  }, [root]);

  const parts = useMemo(() => (root ? buildPartTree(root) : []), [root]);
  const batches = useMemo<PartBatches | null>(() => (parts.length ? buildBatches(parts) : null), [parts]);
  // Computed here, where the loaded materials are, and reported upward — the panel's swatches
  // must resolve colours the same way the viewport does, and it cannot see the materials.
  const authored = useMemo(() => (root ? hasAuthoredColors(root) : false), [root]);
  const automatic = useMemo(() => autoColors(parts, authored), [parts, authored]);

  useEffect(() => () => batches?.dispose(), [batches]);

  useEffect(() => {
    onPartsLoaded?.(parts, authored);
  }, [parts, authored, onPartsLoaded]);

  useEffect(() => {
    onBatchesReady?.(batches);
  }, [batches, onBatchesReady]);

  // Overrides win over auto-colours, auto-colours win over the model's own material, and a
  // hovered part outranks all three. Every part is written every time rather than diffed:
  // setColorAt is a texel write, and tracking which changed would cost more than redoing all.
  //
  // Highlight is a lightened version of what the part would otherwise be, not a fixed colour —
  // a fixed highlight over an already-similar part is invisible, which is the one case the
  // highlight exists for.
  useEffect(() => {
    if (!batches) return;
    const color = new THREE.Color();
    for (const key of batches.instances.keys()) {
      const hex = partColors[key] ?? automatic.get(key);
      const base = hex ? color.clone().set(hex) : null;
      if (key !== highlightedPart) {
        applyPartColor(batches, key, base);
        continue;
      }
      const source = base ?? batches.instances.get(key)![0].baseColor;
      applyPartColor(batches, key, source.clone().lerp(new THREE.Color(0xffffff), 0.45));
    }
  }, [batches, partColors, automatic, highlightedPart]);

  useEffect(() => {
    if (!batches) return;
    const hidden = new Set(hiddenParts);
    for (const key of batches.instances.keys()) {
      applyPartVisibility(batches, key, !hidden.has(key));
    }
  }, [batches, hiddenParts]);

  if (ext === '.stl' || ext === '.ply') {
    const geometry = data as THREE.BufferGeometry;
    const material = geometry.hasAttribute('color') ? VERTEX_COLOR_MATERIAL : DEFAULT_MATERIAL;
    return <mesh geometry={geometry} material={material} />;
  }

  // No parts found — a legacy upload whose hierarchy was flattened at import, or a format
  // that never carried one. Render the tree as-is rather than pretending to segment it.
  if (!batches || !root) return <primitive object={root ?? data} />;

  return (
    <>
      {batches.meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Pick a part by clicking it in the viewport**

In `ModelViewerInner.tsx`, hold the batches beside the existing model ref:

```tsx
  const [batches, setBatches] = useState<PartBatches | null>(null);
```

Pass `onBatchesReady={setBatches}` to `<Model>`, and `batches` plus `onPartPick` down to `<SceneInteraction>`. Inside `SceneInteraction`'s `handlePointerDown`, **after** the existing comment-tool early return and before the pin logic, add a separate raycast branch:

```tsx
      // A part pick is not a pin drop: it runs when the comment tool is OFF, so the two can
      // never both fire from one click.
      if (!commentToolActive && onPartPick && batches) {
        const model = modelRef.current;
        if (!model) return;
        const rect = gl.domElement.getBoundingClientRect();
        if (isPointerOverGizmo(e.clientX - rect.left, e.clientY - rect.top, rect.width)) return;

        mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.current.setFromCamera(mouse.current, camera);

        for (const hit of raycaster.current.intersectObject(model, true)) {
          // Same clipping guard, same reason, as the pin raycast below: three's raycaster
          // ignores clipping planes, so a cross-sectioned-away half stays hittable and would
          // select a part the viewer cannot see.
          if (isClipped(clipPlanesRef.current, hit.point)) continue;
          if (hit.batchId === undefined) continue;
          const key = partKeyAt(batches, hit.object, hit.batchId);
          if (key) onPartPick(key);
          break;
        }
        return;
      }
```

A drag that orbits the camera must not also select. Record `e.clientX/e.clientY` in a ref on `pointerdown`, move the branch above to a `pointerup` listener on the same canvas, and run it only when the pointer moved **4 px or less** in both axes since that pointerdown. Below that a click reads as a click; above it, the user was orbiting and selecting a part would be a surprise.

- [ ] **Step 3: Thread the props through**

In `ModelViewerInnerProps`, add:

```ts
  partColors: Record<string, string>;
  hiddenParts: string[];
  highlightedPart: string | null;
  onPartsLoaded?: (parts: PartNode[], authored: boolean) => void;
  onPartPick?: (key: string) => void;
```

Pass them to `<Model>` at its call site inside `<Center>`. Add the same five props to `components/viewers/ModelViewer.tsx` and forward them, then to `ViewerContainer`'s props and onto `<ModelViewer ... />` at line 163.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors only at the `ViewerContainer` call site in `app/portal/[id]/page.tsx`, reporting the new required props. That is expected and is closed in Task 9.

- [ ] **Step 5: Commit**

```bash
git add components/viewers/ModelViewerInner.tsx components/viewers/ModelViewer.tsx components/viewers/ViewerContainer.tsx
git commit -m "feat: render models as batched parts with per-part colour"
```

---

### Task 8: The Parts panel

**Files:**
- Create: `components/viewers/PartsPanel.tsx`

**Interfaces:**
- Consumes: `PartNode`, `flattenParts` (Task 1); `BASE_GREY` (Task 2); `ColorPickerPopover` from `components/markup/ColorPickerPopover`.
- Produces: `<PartsPanel parts hiddenParts partColors effectiveColor canColor onToggleVisibility onSetColor />` — a self-contained pill plus popover, mounted by Task 9.

- [ ] **Step 1: Build the component**

Create `components/viewers/PartsPanel.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flattenParts, type PartNode } from '@/lib/model/partTree';
import ColorPickerPopover from '@/components/markup/ColorPickerPopover';

/**
 * The model's parts, as a pill that opens a list upward.
 *
 * Collapsed by default and built to match FocalLengthControl beside it: opens upward because
 * the row it sits in is anchored items-end, and closes on an outside pointerdown or Escape.
 *
 * The eye is available to everyone — hiding a part is a way of LOOKING at a model, session
 * only, exactly as a cross-section plane's pose is. The colour pill writes to the server and
 * is inert without canTransform; the route enforces that independently.
 */

/** Above this many rows the list scrolls rather than grows. Search is the way through. */
const MAX_VISIBLE_ROWS = 10;
const ROW_HEIGHT = 32;
/** Rows rendered above and below the viewport, so a fast scroll never shows blank space. */
const OVERSCAN = 5;

interface Row {
  part: PartNode;
  depth: number;
}

/** Depth-first rows, skipping the children of collapsed branches. */
function visibleRows(parts: PartNode[], collapsed: Set<string>, depth = 0): Row[] {
  const out: Row[] = [];
  for (const part of parts) {
    out.push({ part, depth });
    if (part.children.length > 0 && !collapsed.has(part.key)) {
      out.push(...visibleRows(part.children, collapsed, depth + 1));
    }
  }
  return out;
}

export default function PartsPanel({
  parts,
  hiddenParts,
  partColors,
  effectiveColor,
  canColor,
  revealKey,
  onToggleVisibility,
  onSetColor,
  onHoverPart,
}: {
  parts: PartNode[];
  hiddenParts: string[];
  /** Explicit overrides only — what the Reset action clears. */
  partColors: Record<string, string>;
  /** What the part actually renders as: override, else auto-colour, else its own material. */
  effectiveColor: (key: string) => string;
  canColor: boolean;
  /** Set when a part is clicked in the viewport: open the panel and scroll that row into view. */
  revealKey: string | null;
  onToggleVisibility: (key: string) => void;
  onSetColor: (key: string, color: string | null) => void;
  /** `null` on mouse-out. Drives the viewport highlight. */
  onHoverPart: (key: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Same dismissal contract as FocalLengthControl, so the two pills behave identically.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the picker first, then the panel — otherwise dismissing a colour choice
      // takes the whole list with it.
      if (picking) setPicking(null);
      else setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, picking]);

  const hidden = useMemo(() => new Set(hiddenParts), [hiddenParts]);

  const rows = useMemo(() => {
    if (!query.trim()) return visibleRows(parts, collapsed);
    // Search flattens: a match three levels down should be reachable without expanding its
    // ancestors first.
    const needle = query.trim().toLowerCase();
    return flattenParts(parts)
      .filter((part) => (part.name || part.key).toLowerCase().includes(needle))
      .map((part) => ({ part, depth: 0 }));
  }, [parts, collapsed, query]);

  // Clicking a part in the viewport opens the panel and scrolls to its row. This is what
  // keeps the list navigable when a file's part names are poor or absent — the model itself
  // becomes the index into the list.
  useEffect(() => {
    if (!revealKey) return;
    setOpen(true);
    setQuery('');
    // Expand every ancestor, or the row is inside a collapsed branch and cannot be scrolled to.
    setCollapsed((prev) => {
      const next = new Set(prev);
      const segments = revealKey.split('/');
      for (let i = 1; i < segments.length; i++) next.delete(segments.slice(0, i).join('/'));
      return next;
    });
  }, [revealKey]);

  // Separate effect, and after the one above: the row only exists once its ancestors are
  // expanded, so the scroll has to happen on the render that follows.
  useEffect(() => {
    if (!revealKey || !open) return;
    const index = rows.findIndex((row) => row.part.key === revealKey);
    if (index < 0) return;
    listRef.current?.scrollTo({ top: Math.max(0, (index - 2) * ROW_HEIGHT) });
  }, [revealKey, open, rows]);

  if (parts.length === 0) return null;

  // Windowed: a model can carry thousands of parts, and rendering a DOM row for each would
  // cost more than the whole render loop it sits over. Row height is fixed, so the slice is
  // arithmetic rather than measurement.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, first + MAX_VISIBLE_ROWS + OVERSCAN * 2);
  const windowed = rows.slice(first, last);

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div ref={rootRef} className="relative select-none">
      {open && (
        <div className="mb-1.5 w-72 overflow-hidden rounded-panel bg-white shadow-stiko-sheet border border-stiko-border">
          {parts.length > MAX_VISIBLE_ROWS && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search parts"
              className="w-full border-b border-stiko-border px-3 py-2 text-xs outline-none placeholder:text-stiko-muted"
            />
          )}

          <div
            ref={listRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onMouseLeave={() => onHoverPart(null)}
            className="overflow-y-auto"
            style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_HEIGHT }}
          >
            {/* The spacers give the scrollbar the full list's height while only the window
                is actually in the DOM. */}
            <div style={{ height: first * ROW_HEIGHT }} />
            {windowed.map(({ part, depth }) => {
              const isHidden = hidden.has(part.key);
              return (
                <div
                  key={part.key}
                  onMouseEnter={() => onHoverPart(part.key)}
                  className="flex items-center gap-2 px-2 hover:bg-stiko-tint"
                  style={{ height: ROW_HEIGHT, paddingLeft: 8 + depth * 12 }}
                >
                  {part.children.length > 0 && !query.trim() ? (
                    <button
                      onClick={() => toggleCollapsed(part.key)}
                      aria-label={collapsed.has(part.key) ? 'Expand' : 'Collapse'}
                      className="w-3 shrink-0 text-[10px] text-stiko-muted"
                    >
                      {collapsed.has(part.key) ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}

                  <span
                    className={`flex-1 truncate text-xs ${isHidden ? 'text-stiko-muted line-through' : ''}`}
                    title={part.name || part.key}
                  >
                    {part.name || `Part ${part.key}`}
                  </span>

                  <button
                    onClick={() => onToggleVisibility(part.key)}
                    aria-label={isHidden ? `Show ${part.name || part.key}` : `Hide ${part.name || part.key}`}
                    aria-pressed={!isHidden}
                    className="shrink-0 text-stiko-muted hover:text-stiko-ink"
                  >
                    {isHidden ? ClosedEyeIcon : OpenEyeIcon}
                  </button>

                  <button
                    onClick={() => canColor && setPicking(picking === part.key ? null : part.key)}
                    disabled={!canColor}
                    aria-label={`Colour ${part.name || part.key}`}
                    className="h-4 w-6 shrink-0 rounded-full border border-stiko-border disabled:cursor-default"
                    style={{ backgroundColor: effectiveColor(part.key) }}
                  />
                </div>
              );
            })}

            <div style={{ height: Math.max(0, rows.length - last) * ROW_HEIGHT }} />

            {rows.length === 0 && (
              <div className="px-3 py-3 text-xs text-stiko-muted">No parts match “{query}”.</div>
            )}
          </div>

          {picking && canColor && (
            <div className="border-t border-stiko-border p-2">
              <ColorPickerPopover
                color={effectiveColor(picking)}
                onChange={(hex) => onSetColor(picking, hex)}
              />
              <button
                onClick={() => onSetColor(picking, null)}
                disabled={!(picking in partColors)}
                className="mt-2 w-full rounded-panel px-2 py-1 text-xs text-stiko-muted hover:bg-stiko-tint disabled:opacity-40"
              >
                Reset to original
              </button>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs shadow-stiko-sheet border border-stiko-border"
      >
        Parts
        <span className="text-stiko-muted">{parts.length}</span>
      </button>
    </div>
  );
}

const OpenEyeIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const ClosedEyeIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" />
    <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: the only errors are the `ViewerContainer` props from Task 7, still open until Task 9.

- [ ] **Step 3: Commit**

```bash
git add components/viewers/PartsPanel.tsx
git commit -m "feat: add the Parts panel"
```

---

### Task 9: Mount the panel and wire persistence

**Files:**
- Modify: `app/portal/[id]/page.tsx:1328-1332` (the viewport control row) plus the file-state and `ViewerContainer` call site
- Modify: `lib/types.ts` (the client-side file type)

**Interfaces:**
- Consumes: everything from Tasks 1, 2, 7 and 8; `PATCH /api/files/[id]/part-colors` from Task 5.
- Produces: the complete feature.

- [ ] **Step 1: Add `partColors` to the client file type**

In `lib/types.ts`, add to the file interface the API returns (the one carrying `transform`):

```ts
  /** Explicit per-part colour overrides, keyed by part key. Absent for non-3D files. */
  partColors?: Record<string, string>;
```

- [ ] **Step 2: Hold parts, hidden set and colours in page state**

In `app/portal/[id]/page.tsx`, beside the existing viewer state (`focalLength`, `sectionSlots`):

```tsx
  const [parts, setParts] = useState<PartNode[]>([]);
  // Reported by the viewer, which is the only place the loaded materials exist. The panel
  // needs it so its swatches resolve colours exactly as the viewport does.
  const [authored, setAuthored] = useState(false);
  // Session-only, and reset whenever the viewer shows a different file — a part key means
  // nothing across models, so carrying the set over would hide arbitrary geometry.
  const [hiddenParts, setHiddenParts] = useState<string[]>([]);
  // Mirrors the server so the viewport updates on click rather than after a refetch.
  const [partColors, setPartColors] = useState<Record<string, string>>({});
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);
  const [revealPart, setRevealPart] = useState<string | null>(null);

  useEffect(() => {
    setParts([]);
    setAuthored(false);
    setHiddenParts([]);
    setHoveredPart(null);
    setRevealPart(null);
    setPartColors(selectedFile?.partColors ?? {});
  }, [selectedFileId, selectedFile?.partColors]);

  const handlePartsLoaded = useCallback((next: PartNode[], nextAuthored: boolean) => {
    setParts(next);
    setAuthored(nextAuthored);
  }, []);

  // Re-picking the same part is a no-op by design: the row is already open and scrolled to,
  // so there is nothing for a second reveal to do.
  const handlePartPick = useCallback((key: string) => setRevealPart(key), []);
```

Add the imports:

```ts
import PartsPanel from '@/components/viewers/PartsPanel';
import { autoColors, BASE_GREY } from '@/lib/model/autoColor';
import type { PartNode } from '@/lib/model/partTree';
```

- [ ] **Step 3: Write the colour handler**

```tsx
  const setPartColor = useCallback(
    async (key: string, color: string | null) => {
      if (!selectedFileId) return;

      // Optimistic: the viewport must respond to a colour drag immediately, and the picker
      // emits on every pointermove. A failed write is reverted from the server's answer below.
      setPartColors((prev) => {
        const next = { ...prev };
        if (color === null) delete next[key];
        else next[key] = color;
        return next;
      });

      const response = await fetch(`/api/files/${selectedFileId}/part-colors`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partKey: key, color }),
      }).catch(() => null);

      if (!response?.ok) setPartColors(selectedFile?.partColors ?? {});
    },
    [selectedFileId, selectedFile?.partColors]
  );

  const togglePartVisibility = useCallback((key: string) => {
    setHiddenParts((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  // What the panel's pill shows: an override if there is one, else the auto-colour, else the
  // neutral base. This must agree with the resolution order in ModelViewerInner's colour
  // effect — a pill disagreeing with the viewport is worse than no pill.
  const autoPartColors = useMemo(() => autoColors(parts, authored), [parts, authored]);
  const effectivePartColor = useCallback(
    (key: string) => partColors[key] ?? autoPartColors.get(key) ?? BASE_GREY,
    [partColors, autoPartColors]
  );
```

- [ ] **Step 4: Mount the pill**

Replace the control row at line ~1329 with:

```tsx
            {selectedFileId && is3DFile && !annotating && !viewportImage && (
              <div className="absolute bottom-3 left-3 z-20 flex items-end gap-2">
                <FocalLengthControl value={focalLength} onChange={setFocalLength} />
                <PartsPanel
                  parts={parts}
                  hiddenParts={hiddenParts}
                  partColors={partColors}
                  effectiveColor={effectivePartColor}
                  canColor={capabilities.canTransform}
                  revealKey={revealPart}
                  onToggleVisibility={togglePartVisibility}
                  onSetColor={setPartColor}
                  onHoverPart={setHoveredPart}
                />
              </div>
            )}
```

Use whatever the surrounding code already calls the capability object — check the nearby Move/Rotate render condition and match it exactly rather than introducing a second name for the same thing.

- [ ] **Step 5: Pass the viewer props**

At the `<ViewerContainer ... />` call site, add:

```tsx
              partColors={partColors}
              hiddenParts={hiddenParts}
              highlightedPart={hoveredPart}
              onPartsLoaded={handlePartsLoaded}
              onPartPick={handlePartPick}
```

- [ ] **Step 6: Verify it compiles and the suite is green**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS — the whole suite.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/portal/[id]/page.tsx lib/types.ts
git commit -m "feat: mount the Parts panel and persist part colours"
```

---

### Task 10: Browser verification

**Files:** none — this task changes nothing and gates the merge.

`BatchedMesh` replaces the object graph at the heart of the viewer. Unit tests cannot see any of what follows, there is no staging environment, and the markup work shipped without ever being opened in a browser. Do not skip this.

- [ ] **Step 1: Apply the migration and start the app**

```bash
set -a && . .env.local && set +a && npm run migrate
npm run dev
```

Expected: `009-part-colors.sql` applies; the dev server starts. Confirm with:

```bash
set -a && . .env.local && set +a && node -e "
import('@neondatabase/serverless').then(async ({ neon }) => {
  const sql = neon(process.env.DATABASE_URL);
  console.log(await sql\`SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3\`);
});"
```

Expected: `009-part-colors` is listed.

- [ ] **Step 2: Upload a fresh multi-part STEP file and confirm the tree**

Open a package, upload a STEP assembly with more than one solid, and open it in the viewer.

Expected: the `Parts` pill shows a count greater than 1; opening it lists the solids by name; nested assemblies show an expand arrow.

- [ ] **Step 3: Confirm auto-colouring is restrained**

Expected: the largest assembly is neutral grey and at most four others carry a muted accent. Not every part is coloured. A model that arrived with its own materials is untouched.

- [ ] **Step 4: Colour a part and confirm it persists**

Click a colour pill, pick a colour, hard-reload the page.

Expected: the colour survives the reload. Open the same package as a different user with `canTransform`; the colour is there. Open as a `viewer` role; the colour is visible and the pill is inert.

- [ ] **Step 5: Confirm Reset works**

Click a coloured part's pill, then **Reset to original**.

Expected: the part returns to its auto-colour or its own material, and the change survives a reload.

- [ ] **Step 6: Confirm the eye is session-only**

Hide two parts, reload.

Expected: both are visible again. In a second browser as another user, nothing was hidden at any point.

- [ ] **Step 7: Work through the machinery `BatchedMesh` sits under**

Each of these touches the model's object graph and must be exercised by hand:

- **Cross-section** — open the tool, drag each plane, confirm geometry clips and `SectionCaps` still fill. Confirm a hidden part does not reappear in a cap.
- **Comment pins** — drop a pin on a part, confirm it lands on the surface and projects correctly while orbiting. Confirm a pin on a hidden part does not drop through to geometry behind it.
- **Move / rotate** — confirm the gizmo still moves the object and the transform persists.
- **Snapshot** — start a markup session and confirm the captured image matches the viewport, colours included.
- **Framing** — confirm the model is centred and fully in frame on load, and that the focal length control still reframes correctly.
- **Navigation cube** — confirm it still orbits the model and is excluded from snapshots.

- [ ] **Step 8: Confirm a legacy file degrades honestly**

Open a 3D file uploaded **before** this change.

Expected: it renders exactly as it did, and the `Parts` pill does not appear. No console errors.

- [ ] **Step 9: Confirm STL still works**

Open an STL file.

Expected: it renders as before and shows no `Parts` pill.

- [ ] **Step 10: Verify hover-highlight and click-to-reveal**

Hover a row in the panel. Expected: that part lightens in the viewport, and only that part. Move off the list; the highlight clears.

With the panel closed and the comment tool **off**, click a part in the viewport. Expected: the panel opens, expands any collapsed ancestors, and scrolls that part's row into view. With the comment tool **on**, the same click drops a pin and does **not** select a part.

- [ ] **Step 11: Measure draw calls**

Temporarily add to the render loop in `ModelViewerInner.tsx` — inside the existing `useFrame` in `SceneInteraction`:

```ts
  const { gl } = useThree();
  useFrame(() => {
    if (performance.now() % 2000 < 20) console.log('draw calls', gl.info.render.calls);
  });
```

Expected on a multi-part model: low tens at most, not thousands. Compare against the same file before this branch to confirm the count did not rise.

**Remove this logging before committing.**

Also check the console across every step above. Expected: no `WEBGL_multi_draw` errors, no `KHR_mesh_primitive_restart` warnings, no shader compile warnings, no React key warnings from the batch list.

- [ ] **Step 12: Record the outcome**

Write what was verified — and anything that failed — into the PR description or the merge commit body. A verification that leaves no evidence is indistinguishable from one that never ran.

---

## Rollback

- `009-part-colors.sql` is additive: a new table only. `DROP TABLE part_colors;` loses saved colours and nothing else.
- The import changes affect only files uploaded after deploy. Files uploaded before are untouched and unaffected by a revert.
- `buildBatches` returning `null` is already the legacy render path, so disabling batching is a one-line change rather than a rewrite.
- `main` auto-deploys on push, and production is the only environment. Push only after Task 10 is complete.
