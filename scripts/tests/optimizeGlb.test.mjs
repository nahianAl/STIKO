import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, Primitive, WebIO } from '@gltf-transform/core';
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

/**
 * A stand-in for the CAD construction/dimension lines that come out of Rhino alongside the
 * triangle mesh: `stripCount` separate LINE_STRIP primitives (4 vertices each — a genuine
 * polyline, not a degenerate one- or two-point stub), dealt round-robin across
 * `materialCount` materials so join() has multiple same-material strips to merge.
 *
 * That merging is exactly what production KHR_mesh_primitive_restart: join() concatenates
 * same-mode, same-material primitives that carry indices (weld() gives every primitive
 * indices before join() runs) by splicing a restart sentinel between them. With 1 strip per
 * material there is nothing to splice between, so materialCount must leave >=2 strips per
 * material for the bug this guards against to actually reproduce.
 */
function fragmentedLineGlb(stripCount, materialCount = 1) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const materials = Array.from({ length: materialCount }, (_, m) =>
    doc.createMaterial().setBaseColorFactor([m / materialCount, 0.2, 0.8, 1])
  );

  for (let i = 0; i < stripCount; i++) {
    // Offset along X per strip so no two strips share a vertex position — weld() must not
    // accidentally fuse geometry that belongs to different polylines.
    const x = i * 10;
    const position = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x + 2, 1, 0]))
      .setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setMode(Primitive.Mode.LINE_STRIP)
      .setAttribute('POSITION', position)
      .setMaterial(materials[i % materialCount]);
    scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  }
  return doc;
}

/**
 * Every sentinel that join() splices in for KHR_mesh_primitive_restart is a real integer
 * value (0xFFFF / 0xFFFFFFFF) sitting in the indices buffer. If a document that requires the
 * extension is ever read by something that doesn't implement it — three.js included — that
 * sentinel is read back as an ordinary vertex index, which is out of range for the primitive
 * it lives in and resolves to (0,0,0). This is what "stray line to the origin" means in
 * practice, and it's the concrete thing these tests must find.
 */
function countOutOfRangeIndices(doc) {
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (!indices) continue;
      const vertexCount = prim.getAttribute('POSITION').getCount();
      for (const index of indices.getArray()) {
        if (index >= vertexCount) count++;
      }
    }
  }
  return count;
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

// --- C1 / I1: LINE_STRIP primitives must not turn into stray restart geometry ---
//
// The reference file that prompted this branch carries 551 LINE_STRIP primitives (Rhino's
// construction/dimension lines). join() happily merges them using primitive-restart
// sentinels and marks KHR_mesh_primitive_restart REQUIRED — an extension three.js r169 does
// not implement. It only console.warns, then reads every sentinel back as an ordinary,
// out-of-range vertex index, which resolves to (0,0,0): the model's line work turns into
// stray segments radiating to the origin. Measured on the real file before the fix: 12
// merged LINE_STRIP primitives, 539 restart sentinels, extensionsRequired
// ['KHR_mesh_primitive_restart'].
//
// Both tests below must fail if the LINE_STRIP/LINE_LOOP/TRIANGLE_STRIP/TRIANGLE_FAN
// normalisation loop in optimizeGlb.ts is removed — verified by temporarily deleting it: with
// the loop gone, the belt-and-braces required-extensions guard throws (optimizeGlb rejects
// instead of returning), which fails both `await` calls below just as surely as a bad
// assertion would.

test('LINE_STRIP primitives survive optimization with no required extensions', async () => {
  const input = await toArrayBuffer(fragmentedLineGlb(6, 2));
  const { buffer } = await optimizeGlb(input);

  const reread = await new WebIO().readBinary(new Uint8Array(buffer));
  assert.equal(
    reread.getRoot().listExtensionsRequired().length,
    0,
    'output must not require an extension three.js cannot read'
  );
  assert.equal(
    countOutOfRangeIndices(reread),
    0,
    'no index may point past the end of its primitive\'s vertex buffer'
  );
});

test('line geometry index count is preserved exactly through the chain', async () => {
  const input = await toArrayBuffer(fragmentedLineGlb(6, 2));
  const { stats } = await optimizeGlb(input);

  assert.ok(stats.before.lineIndices > 0, 'sanity check: the input must actually carry line geometry');
  assert.equal(
    stats.after.lineIndices,
    stats.before.lineIndices,
    'merging must not add restart sentinels or drop line indices'
  );
});
