import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizedVariantKey } from '../../lib/storageKeys.ts';

test('a .glb key becomes an .optimized.glb key alongside it', () => {
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.glb'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('a .gltf key becomes .optimized.glb, not .optimized.gltf', () => {
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.gltf'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('a key with no extension still gets .optimized.glb appended', () => {
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

test('a dot in the directory prefix is ignored — only the last segment is examined', () => {
  assert.equal(
    optimizedVariantKey('uploads/acme.corp/po/v/abc-123.glb'),
    'uploads/acme.corp/po/v/abc-123.optimized.glb'
  );
});

test('feeding an already-optimized key back in does not double the suffix', () => {
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.optimized.glb'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});
