import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { extractCreaseEdges, CREASE_THRESHOLD_DEG } from '../../lib/model/creaseEdges.ts';

const arrays = (geometry) => ({
  positions: geometry.getAttribute('position').array,
  index: geometry.index ? Uint32Array.from(geometry.index.array) : null,
});
const segmentsOf = (geometry, threshold = CREASE_THRESHOLD_DEG) => {
  const { positions, index } = arrays(geometry);
  return extractCreaseEdges(positions, index, threshold).length / 6;
};
const threeCount = (geometry) =>
  new THREE.EdgesGeometry(geometry, CREASE_THRESHOLD_DEG).getAttribute('position').count / 2;

test('threshold constant is 30 degrees', () => {
  assert.equal(CREASE_THRESHOLD_DEG, 30);
});

test('a box has exactly its 12 edges', () => {
  assert.equal(segmentsOf(new THREE.BoxGeometry(1, 1, 1)), 12);
});

test('a non-indexed box welds its duplicated corners and still finds 12', () => {
  assert.equal(segmentsOf(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()), 12);
});

test('a smooth cylinder gives only its two rim loops', () => {
  // 64 segments -> 5.6 degrees between side facets: no side lines, 64 per rim.
  assert.equal(segmentsOf(new THREE.CylinderGeometry(1, 1, 2, 64)), 128);
});

test('smooth closed surfaces give no edges', () => {
  assert.equal(segmentsOf(new THREE.SphereGeometry(1, 32, 16)), 0);
  assert.equal(segmentsOf(new THREE.TorusKnotGeometry(1, 0.3, 200, 24)), 0);
});

test('agrees with THREE.EdgesGeometry on a mixed shape', () => {
  const geometry = new THREE.CylinderGeometry(0.5, 1, 1, 6); // hexagonal frustum: real creases
  assert.equal(segmentsOf(geometry), threeCount(geometry));
  assert.equal(segmentsOf(new THREE.TorusKnotGeometry(1, 0.3, 100, 16)),
    threeCount(new THREE.TorusKnotGeometry(1, 0.3, 100, 16)));
  // Side facets meet at exactly 30 degrees: a tie that only matches if we compute in doubles.
  const tie = () => new THREE.CylinderGeometry(1, 1, 2, 12);
  assert.equal(segmentsOf(tie()), threeCount(tie()));
});

test('a box translated far from the origin still welds its corners', () => {
  // 300000 * 1e4 overflows int32; the weld must still see each corner's twins.
  const geometry = new THREE.BoxGeometry(100, 100, 100).toNonIndexed();
  geometry.translate(300000, 0, 0);
  assert.equal(segmentsOf(geometry), 12);
});

test('a single triangle emits exactly its three sides as boundary segments', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const out = extractCreaseEdges(positions, null, 30);
  const key = (a, b) => [a, b].map((p) => p.join(',')).sort().join(' | ');
  const segments = [];
  for (let i = 0; i < out.length; i += 6) {
    segments.push(key(
      [out[i], out[i + 1], out[i + 2]],
      [out[i + 3], out[i + 4], out[i + 5]],
    ));
  }
  assert.deepEqual(segments.sort(), [
    key([0, 0, 0], [1, 0, 0]),
    key([1, 0, 0], [0, 1, 0]),
    key([0, 1, 0], [0, 0, 0]),
  ].sort());
});

test('a non-manifold edge shared by three faces matches EdgesGeometry', () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 1, 0, 0, 0, -1, 0,
    0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  assert.equal(segmentsOf(geometry), threeCount(geometry));
});

test('an open edge (one triangle) is a boundary and is emitted', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.equal(extractCreaseEdges(positions, null, 30).length / 6, 3);
});

test('degenerate triangles are skipped without throwing', () => {
  const positions = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0]);
  assert.equal(extractCreaseEdges(positions, null, 30).length, 0);
});

test('a lower threshold finds the cylinder sides too', () => {
  // 5.6 degrees between facets: a 5 degree threshold makes every side seam a crease.
  assert.ok(segmentsOf(new THREE.CylinderGeometry(1, 1, 2, 64), 5) > 128);
});

