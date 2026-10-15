import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ModelDisplayError,
  hasDrawableGeometry,
  EMPTY_RHINO_MESSAGE,
  UNREADABLE_3MF_MESSAGE,
} from '../../lib/model/modelDisplayError.ts';

const geometry = () => new THREE.BufferGeometry();

test('a mesh, a line or a point cloud anywhere in the tree is drawable', () => {
  for (const make of [
    () => new THREE.Mesh(geometry()),
    () => new THREE.Line(geometry()),
    () => new THREE.Points(geometry()),
  ]) {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(make());
    root.add(inner);
    assert.equal(hasDrawableGeometry(root), true);
  }
});

test('an empty tree, or one of bare groups, is not drawable', () => {
  assert.equal(hasDrawableGeometry(new THREE.Group()), false);
  const root = new THREE.Object3D();
  root.add(new THREE.Group(), new THREE.Object3D());
  assert.equal(hasDrawableGeometry(root), false);
});

test('ModelDisplayError is an Error that carries a message written for people', () => {
  const err = new ModelDisplayError(EMPTY_RHINO_MESSAGE);
  assert.ok(err instanceof Error);
  assert.equal(err.userMessage, EMPTY_RHINO_MESSAGE);
  assert.match(EMPTY_RHINO_MESSAGE, /Save Small/);
});

test('an unreadable 3MF tells people what to export instead', () => {
  assert.match(UNREADABLE_3MF_MESSAGE, /STL/);
  assert.match(UNREADABLE_3MF_MESSAGE, /3MF/);
  const err = new ModelDisplayError(UNREADABLE_3MF_MESSAGE);
  assert.equal(err.userMessage, UNREADABLE_3MF_MESSAGE);
});
