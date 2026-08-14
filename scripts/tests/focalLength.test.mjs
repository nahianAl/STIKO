import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FOCAL_LENGTH_PRESETS,
  DEFAULT_FOCAL_LENGTH,
  MIN_FOCAL_LENGTH,
  MAX_FOCAL_LENGTH,
  fovForFocalLength,
  focalLengthForFov,
  clampFocalLength,
  parseFocalLength,
} from '../../lib/focalLength.ts';

const ASPECTS = [16 / 9, 1000 / 700, 1, 9 / 16];

test('fov matches three.js for every preset at every aspect', () => {
  // three is the authority: the viewer calls camera.setFocalLength, so if this module
  // disagrees the number on the control will not describe what is on screen. Cross-checking
  // against the real camera rather than restating our own formula is the whole point.
  for (const aspect of ASPECTS) {
    for (const mm of FOCAL_LENGTH_PRESETS) {
      const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
      camera.setFocalLength(mm);
      assert.ok(
        Math.abs(fovForFocalLength(mm, aspect) - camera.fov) < 1e-9,
        `aspect ${aspect}, ${mm}mm: ${fovForFocalLength(mm, aspect)} !== ${camera.fov}`,
      );
    }
  }
});

test('focal length round-trips through fov', () => {
  for (const aspect of ASPECTS) {
    for (const mm of [...FOCAL_LENGTH_PRESETS, 8, 12.5, 300]) {
      const back = focalLengthForFov(fovForFocalLength(mm, aspect), aspect);
      assert.ok(Math.abs(back - mm) < 1e-9, `aspect ${aspect}: ${mm} -> ${back}`);
    }
  }
});

test('a longer lens is always a narrower field of view', () => {
  // Monotonicity is what makes the control feel sane; an inverted branch would still
  // round-trip and still look plausible in isolation.
  for (const aspect of ASPECTS) {
    for (let i = 1; i < FOCAL_LENGTH_PRESETS.length; i++) {
      const wider = fovForFocalLength(FOCAL_LENGTH_PRESETS[i - 1], aspect);
      const longer = fovForFocalLength(FOCAL_LENGTH_PRESETS[i], aspect);
      assert.ok(longer < wider, `aspect ${aspect}: ${FOCAL_LENGTH_PRESETS[i]}mm not narrower`);
    }
  }
});

test('the default is one of the presets and inside the range', () => {
  assert.ok(FOCAL_LENGTH_PRESETS.includes(DEFAULT_FOCAL_LENGTH));
  assert.ok(FOCAL_LENGTH_PRESETS.every((mm) => mm >= MIN_FOCAL_LENGTH && mm <= MAX_FOCAL_LENGTH));
});

test('clamping holds the bounds', () => {
  assert.equal(clampFocalLength(0), MIN_FOCAL_LENGTH);
  assert.equal(clampFocalLength(-50), MIN_FOCAL_LENGTH);
  assert.equal(clampFocalLength(1000), MAX_FOCAL_LENGTH);
  assert.equal(clampFocalLength(MIN_FOCAL_LENGTH), MIN_FOCAL_LENGTH);
  assert.equal(clampFocalLength(MAX_FOCAL_LENGTH), MAX_FOCAL_LENGTH);
  assert.equal(clampFocalLength(50), 50);
});

test('parsing accepts what a person would actually type', () => {
  assert.equal(parseFocalLength('50', 35), 50);
  assert.equal(parseFocalLength('  50  ', 35), 50);
  assert.equal(parseFocalLength('50mm', 35), 50);
  assert.equal(parseFocalLength('50 mm', 35), 50);
  assert.equal(parseFocalLength('42.5', 35), 42.5);
});

test('parsing clamps rather than accepting an unusable lens', () => {
  assert.equal(parseFocalLength('1', 35), MIN_FOCAL_LENGTH);
  assert.equal(parseFocalLength('9999', 35), MAX_FOCAL_LENGTH);
});

test('parsing falls back rather than producing a bad number', () => {
  // A NaN reaching setFocalLength gives a NaN projection matrix and a blank viewport with
  // no error anywhere, so nonsense has to come back as the previous value.
  for (const bad of ['', '   ', 'abc', 'mm', '--5', 'NaN', 'Infinity', '1e400']) {
    assert.equal(parseFocalLength(bad, 35), 35, `accepted ${JSON.stringify(bad)}`);
  }
});
