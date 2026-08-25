import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { repairExporterDefaults } from '../../lib/model/repairMaterials.ts';

/** A material carrying exactly the signature Rhino leaves behind: unnamed, no PBR factors
 *  written (so the glTF spec defaults of 1.0/1.0 apply), no maps. */
const exporterDefault = (overrides = {}) =>
  new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 1, roughness: 1, ...overrides });

const wrap = (material) => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  return root;
};

const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

test('an exporter-default material stops being metallic', () => {
  const material = exporterDefault();
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 0);
  assert.equal(material.roughness, 0.8);
});

test('a black albedo is lifted so the surface is visible at all', () => {
  // Metalness alone does not save this one: a dielectric with zero albedo reflects
  // essentially nothing either, so 33% of the reference model would stay black.
  const material = exporterDefault({ color: 0x000000 });
  repairExporterDefaults(wrap(material));
  assert.ok(luminance(material.color) > 0.2, 'black albedo was not lifted');
});

test('a coloured exporter-default keeps its colour', () => {
  const material = exporterDefault({ color: 0x3366cc });
  const before = material.color.clone();
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 0, 'metalness should still be corrected');
  assert.ok(material.color.equals(before), 'a visible colour must not be overwritten');
});

test('a NAMED material is never touched', () => {
  // Named means authored. Rhino only omits the name on auto-generated display-colour
  // materials, so the name is the discriminator that keeps intentional black black.
  const material = exporterDefault({ name: 'Plaster' });
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 1);
  assert.equal(material.roughness, 1);
});

test('a textured material is never touched', () => {
  const material = exporterDefault({ map: new THREE.Texture() });
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 1);
});

test('a deliberately authored metal is never touched', () => {
  const material = exporterDefault({ name: 'Chrome', metalness: 1, roughness: 0.2 });
  repairExporterDefaults(wrap(material));
  assert.equal(material.metalness, 1);
  assert.equal(material.roughness, 0.2);
});

test('every entry of an array-material mesh is considered separately', () => {
  const broken = exporterDefault();
  const authored = exporterDefault({ name: 'keep' });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), [broken, authored]));
  repairExporterDefaults(root);
  assert.equal(broken.metalness, 0);
  assert.equal(authored.metalness, 1);
});

test('a material with no metalness at all is skipped without throwing', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
  assert.doesNotThrow(() => repairExporterDefaults(wrap(material)));
});

test('a non-mesh child is skipped without throwing', () => {
  const root = new THREE.Group();
  root.add(new THREE.Object3D());
  assert.doesNotThrow(() => repairExporterDefaults(root));
});

test('returns root', () => {
  const root = new THREE.Group();
  assert.equal(repairExporterDefaults(root), root);
});
