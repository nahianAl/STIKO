import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  optimizedVariantKey,
  isOptimizableFilename,
} from '../../lib/storageKeys.ts';

test('the variant key replaces the extension of the last segment', () => {
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.glb'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('a .gltf original still yields a .glb variant', () => {
  // The optimizer always writes binary GLB, whatever the input was.
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.gltf'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('an original with no extension still gets one', () => {
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('a dot in the directory prefix is not mistaken for the extension', () => {
  assert.equal(
    optimizedVariantKey('uploads/my.project/po.1/v/abc-123.glb'),
    'uploads/my.project/po.1/v/abc-123.optimized.glb'
  );
});

test('deriving from an already-optimized key is idempotent', () => {
  // Guards against `.optimized.optimized.glb` if the helper is ever applied twice.
  const once = optimizedVariantKey('uploads/p/po/v/abc-123.glb');
  assert.equal(optimizedVariantKey(once), once);
});

test('only glb and gltf are optimizable', () => {
  for (const name of ['m.glb', 'm.gltf', 'M.GLB', 'a.b.glb']) {
    assert.equal(isOptimizableFilename(name), true, name);
  }
  for (const name of ['m.step', 'm.obj', 'm.stl', 'm.pdf', 'noext', '.glb']) {
    assert.equal(isOptimizableFilename(name), false, name);
  }
});
