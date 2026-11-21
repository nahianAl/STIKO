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
