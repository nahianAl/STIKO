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
