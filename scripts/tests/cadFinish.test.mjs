import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyCadFinish, CAD_FINISH_ROUGHNESS } from '../../lib/model/cadFinish.ts';

const wrap = (...materials) => {
  const root = new THREE.Group();
  for (const material of materials) root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  return root;
};
/** Exactly what lib/model/stepToGlb.ts and cad-worker/usd_to_glb.py emit. */
const converterDefault = (overrides = {}) =>
  new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0, roughness: 0.6, ...overrides });

test('a converter-default material becomes semi-gloss', () => {
  const material = converterDefault();
  applyCadFinish(wrap(material));
  assert.equal(material.roughness, CAD_FINISH_ROUGHNESS);
});

test('the float32 round-trip of 0.6 still matches', () => {
  const material = converterDefault({ roughness: Math.fround(0.6) });
  applyCadFinish(wrap(material));
  assert.equal(material.roughness, CAD_FINISH_ROUGHNESS);
});

test('colour and metalness are never touched', () => {
  const material = converterDefault({ color: 0xc8a05a });
  applyCadFinish(wrap(material));
  assert.equal(material.color.getHexString(), 'c8a05a');
  assert.equal(material.metalness, 0);
});

test('an authored finish is left alone', () => {
  const rougher = converterDefault({ roughness: 0.5 });
  const metal = converterDefault({ metalness: 1 });
  const textured = converterDefault({ map: new THREE.Texture() });
  const normalMapped = converterDefault({ normalMap: new THREE.Texture() });
  applyCadFinish(wrap(rougher, metal, textured, normalMapped));
  assert.equal(rougher.roughness, 0.5);
  assert.equal(metal.roughness, 0.6);
  assert.equal(textured.roughness, 0.6);
  assert.equal(normalMapped.roughness, 0.6);
});

test('non-PBR materials are skipped without throwing', () => {
  const basic = new THREE.MeshBasicMaterial();
  assert.doesNotThrow(() => applyCadFinish(wrap(basic)));
});

test('material arrays are handled', () => {
  const a = converterDefault();
  const b = converterDefault();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), [a, b]));
  applyCadFinish(root);
  assert.equal(a.roughness, CAD_FINISH_ROUGHNESS);
  assert.equal(b.roughness, CAD_FINISH_ROUGHNESS);
});

test('a second pass is a no-op (useLoader caches the tree)', () => {
  const material = converterDefault();
  const root = wrap(material);
  applyCadFinish(root);
  applyCadFinish(root);
  assert.equal(material.roughness, CAD_FINISH_ROUGHNESS);
});

test('returns root for inline use', () => {
  const root = wrap(converterDefault());
  assert.equal(applyCadFinish(root), root);
});
