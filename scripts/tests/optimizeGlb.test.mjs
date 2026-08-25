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
