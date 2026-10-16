import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  optimizedVariantKey,
  isOptimizableFilename,
  isTessellatableFilename,
  occtFormatOf,
  producesViewerVariant,
  TESSELLATABLE_EXTENSIONS,
  uploadStorageKey,
  isAllowedCommentKey,
  drawingPdfKey,
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
  // The basename here is deliberately extensionless. A naive whole-string
  // lastIndexOf('.') implementation would find the dot in "my.project" or "po.1" and treat
  // everything after it as the "extension" to strip — with an extension of its own on the
  // basename, that bug would produce the same output as the correct last-segment-only
  // implementation and this test would pass either way.
  assert.equal(
    optimizedVariantKey('uploads/my.project/po.1/v/abc-123'),
    'uploads/my.project/po.1/v/abc-123.optimized.glb'
  );
});

test('deriving from an already-optimized key is idempotent', () => {
  // Guards against `.optimized.optimized.glb` if the helper is ever applied twice.
  const once = optimizedVariantKey('uploads/p/po/v/abc-123.glb');
  assert.equal(optimizedVariantKey(once), once);
});

test('only glb is optimizable', () => {
  // .gltf is deliberately excluded: optimizeGlb uses WebIO.readBinary, which only parses
  // binary GLB. A JSON .gltf throws "Invalid glTF 2.0 binary." there every time, so
  // advertising it as optimizable would only waste a presign, a full read and a worker spawn
  // before falling back to the original.
  for (const name of ['m.glb', 'M.GLB', 'a.b.glb']) {
    assert.equal(isOptimizableFilename(name), true, name);
  }
  for (const name of ['m.gltf', 'm.step', 'm.obj', 'm.stl', 'm.pdf', 'noext', '.glb']) {
    assert.equal(isOptimizableFilename(name), false, name);
  }
});

test('STEP files are tessellatable but not optimizable', () => {
  // Two distinct predicates on purpose. isOptimizableFilename gates the gltf-transform
  // chain, which can only read binary GLB; isTessellatableFilename gates OCCT. Collapsing
  // them into one would send a .stp into WebIO.readBinary and throw on every upload.
  for (const name of ['clamp.stp', 'clamp.step', 'CLAMP.STP', 'a.b.step']) {
    assert.equal(isTessellatableFilename(name), true, name);
    assert.equal(isOptimizableFilename(name), false, name);
  }
});

test('producesViewerVariant covers both families and nothing else', () => {
  for (const name of ['m.glb', 'm.stp', 'm.step', 'M.GLB', 'M.STP', 'm.igs', 'm.iges', 'm.brep']) {
    assert.equal(producesViewerVariant(name), true, name);
  }
  // .gltf is excluded for the reason documented on OPTIMIZABLE_EXTENSIONS; the rest have
  // no converter at all. The upload route only presigns variants for GLB (the 2026-09-03 kill
  // switch), so an OCCT format reaching `true` here still never enters the 'optimizing' state.
  for (const name of ['m.gltf', 'm.obj', 'm.stl', 'm.pdf', 'm.png', 'm.fbx', 'm.3dm', 'noext', '.stp']) {
    assert.equal(producesViewerVariant(name), false, name);
  }
});

test('the tessellatable set is the OCCT family: STEP, IGES and BREP', () => {
  assert.deepEqual([...TESSELLATABLE_EXTENSIONS].sort(), ['brep', 'iges', 'igs', 'step', 'stp']);
});

test('occtFormatOf maps each OCCT extension to its reader and everything else to null', () => {
  assert.equal(occtFormatOf('a.stp'), 'step');
  assert.equal(occtFormatOf('a.STEP'), 'step');
  assert.equal(occtFormatOf('a.igs'), 'iges');
  assert.equal(occtFormatOf('a.IGES'), 'iges');
  assert.equal(occtFormatOf('a.brep'), 'brep');
  assert.equal(occtFormatOf('a.glb'), null);
  assert.equal(occtFormatOf('noext'), null);
  // URL pathnames reach this from STEPLoader; only the last segment counts.
  assert.equal(occtFormatOf('/uploads/p.1/x/abc.igs'), 'iges');
  assert.equal(occtFormatOf('a.constructor'), null);
  assert.equal(occtFormatOf('a.__proto__'), null);
});

test('a .stp original yields a .optimized.glb variant', () => {
  // The suffix is reused deliberately: one variant key scheme, not two. The converted
  // STEP really is the object the viewer prefers, which is what the suffix means.
  assert.equal(
    optimizedVariantKey('uploads/p/po/v/abc-123.stp'),
    'uploads/p/po/v/abc-123.optimized.glb'
  );
});

// The forged-key hole: /api/files/complete accepted any storage key, and this
// branch made deletion act on those keys. These assert the shape of what a
// caller may claim, so the routes only have to compare.

test('an upload key is fully determined by its ids and extension', () => {
  assert.equal(
    uploadStorageKey({
      projectId: 'p1', portalId: 'k1', versionId: 'v1',
      fileId: 'f1', filename: 'bracket.step',
    }),
    'uploads/p1/k1/v1/f1.step'
  );
});

test('an upload key for an extensionless filename has no trailing dot', () => {
  assert.equal(
    uploadStorageKey({
      projectId: 'p1', portalId: 'k1', versionId: 'v1',
      fileId: 'f1', filename: 'README',
    }),
    'uploads/p1/k1/v1/f1'
  );
});

test('a comment may name a snapshot or an attachment', () => {
  assert.equal(isAllowedCommentKey('snapshots/abc.jpg'), true);
  assert.equal(isAllowedCommentKey('comment-attachments/abc.pdf'), true);
});

test('a comment may name an external URL or an inline data URI', () => {
  // Neither is a stored object, so neither can be deleted by naming it.
  assert.equal(isAllowedCommentKey('https://example.com/x.png'), true);
  assert.equal(isAllowedCommentKey('data:image/png;base64,AAAA'), true);
});

test('a comment may NOT name an upload key', () => {
  // The whole exploit: a commenter naming a victim's file object, which
  // deletion would then destroy.
  assert.equal(isAllowedCommentKey('uploads/p1/k1/v1/f1.step'), false);
});

test('a comment may not name an arbitrary key', () => {
  assert.equal(isAllowedCommentKey('anything/else'), false);
  assert.equal(isAllowedCommentKey(''), false);
});

test('a drawing PDF sits beside its original with a .drawing.pdf suffix', () => {
  assert.equal(drawingPdfKey('uploads/p/po/v/abc-123.dwg'), 'uploads/p/po/v/abc-123.drawing.pdf');
  assert.equal(drawingPdfKey('uploads/p/po/v/abc-123.DXF'), 'uploads/p/po/v/abc-123.drawing.pdf');
  assert.equal(drawingPdfKey('uploads/p.1/po/v/abc-123'), 'uploads/p.1/po/v/abc-123.drawing.pdf');
});
