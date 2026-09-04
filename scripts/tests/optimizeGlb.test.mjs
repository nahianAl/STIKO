import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, Primitive, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { optimizeGlb } from '../../lib/model/optimizeGlb.ts';
import { PART_MARKER } from '../../lib/model/partTree.ts';

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

test('a file that names nothing takes the unsegmented path and reports no parts', async () => {
  // Three unnamed nodes sharing a material. There is no part information in this file, so
  // the honest answer is "no separable parts" — and with nothing to protect, the old
  // aggressive merge applies and all three collapse into one primitive.
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

  assert.equal(stats.after.parts, 0, 'nothing named means nothing to call a part');
  assert.equal(stats.after.primitives, 1, 'and with no parts to protect, the old merge applies');
  assert.equal(stats.after.triangles, stats.before.triangles);
});

test('a single named node among unnamed ones is not enough on its own to take the segmented path', async () => {
  // Fix wave 1 / Finding 2: the discriminator is now `before.parts < 2`, not "does anything
  // carry a name". A lone named node is indistinguishable, by count alone, from a single
  // spuriously-stamped non-geometry ancestor (the RootNode case below) — there is exactly one
  // thing to call a part either way, and a one-item list needs no protection from the
  // aggressive merge. This test used to assert the opposite (segmented path, one part
  // surviving); that was the same "any name at all flips modes" logic Finding 2 replaced.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial('Steel').setBaseColorFactor([0.6, 0.6, 0.62, 1]);
  ['', 'Bonnet', ''].forEach((name, i) => {
    const position = doc.createAccessor().setType('VEC3')
      .setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0])).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material);
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  });

  const { stats } = await optimizeGlb(await toArrayBuffer(doc));

  assert.equal(stats.after.parts, 0, 'one part alone is nothing to differentiate, so the unsegmented path applies');
  assert.equal(stats.after.triangles, stats.before.triangles);
});

test('a document built without our stamps still optimizes, and conserves its parts', async () => {
  // fragmentedGlb builds every node UNNAMED, exactly like fragments off an exporter that
  // never told us any object's name — so optimizeGlb's stamping loop (only named nodes are
  // stamped) marks none of them. before.parts and after.parts are both 0 here, so the
  // `assert.equal` below is really 0 === 0: it does not prove parts survive stamping and
  // merging, only that a document carrying none doesn't spontaneously acquire any. The real
  // conservation guarantee — a stamped part surviving the merge — is covered by the
  // `fragmentedParts` tests above; what this test actually adds is the primitive-count
  // assertion right below: the old aggressive merge still applies to a fully anonymous file.
  const { stats } = await optimizeGlb(await toArrayBuffer(fragmentedGlb(100, 2)));

  assert.equal(stats.after.parts, stats.before.parts);
  assert.ok(stats.after.primitives < stats.before.primitives, 'still merged');
});

// --- Fix wave 1 — findings from the task-4 review ---

test('a single named non-geometry ancestor over unnamed fragments takes the unsegmented path', async () => {
  // Fix wave 1 / Findings 2 & 3: the old discriminator was "does any named node carry
  // geometry", and `carriesGeometry` recurses into children — so a single named ancestor with
  // no mesh of its own (RootNode, Scene, a wrapper carrying the filename: exporters emit these
  // constantly) still counted as "named geometry" and flipped the whole file to the segmented
  // path. The merge is intra-mesh, so a RootNode over N unnamed leaf meshes would then merge
  // NOTHING (each leaf keeps its own single-primitive mesh) and stamp to exactly one part,
  // shipping bloated and gaining no part information. `before.parts < 2` fixes this: RootNode
  // is the only stamped node, before.parts is 1, and the aggressive unsegmented path applies.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial('Steel').setBaseColorFactor([0.6, 0.6, 0.62, 1]);
  const root = doc.createNode('RootNode');
  for (let i = 0; i < 5; i++) {
    const position = doc.createAccessor().setType('VEC3')
      .setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0])).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material);
    root.addChild(doc.createNode('').setMesh(doc.createMesh('').addPrimitive(prim)));
  }
  scene.addChild(root);

  const { stats } = await optimizeGlb(await toArrayBuffer(doc));

  assert.equal(stats.before.parts, 1, 'sanity: only RootNode is named, so only it gets stamped');
  assert.equal(stats.after.parts, 0, 'one ancestor is nothing to differentiate, so the unsegmented path applies');
  assert.equal(stats.after.primitives, 1, 'the five leaf primitives must actually merge, not ship unmerged');
  assert.equal(stats.after.triangles, stats.before.triangles);
});