test('endpoints are real model positions', () => {
  const out = extractCreaseEdges(arrays(new THREE.BoxGeometry(2, 2, 2)).positions,
    arrays(new THREE.BoxGeometry(2, 2, 2)).index, 30);
  for (const value of out) assert.equal(Math.abs(value), 1);
});

// Two triangles on the edge A-B, folded 60 degrees about it (normals 60 degrees apart, past the
// 30 degree threshold). Boundary edges: 2 per triangle, minus nothing, since the shared edge is
// the 5th. A=(0,0,0) B=(1,0,0) C=(0,1,0); D=(0,-0.5,0.866) lies on the other side of the fold.
const FOLD = {
  A: [0, 0, 0],
  B: [1, 0, 0],
  C: [0, 1, 0],
  D: [0, -0.5, Math.sqrt(3) / 2],
};
const flat = (...points) => new Float32Array(points.flat());

test('sharedIsSmooth: a fold whose triangles SHARE both edge indices is smooth, not drawn', () => {
  const positions = flat(FOLD.A, FOLD.B, FOLD.C, FOLD.D);
  const index = Uint32Array.from([0, 1, 2, 1, 0, 3]);
  // Only the 4 outer boundary edges remain.
  assert.equal(extractCreaseEdges(positions, index, 30, true).length / 6, 4);
});

test('sharedIsSmooth off (the default): the same shared-index fold is a crease, as before', () => {
  const positions = flat(FOLD.A, FOLD.B, FOLD.C, FOLD.D);
  const index = Uint32Array.from([0, 1, 2, 1, 0, 3]);
  assert.equal(extractCreaseEdges(positions, index, 30, false).length / 6, 5);
  assert.equal(extractCreaseEdges(positions, index, 30).length / 6, 5);
});

test('sharedIsSmooth: a fold with DUPLICATED vertices (a B-rep face boundary) is still drawn', () => {
  // Indexed, but the fold's two vertices are separate copies with identical positions: this is
  // how CAD tessellation marks a boundary between faces. Welding finds the pair; the original
  // indices do not match, so the edge is a face boundary and the dot product decides.
  const positions = flat(FOLD.A, FOLD.B, FOLD.C, FOLD.B, FOLD.A, FOLD.D);
  const index = Uint32Array.from([0, 1, 2, 3, 4, 5]);
  assert.equal(extractCreaseEdges(positions, index, 30, true).length / 6, 5);
});

test('sharedIsSmooth: sharing only ONE index is not smooth', () => {
  // The triangles touch at vertex A only through an index; edge A-B has duplicated B.
  const positions = flat(FOLD.A, FOLD.B, FOLD.C, FOLD.B, FOLD.D);
  const index = Uint32Array.from([0, 1, 2, 3, 0, 4]);
  assert.equal(extractCreaseEdges(positions, index, 30, true).length / 6, 5);
});

test('sharedIsSmooth does not change a box: its faces own their vertices, so all 12 creases stay', () => {
  const { positions, index } = arrays(new THREE.BoxGeometry(1, 1, 1));
  assert.equal(extractCreaseEdges(positions, index, 30, true).length / 6, 12);
});

test('sharedIsSmooth skips shared-index facets of a curved surface but keeps rims and the UV seam', () => {
  // A 6-sided cylinder has 60 degree side facets that SHARE side vertices. Smooth-by-construction
  // drops those five joins. What stays: the two rim loops (the caps own their vertices, 12
  // segments) and the UV seam, where three.js duplicates one column of side vertices (1 segment).
  const { positions, index } = arrays(new THREE.CylinderGeometry(1, 1, 2, 6));
  assert.equal(extractCreaseEdges(positions, index, 30, false).length / 6, 18);
  assert.equal(extractCreaseEdges(positions, index, 30, true).length / 6, 13);
});

test('welding compares in Float64: points 429,497 units apart that wrap in Int32 stay distinct', () => {
  // fround(1.0204) * 1e4 rounds to 10204, and 429497.75 * 1e4 = 4294977500 = 2^32 + 10204. A weld
  // that stored Int32 (or compared after |0) would see A and B as one point and drop the
  // triangle as degenerate (0 segments). Pinned so that regression cannot return unnoticed.
  const positions = flat([Math.fround(1.0204), 0, 0], [429497.75, 0, 0], [0, 1, 0]);
  assert.equal(extractCreaseEdges(positions, null, 30).length / 6, 3);
});
