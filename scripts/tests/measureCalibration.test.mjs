import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNPAGED,
  assumedMmPerUnit,
  mmPerUnitFrom,
  resolveScale,
} from '../../lib/measure/calibration.ts';

test('STEP files are millimetres, because that is what OCCT emits', () => {
  assert.equal(assumedMmPerUnit('bracket.step'), 1);
  assert.equal(assumedMmPerUnit('BRACKET.STP'), 1);
});

test('glTF files are metres, per the glTF specification', () => {
  assert.equal(assumedMmPerUnit('tower.glb'), 1000);
  assert.equal(assumedMmPerUnit('tower.gltf'), 1000);
});

test('formats with no unit convention are unknown, not guessed', () => {
  for (const name of ['part.obj', 'part.stl', 'part.ply', 'part.3ds', 'part.dae']) {
    assert.equal(assumedMmPerUnit(name), null, name);
  }
});

test('2D files never carry an assumption — they are calibrated or nothing', () => {
  assert.equal(assumedMmPerUnit('sheet.pdf'), null);
  assert.equal(assumedMmPerUnit('site.jpg'), null);
});

test('mmPerUnitFrom divides the real distance by the measured one', () => {
  // 200 intrinsic units spanned 2 metres, so one unit is 10 mm.
  assert.equal(mmPerUnitFrom(200, 2, 'm'), 10);
  assert.equal(mmPerUnitFrom(100, 100, 'mm'), 1);
});

test('mmPerUnitFrom rejects input that would produce a nonsense scale', () => {
  assert.throws(() => mmPerUnitFrom(0, 100, 'mm'), RangeError);
  assert.throws(() => mmPerUnitFrom(100, 0, 'mm'), RangeError);
  assert.throws(() => mmPerUnitFrom(-5, 100, 'mm'), RangeError);
  assert.throws(() => mmPerUnitFrom(100, Number.NaN, 'mm'), RangeError);
});

test('a stored calibration beats the format assumption', () => {
  const scale = resolveScale({ filename: 'tower.glb', calibrations: { [UNPAGED]: 3 } });
  assert.deepEqual(scale, { mmPerUnit: 3, source: 'calibrated' });
});

test('with no calibration a known format falls back to its assumption', () => {
  assert.deepEqual(resolveScale({ filename: 'tower.glb' }), {
    mmPerUnit: 1000,
    source: 'assumed',
  });
});

test('with no calibration and no convention the scale is unknown', () => {
  assert.deepEqual(resolveScale({ filename: 'sheet.pdf' }), {
    mmPerUnit: null,
    source: 'unknown',
  });
});

// A multi-sheet PDF genuinely mixes scales: a 1:50 plan and a 1:20 detail in one document.
test('calibration is looked up per page', () => {
  const calibrations = { 1: 50, 2: 20 };
  assert.equal(resolveScale({ filename: 's.pdf', calibrations, page: 1 }).mmPerUnit, 50);
  assert.equal(resolveScale({ filename: 's.pdf', calibrations, page: 2 }).mmPerUnit, 20);
  assert.equal(resolveScale({ filename: 's.pdf', calibrations, page: 3 }).source, 'unknown');
});

// The trap: a STEP upload is VIEWED as a converted GLB. Reading the extension off the loaded
// file would apply the glTF metre convention and report every STEP model 1000x too large.
test('the assumption reads the original upload name, never the converted GLB', () => {
  assert.equal(resolveScale({ filename: 'bracket.step' }).mmPerUnit, 1);
});
