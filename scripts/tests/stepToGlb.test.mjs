import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WebIO } from '@gltf-transform/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stepToGlb, STEP_TESSELLATION } from '../../lib/model/stepToGlb.ts';
import { buildPartTree, PART_MARKER } from '../../lib/model/partTree.ts';

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

/** Names of a node's children, so nesting can be asserted without depending on indices. */
function childNames(node) {
  return node.listChildren().map((c) => c.getName());
}

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

test('a failed init does not poison later calls', async () => {
  // Import a fresh copy of the module (cache-busted via query string) so this test owns
  // its own private `occtPromise` module state, independent of whatever the other tests
  // in this file have already warmed it to — this test must prove something regardless
  // of execution order.
  const { stepToGlb: freshStepToGlb } = await import(
    '../../lib/model/stepToGlb.ts?bust=poison-test'
  );

  const brokenLocateFile = (p) => path.join(process.cwd(), 'no/such/directory/', p);

  // First call: init must fail, because the WASM binary genuinely isn't at that path.
  await assert.rejects(() => freshStepToGlb(new Uint8Array(readFileSync(CUBE)), {
    locateFile: brokenLocateFile,
  }));

  // Second call, same module instance, correct locateFile this time: before the fix this
  // replayed the first call's cached rejection forever. It must now succeed and return
  // real geometry, proving the failed init did not poison the module-level cache.
  const glb = await freshStepToGlb(new Uint8Array(readFileSync(CUBE)), { locateFile });
  const doc = await new WebIO().readBinary(glb);
  const meshes = doc.getRoot().listMeshes();
  assert.ok(meshes.length >= 1, 'expected at least one mesh');
  const position = meshes[0].listPrimitives()[0].getAttribute('POSITION');
  assert.ok(position.getCount() > 0, 'expected vertices');
});

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

// The collapse guard (`!occt.name && own.length === 0 && kids.length === 1`) exists only to
// swallow OCCT's anonymous single-solid wrapper. Until now it was exercised solely by an
// incidental assertion against the real cube.stp fixture, which would not notice the
// condition being loosened later (e.g. to `kids.length <= 1`, or dropping the `!occt.name`
// check) — a looser guard would start swallowing genuine, named, or multi-mesh nodes and
// silently reassign every saved part colour beneath them. Each test below nests the
// candidate wrapper one level under a named "Car" so a wrongly-collapsed (or
// wrongly-preserved) node is visible directly in the child list.

test('the collapse guard fires for an unnamed, mesh-less node with exactly one child', async () => {
  const fake = {
    success: true,
    root: {
      name: 'Car',
      meshes: [],
      children: [
        { name: '', meshes: [], children: [
          { name: 'Wheel', meshes: [0], children: [] },
        ] },
      ],
    },
    meshes: [triangleMesh('Wheel')],
  };

  const glb = await buildGlbFromResult(fake);
  const doc = await new WebIO().readBinary(glb);
  const [carNode] = doc.getRoot().listScenes()[0].listChildren();

  // If the wrapper survived, this would read ['node_0'] with "Wheel" nested one level deeper.
  assert.deepEqual(childNames(carNode), ['Wheel']);
});

test('the collapse guard does not fire when the node has a name', async () => {
  const fake = {
    success: true,
    root: {
      name: 'Car',
      meshes: [],
      children: [
        { name: 'Assy', meshes: [], children: [
          { name: 'Wheel', meshes: [0], children: [] },
        ] },
      ],
    },
    meshes: [triangleMesh('Wheel')],
  };

  const glb = await buildGlbFromResult(fake);
  const doc = await new WebIO().readBinary(glb);
  const [carNode] = doc.getRoot().listScenes()[0].listChildren();

  assert.deepEqual(childNames(carNode), ['Assy']);
  assert.deepEqual(childNames(carNode.listChildren()[0]), ['Wheel']);
});

test('the collapse guard does not fire when the node owns a mesh of its own', async () => {
  const fake = {
    success: true,
    root: {
      name: 'Car',
      meshes: [],
      children: [
        { name: '', meshes: [1], children: [
          { name: 'Wheel', meshes: [0], children: [] },
        ] },
      ],
    },
    meshes: [triangleMesh('Wheel'), triangleMesh('wrapper_solid')],
  };

  const glb = await buildGlbFromResult(fake);
  const doc = await new WebIO().readBinary(glb);
  const [carNode] = doc.getRoot().listScenes()[0].listChildren();
  const [wrapperNode] = carNode.listChildren();

  // Fallback-named (it has no name of its own) and not collapsed away, keeping both its own
  // mesh and its child.
  assert.deepEqual(childNames(carNode), ['node_0']);
  assert.ok(wrapperNode.getMesh(), 'expected the wrapper to keep its own mesh');
  assert.deepEqual(childNames(wrapperNode), ['Wheel']);
});

