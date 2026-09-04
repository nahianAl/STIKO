import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBatches, applyPartColor, applyPartVisibility, partKeyAt } from '../../lib/model/buildBatches.ts';

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

test('the batch material is white so setColorAt is the whole colour', () => {
  const batches = buildBatches([part('0', 'Body', [grey()])]);
  const material = batches.meshes[0].material;

  assert.equal(material.color.getHexString(), 'ffffff');
  assert.equal(material.vertexColors, true);
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
