import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldPrepareVariant,
  MAX_OPTIMIZE_BYTES,
  MAX_STEP_BYTES,
} from '../../lib/model/runOptimize.ts';

const MB = 1024 * 1024;

test('the two size caps are independent and correctly sized', () => {
  // They describe different things. MAX_OPTIMIZE_BYTES exists because the gltf-transform
  // chain peaks near 24x the input in memory. OCCT does not — the reference file peaked
  // near 60 MB on a 13.7 MB input. Its real guard is the timeout, because tessellation
  // cost tracks surface complexity, not byte count.
  assert.equal(MAX_OPTIMIZE_BYTES, 100 * MB);
  assert.equal(MAX_STEP_BYTES, 50 * MB);
});

test('each format is judged against its own cap', () => {
  assert.equal(shouldPrepareVariant('m.glb', 90 * MB), true);
  assert.equal(shouldPrepareVariant('m.glb', 110 * MB), false);
  assert.equal(shouldPrepareVariant('m.stp', 40 * MB), true);
  // A 60 MB STEP is under the GLB cap but over its own. Sharing one cap would let it through.
  assert.equal(shouldPrepareVariant('m.stp', 60 * MB), false);
  assert.equal(shouldPrepareVariant('m.step', 40 * MB), true);
});

test('formats with no converter never claim a variant', () => {
  for (const name of ['m.obj', 'm.stl', 'm.gltf', 'm.pdf', 'notes.txt']) {
    assert.equal(shouldPrepareVariant(name, 1 * MB), false, name);
  }
});

test('the reference file is comfortably inside the STEP cap', () => {
  // 13,748,500 bytes. If a future edit tightens MAX_STEP_BYTES below this, the file that
  // motivated this whole change stops being converted.
  assert.equal(shouldPrepareVariant('Clamp 9inch reach.stp', 13_748_500), true);
});
