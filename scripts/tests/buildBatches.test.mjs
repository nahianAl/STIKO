import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBatches, applyPartColor, applyPartVisibility, partKeyAt } from '../../lib/model/buildBatches.ts';
import { buildPartTree, hasMarkers, PART_MARKER } from '../../lib/model/partTree.ts';

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

// Critical finding 1 (renders BLACK): this test used to assert `vertexColors === true`, pinning
// the exact defect it now guards against. `USE_BATCHING_COLOR` alone (derived from
// `object._colorsTexture !== null` the moment setColorAt is called) already declares and
// initialises `vColor` in three r169's color_vertex.glsl — that is the ENTIRE path setColorAt
// needs, and it has nothing to do with `material.vertexColors`. Setting `vertexColors` on top
// additionally wraps the shader in `#ifdef USE_COLOR { vColor *= color; }`, which reads a
// `color` GEOMETRY attribute that `normalized()` never adds (only position/normal/uv). With no
// such attribute, WebGL supplies the generic default `(0,0,0,1)`, zeroing `vColor` and
// blacking out every batched model. So `vertexColors` must stay false: setColorAt already
// reaches the shader entirely through the batching-colour texture, independent of this flag.
test('the batch material is white and vertexColors is off, so setColorAt alone is the whole colour', () => {
  const batches = buildBatches([part('0', 'Body', [grey()])]);
  const material = batches.meshes[0].material;

  assert.equal(material.color.getHexString(), 'ffffff');
  assert.equal(material.vertexColors, false);
});

// Critical finding 1, follow-on: a SOURCE material that genuinely authored vertexColors (paired
// with a real glTF COLOR_0 attribute) must not carry that flag into the batch material either.
// `.clone()` copies `vertexColors` verbatim, and `normalized()` drops any `color` attribute the
// source geometry had — so without clearing the flag unconditionally, a model with real baked-in
// vertex colours would black out its own batch exactly like the bug above, just triggered by the
// source file instead of by buildBatches itself.
test('a source material that authored vertexColors does not carry the flag into the batch material', () => {
  const material = grey();
  material.vertexColors = true;

  const batches = buildBatches([part('0', 'Body', [material])]);

  assert.equal(batches.meshes[0].material.vertexColors, false);
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

// --- Finding 1: a multi-material mesh (array material + geometry.groups) must split into
// one entry per group, each in its own appearance batch with its own baked colour, instead
// of collapsing onto materials[0]. Reachable via TDSLoader, which builds exactly this shape. ---

function findByColor(list, hex) {
  const read = new THREE.Color();
  return list.find((instance) => {
    instance.mesh.getColorAt(instance.instanceId, read);
    return read.getHexString() === hex;
  });
}

test('a mesh with an array material and geometry groups splits into one instance per group', () => {
  const tris = 4;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  geometry.setIndex(Array.from({ length: tris * 3 }, (_, i) => i));
  // Two triangles per group, exactly as TDSLoader's readFaceArray builds them.
  geometry.addGroup(0, 6, 0);
  geometry.addGroup(6, 6, 1);

  const materialA = new THREE.MeshStandardMaterial({ color: 0x112233, roughness: 0.6, metalness: 0 });
  const materialB = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.1, metalness: 1 });
  const mesh = new THREE.Mesh(geometry, [materialA, materialB]);
  mesh.updateMatrixWorld(true);

  const batches = buildBatches([{ key: '0', name: 'Rim', children: [], meshes: [mesh], triangles: tris }]);

  const list = batches.instances.get('0');
  assert.equal(list.length, 2, 'one instance per material group, same part key');

  const instanceA = findByColor(list, '112233');
  const instanceB = findByColor(list, '445566');
  assert.ok(instanceA, 'group 0 baked materialA colour onto its own instance');
  assert.ok(instanceB, 'group 1 baked materialB colour onto its own instance');
  assert.notEqual(instanceA.mesh, instanceB.mesh, 'differing appearance lands each group in its own batch');
  assert.equal(batches.meshes.length, 2);
});

test('an array material with no geometry groups falls back to materials[0] without throwing', () => {
  const tris = 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  geometry.setIndex(Array.from({ length: tris * 3 }, (_, i) => i));
  // No geometry.addGroup calls: the array-material/no-groups degenerate case.

  const materialA = new THREE.MeshStandardMaterial({ color: 0x112233 });
  const materialB = new THREE.MeshStandardMaterial({ color: 0x445566 });
  const mesh = new THREE.Mesh(geometry, [materialA, materialB]);
  mesh.updateMatrixWorld(true);

  const batches = buildBatches([{ key: '0', name: 'Rim', children: [], meshes: [mesh], triangles: tris }]);

  const list = batches.instances.get('0');
  assert.equal(list.length, 1, 'whole geometry becomes one instance, on materials[0]');
  assert.equal(list[0].baseColor.getHexString(), '112233');
});

