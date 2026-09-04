import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WebIO } from '@gltf-transform/core';
import { stepToGlb, STEP_TESSELLATION } from '../../lib/model/stepToGlb.ts';
import { PART_MARKER } from '../../lib/model/partTree.ts';

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
