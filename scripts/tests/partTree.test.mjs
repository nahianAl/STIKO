import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPartTree, collectDrawables, flattenParts, hasAuthoredColors, hasMarkers, PART_MARKER } from '../../lib/model/partTree.ts';

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

/**
 * An indexed mesh: 4 positions but 6 indices, i.e. 2 triangles. A bug that read the position
 * count instead of the index count would report `floor(4 / 3) = 1` triangle instead of 2, so
 * the two paths cannot be confused by this fixture.
 */
function indexedMesh(name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8899aa }));
  m.name = name;
  return m;
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

test('triangle count is read from the index, not the position count', () => {
  const root = new THREE.Group();
  root.add(indexedMesh('indexed_geo'));

  const [part] = buildPartTree(root);

  assert.equal(part.triangles, 2);
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

test('totality: every mesh in the scene reaches exactly one node in the returned tree', () => {
  const root = new THREE.Group();

  // A normal marked part.
  root.add(group('Body', true, mesh('body_geo')));

  // An unmarked node that carries a mesh of its own directly — not a pass-through wrapper.
  const trim = new THREE.Group();
  trim.name = 'Trim';
  trim.add(mesh('trim_geo'));
  root.add(trim);

  // An unmarked subtree with no marked descendant anywhere within it.
  const loose = new THREE.Group();
  loose.name = 'Loose';
  const looseChild = new THREE.Group();
  looseChild.name = 'LooseChild';
  looseChild.add(mesh('loose_geo_1'), mesh('loose_geo_2'));
  loose.add(looseChild);
  root.add(loose);

  const parts = buildPartTree(root);

  const expectedIds = new Set();
  root.traverse((object) => {
    if (object.isMesh) expectedIds.add(object.uuid);
  });

  const foundIds = flattenParts(parts).flatMap((node) => node.meshes.map((m) => m.uuid));

  assert.equal(foundIds.length, expectedIds.size, 'no mesh should appear twice');
  assert.deepEqual(new Set(foundIds), expectedIds);
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

// --- Critical finding 2: hasMarkers is the exported, single source of truth for "did this
// file's own import pipeline genuinely declare parts" — the test a caller (ModelViewerInner)
// must gate batching/the Parts pill/auto-colour on, INSTEAD of `buildPartTree(root).length`,
// which is >=1 for practically any file via the unmarked fallback below and therefore cannot
// tell a segmented file apart from a legacy one. ---

test('hasMarkers is false for a tree with no stikoPart marker anywhere', () => {
  const root = new THREE.Group();
  root.add(mesh('mesh_0'), mesh('mesh_1'));
  assert.equal(hasMarkers(root), false);
  // buildPartTree's unmarked fallback still finds 2 parts here — hasMarkers is what tells a
  // caller not to trust that as "this file was actually segmented."
  assert.equal(buildPartTree(root).length, 2);
});

test('hasMarkers is true when any node under root carries the marker, however deeply nested', () => {
  const rim = group('Rim', true, mesh('rim_geo'));
  const wheel = group('Wheel_FL', false, rim);
  const root = new THREE.Group();
  root.add(wheel);
  assert.equal(hasMarkers(root), true);
});

// --- Critical finding 2: buildBatches only ever sees isMesh objects, so LineSegments/Points
// (what GLTFLoader builds for glTF's LINES/LINE_STRIP/LINE_LOOP/POINTS primitives) vanished
// entirely from the batched render. collectDrawables is the separate collection pass that keeps
// them. ---

function lineSegments(name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial());
  line.name = name;
  return line;
}

function points(name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const p = new THREE.Points(geometry, new THREE.PointsMaterial());
  p.name = name;
  return p;
}

test('collectDrawables finds Line/LineSegments/Points anywhere in the tree', () => {
  const nested = group('Nested', false, lineSegments('wire'), points('cloud'));
  const root = new THREE.Group();
  root.add(mesh('body'), nested);

  // Each result is a wrapper Group (see the wrapper-shape tests below); the drawable's own name
  // travelled onto the clone it holds, not onto the wrapper itself.
  const names = collectDrawables(root).map((wrapper) => wrapper.children[0].name);

  assert.deepEqual(names.sort(), ['cloud', 'wire']);
});

test('collectDrawables never returns a Mesh, so nothing it finds can already be inside a batch', () => {
  const root = new THREE.Group();
  root.add(mesh('body'), lineSegments('wire'));

  const drawables = collectDrawables(root);

  assert.equal(drawables.length, 1);
  assert.equal(drawables[0].isGroup, true);
  assert.equal(drawables[0].children[0].isMesh, undefined);
});

test('an empty scene has no drawables', () => {
  assert.deepEqual(collectDrawables(new THREE.Group()), []);
});

// --- Fix wave 2, finding 1 + 2: the transform bake used to mutate the drawable's own
// position/quaternion/scale in place — corrupting the useLoader-cached tree, double-applying the
// bake on a second pass, and reparenting the drawable when <primitive> mounted it. collectDrawables
// now bakes into a fresh wrapper Group around a clone instead, leaving `root` untouched. These
// tests fail against the pre-fix collectDrawables, which returned the drawable found in `root`
// directly: it has no wrapper (so `.children[0]` doesn't exist — indexing it throws or reads
// undefined) and its position is the source's own untouched LOCAL transform, not the world-baked
// value these tests assert. ---

test("collectDrawables bakes the WORLD transform into the wrapper, and leaves the source's own local transform and parent untouched", () => {
  const ancestor = new THREE.Group();
  ancestor.position.set(5, 0, 0);
  const line = lineSegments('wire');
  line.position.set(1, 2, 3);
  ancestor.add(line);
  const root = new THREE.Group();
  root.add(ancestor);

  const [wrapper] = collectDrawables(root);

  // The wrapper carries ancestor-plus-local, i.e. the world position — not the source's
  // local-only [1, 2, 3].
  assert.deepEqual(wrapper.position.toArray(), [6, 2, 3]);
  // The source is exactly as it was: same local position, same parent. Nothing under `root` was
  // touched, let alone reparented.
  assert.deepEqual(line.position.toArray(), [1, 2, 3]);
  assert.equal(line.parent, ancestor);
  // The wrapped clone's own local transform is reset to identity: the wrapper above already
  // supplies the full baked placement, so a non-identity clone transform would double it — the
  // same class of bug one level over from the point of this whole function.
  const [clone] = wrapper.children;
  assert.deepEqual(clone.position.toArray(), [0, 0, 0]);
});

test('collectDrawables is idempotent: a second call bakes the same transform and still finds the source unmutated', () => {
  const ancestor = new THREE.Group();
  ancestor.position.set(5, 0, 0);
  const line = lineSegments('wire');
  line.position.set(1, 2, 3);
  ancestor.add(line);
  const root = new THREE.Group();
  root.add(ancestor);

  const first = collectDrawables(root);
  const second = collectDrawables(root);

  // Same baked value both times — a mutating implementation would bake ancestors into the
  // source's own local position on the first call, so the second call would bake them again on
  // top of that already-baked value.
  assert.deepEqual(first[0].position.toArray(), [6, 2, 3]);
  assert.deepEqual(second[0].position.toArray(), [6, 2, 3]);
  assert.deepEqual(line.position.toArray(), [1, 2, 3]);
});

test('the wrapped clone shares geometry and material with the source rather than duplicating them', () => {
  const root = new THREE.Group();
  const line = lineSegments('wire');
  root.add(line);

  const [wrapper] = collectDrawables(root);
  const [clone] = wrapper.children;

  assert.notEqual(clone, line, 'the clone is a distinct object from the source');
  assert.equal(clone.geometry, line.geometry);
  assert.equal(clone.material, line.material);
});

test('collectDrawables also finds a Sprite, wrapped the same way as Line/Points', () => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
  sprite.name = 'flare';
  const root = new THREE.Group();
  root.add(sprite);

  const [wrapper] = collectDrawables(root);
  const [clone] = wrapper.children;

  assert.equal(clone.name, 'flare');
  assert.equal(clone.isSprite, true);
  // Regression guard: Sprite.prototype.copy() (three/src/objects/Sprite.js) does not propagate
  // `material` the way Line/Points' own copy() does, so a bare `.clone(false)` on a Sprite would
  // silently swap in the constructor's default SpriteMaterial instead of sharing the source's.
  assert.equal(clone.material, sprite.material);
  assert.equal(clone.geometry, sprite.geometry);
});