test('a group materialIndex with no corresponding material falls back sanely, without throwing', () => {
  const tris = 4;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  geometry.setIndex(Array.from({ length: tris * 3 }, (_, i) => i));
  geometry.addGroup(0, 6, 0);
  geometry.addGroup(6, 6, 1); // materialIndex 1, but only one material is provided below

  const material = grey();
  const mesh = new THREE.Mesh(geometry, [material]);
  mesh.updateMatrixWorld(true);

  assert.doesNotThrow(() => {
    const batches = buildBatches([{ key: '0', name: 'Rim', children: [], meshes: [mesh], triangles: tris }]);
    assert.equal(batches.instances.get('0').length, 2, 'both groups still produce an instance');
  });
});

// --- Finding 2: buildBatches must update ancestor transforms, not just descend into children,
// or a mesh nested under an un-updated parent bakes against a stale (identity) world matrix. ---

test('a mesh nested under a parent whose world matrix was never updated is placed at the composed transform', () => {
  const parent = new THREE.Object3D();
  parent.position.set(10, 0, 0);
  // Deliberately no updateMatrixWorld/updateWorldMatrix call on `parent` here: buildBatches
  // must be the one to bring it up to date, since nothing upstream ever does.

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(6), 3));
  geometry.setIndex([0, 1, 0]);
  const child = new THREE.Mesh(geometry, grey());
  child.position.set(0, 5, 0);
  parent.add(child);

  const batches = buildBatches([{ key: '0', name: 'Child', children: [], meshes: [child], triangles: 1 }]);

  const [instance] = batches.instances.get('0');
  const matrix = new THREE.Matrix4();
  instance.mesh.getMatrixAt(instance.instanceId, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);

  assert.equal(position.x, 10, 'parent x carried through even though parent was never updated');
  assert.equal(position.y, 5, 'child local y preserved');
  assert.equal(position.z, 0);
});

// --- Minor gap: needsUv must cover every map appearanceKey treats as a discriminator, not just
// `map` — a normal-map-only material must keep its UVs rather than silently losing them. ---

test('a normal-map-only material keeps its UVs', () => {
  const material = grey();
  material.normalMap = new THREE.Texture();

  const batches = buildBatches([part('0', 'Body', [material])]);

  assert.ok(batches.meshes[0].geometry.getAttribute('uv'), 'uv attribute preserved for a normal-mapped material');
});

// --- Minor gap: appearanceKey discriminators verified only by inspection before. Each of these
// fails if its line is dropped from the join(). ---

