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