test('the collapse guard does not fire when the node has more than one child', async () => {
  const fake = {
    success: true,
    root: {
      name: 'Car',
      meshes: [],
      children: [
        { name: '', meshes: [], children: [
          { name: 'WheelA', meshes: [0], children: [] },
          { name: 'WheelB', meshes: [1], children: [] },
        ] },
      ],
    },
    meshes: [triangleMesh('WheelA'), triangleMesh('WheelB')],
  };

  const glb = await buildGlbFromResult(fake);
  const doc = await new WebIO().readBinary(glb);
  const [carNode] = doc.getRoot().listScenes()[0].listChildren();
  const [wrapperNode] = carNode.listChildren();

  assert.deepEqual(childNames(carNode), ['node_0']);
  assert.deepEqual(childNames(wrapperNode), ['WheelA', 'WheelB']);
});

test('the collapse guard does not fire when the node has zero children', async () => {
  // An unnamed, mesh-less node with no children is a structural artifact (like the
  // single-solid wrapper), but the guard must not fire on it — broadening the condition
  // to `kids.length <= 1` would attempt to access kids[0] when kids is empty, crashing.
  const fake = {
    success: true,
    root: {
      name: 'Car',
      meshes: [],
      children: [
        { name: '', meshes: [], children: [] },
        { name: 'Wheel', meshes: [0], children: [] },
      ],
    },
    meshes: [triangleMesh('Wheel')],
  };

  const glb = await buildGlbFromResult(fake);
  const doc = await new WebIO().readBinary(glb);
  const [carNode] = doc.getRoot().listScenes()[0].listChildren();

  // The zero-child node becomes node_0 with fallback name, and the Wheel sibling survives.
  assert.deepEqual(childNames(carNode), ['node_0', 'Wheel']);
});

test('a node owning several meshes reads back as several parts, one per mesh, end to end through GLTFLoader', async () => {
  // This test used to assert the OPPOSITE of what's below: that two meshes on one node
  // collapsed into a single part. That was wrong, and it is exactly the defect measured on a
  // real 13 MB customer STEP file, where 11 meshes on `result.root` collapsed into one
  // "Document" row and the whole per-part colouring feature became useless.
  //
  // The old assertion borrowed glTF's own convention: several PRIMITIVES under one MESH are
  // facets of the SAME object (e.g. a rim split across a steel material and a chrome material
  // — still one part, "Rim", with one mesh and two primitives). occt-import-js is not that
  // shape. Its own docs describe a node's `meshes` array as "indices of the meshes in the
  // meshes array for this node", and OCCT emits one MESH per SOLID — each carrying its own
  // name and its own colour. A single solid with several differently-coloured faces is still
  // ONE mesh (coloured per-face via `brep_faces`), so there is no OCCT case where "several
  // meshes on a node" means "one object, multiple facets" the way glTF's multi-primitive mesh
  // does. It only ever means "several distinct solids," and each must be its own addressable
  // part — which is what the parts panel needs an 11-solid assembly to look like.
  //
  // Do not "fix" this test back to `parts.length === 1` with both meshes on it: that would
  // silently restore the collapse this whole fix exists to remove.
  const fake = {
    success: true,
    root: { name: 'Rim', meshes: [0, 1], children: [] },
    meshes: [triangleMesh('rim_steel'), triangleMesh('rim_chrome')],
  };

  const glb = await buildGlbFromResult(fake);
  const arrayBuffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');

  const parts = buildPartTree(gltf.scene);

  assert.equal(parts.length, 1, 'the assembly node itself is still a single top-level part');
  assert.equal(parts[0].name, 'Rim');
  assert.equal(parts[0].meshes.length, 0, 'the assembly row owns no geometry directly');
  assert.equal(
    parts[0].children.length,
    2,
    'each solid must become its own child part, not merge into the parent'
  );
  assert.deepEqual(
    parts[0].children.map((c) => c.name).sort(),
    ['rim_chrome', 'rim_steel']
  );
  assert.ok(
    parts[0].children.every((c) => c.meshes.length === 1),
    'each child part owns exactly its own solid'
  );
});

test('a root node owning many meshes with no children becomes an assembly part with one child per mesh (the measured customer-file shape)', async () => {
  // Measured directly on a real 13 MB customer STEP file: OCCT returned `result.root` with 11
  // meshes and zero children — no intermediate assembly structure at all, everything flat on
  // the root. Before the fix this collapsed to a single "Document" row; the fix must turn it
  // into "Document" plus eleven addressable child parts, one per solid.
  const meshCount = 11;
  const meshes = Array.from({ length: meshCount }, (_, i) => triangleMesh(`solid_${i}`));
  const fake = {
    success: true,
    root: { name: 'Document', meshes: meshes.map((_, i) => i), children: [] },
    meshes,
  };

  const glb = await buildGlbFromResult(fake);
  const arrayBuffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');

  const parts = buildPartTree(gltf.scene);

  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, 'Document');
  assert.equal(parts[0].meshes.length, 0, 'the assembly row owns no geometry directly');
  assert.equal(
    parts[0].children.length,
    meshCount,
    'every one of the 11 solids must be its own addressable part'
  );
  assert.ok(parts[0].children.every((c) => c.meshes.length === 1));
  assert.deepEqual(
    parts[0].children.map((c) => c.name).sort(),
    meshes.map((m) => m.name).sort()
  );
});