test('same-name grouping stamps the wrapper, not the children it absorbs', async () => {
  // Fix wave 1 / Finding 4: "same-named siblings become one part" above only asserts names and
  // child count, which stays green even under the double-stamping bug a previous wave fixed —
  // wrapper AND its absorbed children all carrying PART_MARKER, which makes partTree.ts treat
  // the wrapper's own children as nested part boundaries: a "Rim" row whose own children are
  // two more rows also called "Rim". Assert directly on which nodes carry the marker.
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
  const rim = topLevel.find((n) => n.getName() === 'Rim');

  assert.equal(rim.getExtras()[PART_MARKER], true, 'the wrapper must carry the marker');
  assert.equal(rim.listChildren().length, 2, 'sanity: both material pieces still live under the wrapper');
  rim.listChildren().forEach((child) => {
    assert.notEqual(
      child.getExtras()[PART_MARKER],
      true,
      'an absorbed child must not also carry the marker — that would double-stamp one physical part'
    );
  });
});

test('two distinct unnamed materials on one mesh merge to two primitives, not one and not zero', async () => {
  // Fix wave 1 / Finding 1: the merge used to group primitives by material NAME
  // (`material.getName() ?? ''`), so two distinct but both-unnamed materials collided on the
  // same '' key. joinPrimitives then validates by material IDENTITY, throws on the mismatch,
  // and the per-group try/catch skips the whole group — silently merging nothing, for exactly
  // the shape this repo's own fragmentedGlb fixture treats as normal (unnamed materials).
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  // Two distinct, deliberately UNNAMED materials.
  const materialA = doc.createMaterial().setBaseColorFactor([0.2, 0.2, 0.8, 1]);
  const materialB = doc.createMaterial().setBaseColorFactor([0.8, 0.2, 0.2, 1]);

  const mesh = doc.createMesh('Widget');
  for (let i = 0; i < 4; i++) {
    const position = doc.createAccessor().setType('VEC3')
      .setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0])).setBuffer(buffer);
    mesh.addPrimitive(
      doc.createPrimitive().setAttribute('POSITION', position)
        .setMaterial(i % 2 === 0 ? materialA : materialB)
    );
  }
  scene.addChild(doc.createNode('Widget').setMesh(mesh).setExtras({ [PART_MARKER]: true }));

  // A second part purely so before.parts >= 2 and the segmented path — where the per-mesh
  // material grouping under test actually runs — is the one taken.
  const decoyPosition = doc.createAccessor().setType('VEC3')
    .setArray(new Float32Array([50, 0, 0, 51, 0, 0, 50, 1, 0])).setBuffer(buffer);
  scene.addChild(
    doc.createNode('Decoy')
      .setMesh(doc.createMesh('Decoy').addPrimitive(
        doc.createPrimitive().setAttribute('POSITION', decoyPosition).setMaterial(materialA)
      ))
      .setExtras({ [PART_MARKER]: true })
  );

  const { stats, buffer: out } = await optimizeGlb(await toArrayBuffer(doc));

  assert.equal(stats.before.parts, 2, 'sanity: two named parts should take the segmented path');

  const reread = await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(out));
  const widget = reread.getRoot().listNodes().find((n) => n.getName() === 'Widget');
  assert.ok(widget, 'the Widget part must survive');
  assert.equal(
    widget.getMesh().listPrimitives().length,
    2,
    'expected one merged primitive per distinct unnamed material — not one (wrong merge) or four (no merge)'
  );
});