test('materials differing in side get separate batches', () => {
  const a = grey();
  a.side = THREE.FrontSide;
  const b = grey();
  b.side = THREE.BackSide;

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('materials differing in transparency/opacity get separate batches', () => {
  const a = grey();
  a.transparent = true;
  a.opacity = 1;
  const b = grey();
  b.transparent = true;
  b.opacity = 0.4;

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('materials differing in map get separate batches', () => {
  const a = grey();
  a.map = new THREE.Texture();
  const b = grey();

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('materials differing in emissive get separate batches', () => {
  const a = grey();
  const b = grey();
  b.emissive.set(0xff0000);

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

// --- Minor gap 6: buildBatches never read mesh.visible, so a model shipping hidden helper
// geometry (LOD stand-ins, construction aids) showed it once batched. ---

test('a mesh with visible = false produces no instance', () => {
  const [hidden] = part('0', 'Helper', [grey()]).meshes;
  hidden.visible = false;

  const batches = buildBatches([{ key: '0', name: 'Helper', children: [], meshes: [hidden], triangles: 2 }]);

  assert.equal(batches, null, 'the only mesh was invisible, so nothing was left to batch');
});

test('an invisible mesh is skipped while a visible sibling in the same part is still batched', () => {
  const visible = part('0', 'Body', [grey()]).meshes[0];
  const hidden = part('0', 'Helper', [brass()]).meshes[0];
  hidden.visible = false;

  const batches = buildBatches([{ key: '0', name: 'Body', children: [], meshes: [visible, hidden], triangles: 4 }]);

  assert.equal(batches.instances.get('0').length, 1, 'only the visible mesh produced an instance');
});

// --- Important finding 2: UV_MAP_KEYS previously listed only `map` and `normalMap`. glTF's
// metallicRoughnessTexture/occlusionTexture/emissiveTexture and alphaMap are ordinary in GLB
// exports, sample uv exactly the same way, and were both silently folded into the same
// appearanceKey as a plain material AND stripped of uv by normalized(). ---

test('materials differing only in roughnessMap get separate batches', () => {
  const a = grey();
  a.roughnessMap = new THREE.Texture();
  const b = grey();

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('materials differing only in metalnessMap get separate batches', () => {
  const a = grey();
  a.metalnessMap = new THREE.Texture();
  const b = grey();

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('materials differing only in aoMap get separate batches', () => {
  const a = grey();
  a.aoMap = new THREE.Texture();
  const b = grey();

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('materials differing only in emissiveMap get separate batches', () => {
  const a = grey();
  a.emissiveMap = new THREE.Texture();
  const b = grey();

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('materials differing only in alphaMap get separate batches', () => {
  const a = grey();
  a.alphaMap = new THREE.Texture();
  const b = grey();

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('an occlusion(aoMap)-only material keeps its UVs', () => {
  const material = grey();
  material.aoMap = new THREE.Texture();

  const batches = buildBatches([part('0', 'Body', [material])]);

  assert.ok(batches.meshes[0].geometry.getAttribute('uv'), 'uv attribute preserved for an aoMap material');
});

// --- Important finding 2, second half: appearanceKey folded {transparent: true, opacity: 1}
// in with a plain opaque material (both reduced to the same "1" in `transparent ? opacity : 1`),
// and ignored flatShading/alphaTest entirely. All four must be discriminators. ---

test('a transparent material at opacity 1 gets its own batch, separate from a plain opaque one', () => {
  const a = grey();
  a.transparent = true;
  a.opacity = 1;
  const b = grey(); // transparent: false (default), opacity: 1 (default) — same visual opacity value

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2, 'transparent must be its own discriminator, not folded away by an opacity-1 shortcut');
});

test('materials differing in flatShading get separate batches', () => {
  const a = grey();
  a.flatShading = true;
  const b = grey();
  b.flatShading = false;

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

test('materials differing in alphaTest get separate batches', () => {
  const a = grey();
  a.alphaTest = 0.5;
  const b = grey();
  b.alphaTest = 0;

  const batches = buildBatches([part('0', 'A', [a]), part('1', 'B', [b])]);
  assert.equal(batches.meshes.length, 2);
});

// --- Critical finding 2: gating batching on `hasMarkers`, not on `buildPartTree`'s output
// length. buildPartTree's UNMARKED fallback returns one PartNode per direct child of the scene
// root — >=1 for essentially any file, legacy uploads/OBJ/DAE/3DS included — so a caller gating
// on `parts.length` alone batches every such file. The fix gates on `hasMarkers(root)` instead,
// computed independently of what buildPartTree falls back to. These tests pin the pattern
// ModelViewerInner.tsx now follows: only call buildPartTree, and only ever hand its result to
// buildBatches, when the tree is genuinely marked. ---

function meshNamed(name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setIndex([0, 1, 2]);
  const m = new THREE.Mesh(geometry, grey());
  m.name = name;
  m.updateMatrixWorld(true);
  return m;
}

test('an unmarked (legacy) tree stays unbatched even though buildPartTree finds parts via its fallback', () => {
  const root = new THREE.Group();
  root.add(meshNamed('mesh_0'), meshNamed('mesh_1'));

  assert.equal(hasMarkers(root), false, 'no stikoPart marker anywhere in this tree');
  assert.equal(buildPartTree(root).length, 2, "buildPartTree's own fallback still finds 2 parts — that is its documented, tested behaviour");

  // The gated pattern: only build/batch parts when the tree is genuinely marked.
  const parts = hasMarkers(root) ? buildPartTree(root) : [];
  assert.equal(buildBatches(parts), null, 'an unmarked tree must never reach buildBatches with anything to batch');
});

test('a marked tree batches normally under the same gated pattern', () => {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.userData[PART_MARKER] = true;
  body.add(meshNamed('body_geo'));
  root.add(body);

  assert.equal(hasMarkers(root), true);

  const parts = hasMarkers(root) ? buildPartTree(root) : [];
  const batches = buildBatches(parts);
  assert.notEqual(batches, null, 'a marked tree must still batch');
  assert.equal(batches.instances.size, 1);
});
