import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEvictions, BUDGET_BYTES, MIN_RETAINED } from '../../lib/model/modelCache.ts';
import * as THREE from 'three';
import {
  registerModel,
  disposeTree,
  resetModelCacheForTests,
} from '../../lib/model/modelCache.ts';

const MB = 1024 * 1024;
const e = (url, mb, lastUsed) => ({ url, bytes: mb * MB, lastUsed });

test('the defaults match the spec', () => {
  assert.equal(BUDGET_BYTES, 300 * MB);
  assert.equal(MIN_RETAINED, 2);
});

test('nothing is evicted when everything fits', () => {
  const entries = [e('a', 10, 3), e('b', 10, 2), e('c', 10, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), []);
});

test('an empty cache evicts nothing', () => {
  assert.deepEqual(selectEvictions([], 'a'), []);
});

test('the coldest entries go once the budget is blown', () => {
  const entries = [e('a', 100, 4), e('b', 100, 3), e('c', 100, 2), e('d', 100, 1)];
  // a + b + c = 300MB exactly, which fits. d does not.
  assert.deepEqual(selectEvictions(entries, 'a'), ['d']);
});

test('once over budget, every colder entry goes — no cherry-picking a small one', () => {
  // The fixture must leave real HEADROOM after the minRetained cutoff, or it cannot
  // tell the two algorithms apart. a+b retain 200MB of the 300MB budget, leaving
  // 100MB free. 'c' at 150MB does not fit, so it trips the cascade. 'd' at 50MB
  // WOULD fit in that headroom, so a "keep whatever still fits" implementation
  // retains it and returns ['c']; only the strictly-ordered cascade returns
  // ['c','d'].
  //
  // An earlier fixture here used 150/150/150/1 MB, where a+b came to EXACTLY the
  // budget. With zero headroom both algorithms return ['c','d'], so the test passed
  // against the very regression it existed to catch.
  const entries = [e('a', 100, 4), e('b', 100, 3), e('c', 150, 2), e('d', 50, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), ['c', 'd']);
});

test('the active model is never evicted, even when it is the coldest', () => {
  const entries = [e('a', 200, 1), e('b', 200, 4), e('c', 200, 3)];
  const evicted = selectEvictions(entries, 'a');
  assert.ok(!evicted.includes('a'), 'the active model must survive');
});

test('at least MIN_RETAINED entries survive even when both blow the budget', () => {
  // Two 400MB models are over budget together, but A -> B -> A must still be
  // instant, so both are kept.
  const entries = [e('a', 400, 2), e('b', 400, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), []);
});

test('a single model larger than the whole budget is still retained while active', () => {
  const entries = [e('huge', 900, 1)];
  assert.deepEqual(selectEvictions(entries, 'huge'), []);
});

test('the budget and floor are overridable', () => {
  const entries = [e('a', 10, 3), e('b', 10, 2), e('c', 10, 1)];
  assert.deepEqual(selectEvictions(entries, 'a', 15 * MB, 1), ['b', 'c']);
});

/** A model whose disposals are observable. three fires a 'dispose' event on each. */
function fakeModel(fired) {
  const geometry = new THREE.BufferGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  geometry.addEventListener('dispose', () => fired.push('geometry'));
  material.addEventListener('dispose', () => fired.push('material'));
  texture.addEventListener('dispose', () => fired.push('texture'));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  return root;
}

test('disposeTree releases geometry, material and texture', () => {
  const fired = [];
  disposeTree(fakeModel(fired));
  assert.deepEqual(fired.sort(), ['geometry', 'material', 'texture']);
});

test('disposeTree survives a root with no geometry or material', () => {
  assert.doesNotThrow(() => disposeTree(new THREE.Group()));
});

test('disposeTree releases a bare BufferGeometry, which STL and PLY loaders return', () => {
  // STLLoader and PLYLoader resolve to a BufferGeometry, not an Object3D: it has
  // dispose() but no traverse(), so it takes the early-return branch. A THREE.Group
  // does NOT cover this — a Group has traverse() and never reaches that path. Without
  // a test here, deleting the branch frees nothing on exactly the heaviest files in
  // the bucket, where .stl runs to 94 MB.
  let fired = false;
  const geometry = new THREE.BufferGeometry();
  geometry.addEventListener('dispose', () => { fired = true; });
  disposeTree(geometry);
  assert.ok(fired, 'a bare BufferGeometry must be disposed');
});

test('disposeTree handles an array of materials', () => {
  const fired = [];
  const geometry = new THREE.BufferGeometry();
  const a = new THREE.MeshBasicMaterial();
  const b = new THREE.MeshBasicMaterial();
  a.addEventListener('dispose', () => fired.push('a'));
  b.addEventListener('dispose', () => fired.push('b'));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, [a, b]));
  disposeTree(root);
  assert.deepEqual(fired.sort(), ['a', 'b']);
});

test('registering under budget evicts and disposes nothing', () => {
  resetModelCacheForTests();
  const cleared = [];
  const fired = [];
  for (const url of ['a', 'b', 'c']) {
    registerModel({
      url,
      loader: 'GLTFLoader',
      root: fakeModel(fired),
      bytes: 10 * MB,
      clearLoaderCache: (loader, u) => cleared.push(u),
    });
  }
  assert.deepEqual(cleared, []);
  assert.deepEqual(fired, []);
});

test('registering over budget clears and disposes the coldest', () => {
  resetModelCacheForTests();
  const cleared = [];
  const fired = [];
  for (const url of ['a', 'b', 'c', 'd']) {
    registerModel({
      url,
      loader: 'GLTFLoader',
      root: fakeModel(fired),
      bytes: 100 * MB,
      clearLoaderCache: (loader, u) => cleared.push(u),
    });
  }
  // On registering 'd': a,b,c,d = 400MB. Newest three fit in 300MB; 'a' does not.
  assert.deepEqual(cleared, ['a']);
  assert.deepEqual(fired.sort(), ['geometry', 'material', 'texture']);
});

test('re-registering an existing url refreshes it instead of duplicating it', () => {
  resetModelCacheForTests();
  const cleared = [];
  const fired = [];
  const reg = (url) =>
    registerModel({
      url,
      loader: 'GLTFLoader',
      root: fakeModel(fired),
      bytes: 100 * MB,
      clearLoaderCache: (loader, u) => cleared.push(u),
    });
  // a -> b -> c -> a. The revisit to 'a' makes it the newest, so the next
  // registration must drop 'b', the coldest — not 'a'.
  reg('a'); reg('b'); reg('c'); reg('a'); reg('d');
  assert.ok(!cleared.includes('a'), 'a was revisited and must not be evicted');
  assert.deepEqual(cleared, ['b']);
});

test('the model just registered is never the one evicted', () => {
  resetModelCacheForTests();
  const cleared = [];
  const fired = [];
  registerModel({
    url: 'huge',
    loader: 'GLTFLoader',
    root: fakeModel(fired),
    bytes: 900 * MB,
    clearLoaderCache: (loader, u) => cleared.push(u),
  });
  assert.deepEqual(cleared, []);
});
