// The type chips and the portal file icon read a file's extension. Creo saves each version as
// name.prt.<n>, and the last dot-segment of that is the version number, not the format: the chip
// said "5" and the file got the generic icon. Both now go through extensionOf (lib/fileFormats.ts),
// and every other name must read exactly as it did before: the last dot-segment, with the
// fallbacks each function already had for names without an extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFileChip } from '../../lib/fileChips.ts';
import { fileChip } from '../../lib/design.ts';

// With the CAD env unset .prt is not a model format, so these chips are the grey fallback; what
// matters here is the label.
test("getFileChip reads a Creo version file's extension as prt, not its version number", () => {
  assert.equal(getFileChip('bracket.prt.5', '').label, 'PRT');
  assert.equal(getFileChip('bracket.prt.5', '').label, getFileChip('bracket.prt', '').label);
  assert.equal(getFileChip('top.asm.12', '').label, 'ASM');
  assert.equal(getFileChip('Rev1.2/BRACKET.PRT.3', '').label, 'PRT');
});

test("fileChip (design.ts) reads a Creo version file's extension as prt, not its version number", () => {
  assert.equal(fileChip('bracket.prt.5').label, 'PRT');
  assert.equal(fileChip('bracket.prt.5').label, fileChip('bracket.prt').label);
  assert.equal(fileChip('top.asm.12').label, 'ASM');
  assert.equal(fileChip('Rev1.2/BRACKET.PRT.3').label, 'PRT');
});

test('getFileChip keeps its labels for every other kind of name', () => {
  assert.equal(getFileChip('archive.tar.gz', '').label, 'GZ');
  assert.equal(getFileChip('model.final.glb', '').label, 'GLB');
  assert.equal(getFileChip('plan.dwg', '').label, 'DWG');
  assert.equal(getFileChip('L3.PDF', '').label, 'PDF');
  assert.equal(getFileChip('notes.longname', '').label, 'LONG');
  // No extension, and dotfiles: the whole name stands in, truncated, exactly as before.
  assert.equal(getFileChip('README', '').label, 'READ');
  assert.equal(getFileChip('.DS_Store', '').label, 'DS_S');
  assert.equal(getFileChip('', '').label, 'FILE');
  // A type from the browser still wins over the name.
  assert.equal(getFileChip('scan', 'image/png').label, 'IMG');
});

test('fileChip (design.ts) keeps its labels for every other kind of name', () => {
  assert.equal(fileChip('archive.tar.gz').label, 'GZ');
  assert.equal(fileChip('model.final.glb').label, 'GLB');
  assert.equal(fileChip('notes.longname').label, 'FILE');
  assert.equal(fileChip('README').label, 'FILE');
  assert.equal(fileChip('.DS_Store').label, 'FILE');
  assert.equal(fileChip('Rev1.2/sheet').label, 'FILE');
});