test('primitive mode is part of the merge key — LINES and TRIANGLES under one material stay separate', async () => {
  // Fix wave 1 / Finding 4: no existing fixture puts two primitive modes under one material in
  // one mesh, so deleting `#${prim.getMode()}` from the grouping key failed nothing. Assert the
  // LINES and TRIANGLES groups merge independently, and that line indices are conserved (not
  // silently dropped by a failed, or worse a corrupting, mixed-mode joinPrimitives call).
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial('Steel').setBaseColorFactor([0.6, 0.6, 0.62, 1]);

  const mesh = doc.createMesh('Frame');
  for (let i = 0; i < 2; i++) {
    const triPosition = doc.createAccessor().setType('VEC3')
      .setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0])).setBuffer(buffer);
    mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', triPosition).setMaterial(material));

    // A genuine 2-point line segment, offset so it shares no vertex with the triangles.
    const x = 100 + i * 10;
    const linePosition = doc.createAccessor().setType('VEC3')
      .setArray(new Float32Array([x, 0, 0, x + 1, 0, 0])).setBuffer(buffer);
    mesh.addPrimitive(
      doc.createPrimitive().setMode(Primitive.Mode.LINES)
        .setAttribute('POSITION', linePosition).setMaterial(material)
    );
  }
  scene.addChild(doc.createNode('Frame').setMesh(mesh).setExtras({ [PART_MARKER]: true }));

  // Decoy part purely so before.parts >= 2 and the segmented path is the one taken.
  const decoyPosition = doc.createAccessor().setType('VEC3')
    .setArray(new Float32Array([50, 0, 0, 51, 0, 0, 50, 1, 0])).setBuffer(buffer);
  scene.addChild(
    doc.createNode('Decoy')
      .setMesh(doc.createMesh('Decoy').addPrimitive(
        doc.createPrimitive().setAttribute('POSITION', decoyPosition).setMaterial(material)
      ))
      .setExtras({ [PART_MARKER]: true })
  );

  const { stats, buffer: out } = await optimizeGlb(await toArrayBuffer(doc));

  assert.equal(stats.before.parts, 2, 'sanity: two named parts should take the segmented path');
  assert.ok(stats.before.lineIndices > 0, 'sanity: the input must actually carry line geometry');
  assert.equal(
    stats.after.lineIndices,
    stats.before.lineIndices,
    'line indices must be conserved, not dropped by a failed mixed-mode merge'
  );

  const reread = await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(out));
  const frame = reread.getRoot().listNodes().find((n) => n.getName() === 'Frame');
  const modes = frame.getMesh().listPrimitives().map((p) => p.getMode()).sort();
  assert.deepEqual(
    modes,
    [Primitive.Mode.LINES, Primitive.Mode.TRIANGLES],
    'expected one merged LINES primitive and one merged TRIANGLES primitive, not a mixed-mode merge'
  );
});

test('LINE_STRIP survives the segmented path with triangles, line indices and parts all conserved', async () => {
  // Fix wave 1 / Finding 4: no test sends line geometry down the segmented path — the
  // fragmentedLineGlb tests above only exercise the unsegmented path (unnamed nodes), yet a
  // named CAD file with LINE_STRIPs (construction/dimension lines) is the reference file's
  // actual shape, and a line-geometry blind spot is exactly how the original
  // KHR_mesh_primitive_restart regression shipped in the first place.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const material = doc.createMaterial('Steel').setBaseColorFactor([0.6, 0.6, 0.62, 1]);

  ['Body', 'Bracket'].forEach((name, p) => {
    const mesh = doc.createMesh(name);
    for (let i = 0; i < 2; i++) {
      const triPosition = doc.createAccessor().setType('VEC3')
        .setArray(new Float32Array([p * 10 + i, 0, 0, p * 10 + i + 1, 0, 0, p * 10 + i, 1, 0]))
        .setBuffer(buffer);
      mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', triPosition).setMaterial(material));

      // A real 4-vertex construction-line polyline, offset clear of the triangles and of the
      // other part's lines.
      const x = 1000 + p * 100 + i * 10;
      const linePosition = doc.createAccessor().setType('VEC3')
        .setArray(new Float32Array([x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x + 2, 1, 0]))
        .setBuffer(buffer);
      mesh.addPrimitive(
        doc.createPrimitive().setMode(Primitive.Mode.LINE_STRIP)
          .setAttribute('POSITION', linePosition).setMaterial(material)
      );
    }
    scene.addChild(doc.createNode(name).setMesh(mesh).setExtras({ [PART_MARKER]: true }));
  });

  const { stats, buffer: out } = await optimizeGlb(await toArrayBuffer(doc));

  assert.equal(stats.before.parts, 2, 'sanity: two named parts should take the segmented path');
  assert.ok(stats.before.lineIndices > 0, 'sanity: the input must actually carry line geometry');

  assert.equal(stats.after.triangles, stats.before.triangles, 'triangles must be conserved');
  assert.equal(stats.after.lineIndices, stats.before.lineIndices, 'line indices must be conserved');
  assert.equal(stats.after.parts, stats.before.parts, 'parts must be conserved');

  const reread = await new WebIO().readBinary(new Uint8Array(out));
  assert.equal(
    reread.getRoot().listExtensionsRequired().length,
    0,
    'no required extension may be declared'
  );
});
