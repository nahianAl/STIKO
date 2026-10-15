import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_EXTENSIONS,
  MODEL_FORMATS,
  NATIVE_CAD_ADVICE,
  adviceFor,
  extensionOf,
  isSupportedFilename,
  partitionBySupport,
  ACCEPT_ATTRIBUTE,
} from '../../lib/fileFormats.ts';

// Mirrors the branches in components/viewers/ViewerContainer.tsx. Stated
// literally rather than imported so that quietly deleting a viewer branch
// breaks this test instead of silently narrowing the whitelist.
const VIEWABLE = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'pdf',
  'glb', 'gltf', 'obj', 'stl', '3ds', 'ply', 'dae', 'step', 'stp',
  'fbx', '3mf', '3dm', 'igs', 'iges', 'brep',
];

test('every format the viewer can actually render is accepted', () => {
  for (const ext of VIEWABLE) {
    assert.equal(isSupportedFilename(`drawing.${ext}`), true, `.${ext}`);
  }
});

test('dwg and dxf are accepted even though nothing renders them yet', () => {
  // A decision, not an oversight: the import pipeline lands next, and gating
  // them now would mean unpicking the gate then. They upload and download;
  // the viewport shows its unsupported-type message.
  assert.equal(isSupportedFilename('plan.dwg'), true);
  assert.equal(isSupportedFilename('plan.dxf'), true);
});

test('extension matching ignores case', () => {
  assert.equal(isSupportedFilename('DRAWING.PDF'), true);
  assert.equal(isSupportedFilename('Model.GLB'), true);
});

test('office and archive formats are rejected', () => {
  for (const name of ['spec.docx', 'costs.xlsx', 'deck.pptx', 'bundle.zip', 'notes.txt']) {
    assert.equal(isSupportedFilename(name), false, name);
  }
});

test('a file with no extension is rejected', () => {
  assert.equal(extensionOf('README'), '');
  assert.equal(isSupportedFilename('README'), false);
});

test('a dotfile has no extension and is rejected', () => {
  // '.DS_Store' is a hidden file, not a file of type DS_Store. macOS puts one
  // in every folder, so a dropped folder hits this on the very first try.
  assert.equal(extensionOf('.DS_Store'), '');
  assert.equal(isSupportedFilename('.DS_Store'), false);
});

test('a double extension is judged on its last segment', () => {
  assert.equal(extensionOf('archive.tar.gz'), 'gz');
  assert.equal(isSupportedFilename('archive.tar.gz'), false);
  assert.equal(isSupportedFilename('model.final.glb'), true);
});

test('a dot in a folder name is not mistaken for an extension', () => {
  // FileDropzone carries paths like "Rev1.2/sheet", and lastIndexOf('.') over
  // the whole path would read the extension as "2/sheet".
  assert.equal(extensionOf('Rev1.2/sheet'), '');
  assert.equal(extensionOf('Rev1.2/sheet.pdf'), 'pdf');
});

test('partitionBySupport splits without losing or reordering anything', () => {
  const files = [
    { name: 'a.pdf' },
    { name: 'b.docx' },
    { name: 'c.glb' },
    { name: 'd.zip' },
    { name: 'e.png' },
  ];
  const { accepted, rejected } = partitionBySupport(files, (f) => f.name);

  assert.deepEqual(accepted.map((f) => f.name), ['a.pdf', 'c.glb', 'e.png']);
  assert.deepEqual(rejected.map((f) => f.name), ['b.docx', 'd.zip']);
  assert.equal(accepted.length + rejected.length, files.length);
});

test('partitionBySupport handles the all-accepted and all-rejected cases', () => {
  const ok = partitionBySupport([{ name: 'a.pdf' }], (f) => f.name);
  assert.deepEqual(ok.rejected, []);

  const bad = partitionBySupport([{ name: 'a.docx' }], (f) => f.name);
  assert.deepEqual(bad.accepted, []);
});

test('the accept attribute lists every supported extension, dotted', () => {
  const parts = ACCEPT_ATTRIBUTE.split(',');
  assert.equal(parts.length, SUPPORTED_EXTENSIONS.size);
  for (const part of parts) {
    assert.match(part, /^\.[a-z0-9]+$/);
    assert.equal(SUPPORTED_EXTENSIONS.has(part.slice(1)), true, part);
  }
});

test('the model list is exactly the formats the 3D viewer opens', () => {
  assert.deepEqual([...MODEL_FORMATS].sort(), [
    '3dm', '3ds', '3mf', 'brep', 'dae', 'fbx', 'glb', 'gltf', 'iges', 'igs', 'obj', 'ply', 'step', 'stl', 'stp',
  ]);
});

test('every model format is also a supported upload', () => {
  for (const ext of MODEL_FORMATS) assert.equal(SUPPORTED_EXTENSIONS.has(ext), true, ext);
});

test('native CAD files get the advice row the spec fixed', () => {
  const cases = {
    'part.sldprt': ['SolidWorks', 'Save As STEP, then upload.'],
    'asm.sldasm': ['SolidWorks', 'Save As STEP, then upload.'],
    'a.ipt': ['Inventor', 'Export STEP, then upload.'],
    'a.iam': ['Inventor', 'Export STEP, then upload.'],
    'a.f3d': ['Fusion', 'Export STEP, then upload.'],
    'a.catpart': ['CATIA', 'Export STEP, then upload.'],
    'a.catproduct': ['CATIA', 'Export STEP, then upload.'],
    'a.prt': ['NX / Creo / Solid Edge', 'Export STEP, then upload.'],
    'a.asm': ['NX / Creo / Solid Edge', 'Export STEP, then upload.'],
    'a.par': ['Solid Edge', 'Export STEP, then upload.'],
    'a.psm': ['Solid Edge', 'Export STEP, then upload.'],
    'a.x_t': ['Parasolid', 'Export STEP from your CAD tool, then upload.'],
    'a.x_b': ['Parasolid', 'Export STEP from your CAD tool, then upload.'],
    'a.jt': ['JT', 'Export STEP from your CAD tool, then upload.'],
    'a.rvt': ['Revit', 'Export FBX from a 3D view, then upload.'],
    'a.skp': ['SketchUp', 'Export FBX or OBJ, then upload.'],
    'a.pln': ['ArchiCAD', 'Export OBJ, then upload.'],
    'a.vwx': ['Vectorworks', 'Export FBX or OBJ, then upload.'],
    'a.ifc': ['IFC', "IFC isn't supported yet. Export FBX or OBJ from your BIM tool."],
    'a.c4d': ['Cinema 4D', 'Export FBX or GLB, then upload.'],
    'a.ma': ['Maya', 'Export FBX or GLB, then upload.'],
    'a.mb': ['Maya', 'Export FBX or GLB, then upload.'],
    'a.blend': ['Blender', 'Export GLB, then upload.'],
    'a.max': ['3ds Max', 'Export FBX, then upload.'],
    'a.usdz': ['USD', 'Export GLB, then upload.'],
    'a.usd': ['USD', 'Export GLB, then upload.'],
    'a.usda': ['USD', 'Export GLB, then upload.'],
    'a.usdc': ['USD', 'Export GLB, then upload.'],
  };
  for (const [name, [app, advice]] of Object.entries(cases)) {
    assert.deepEqual(adviceFor(name), { app, advice }, name);
  }
  assert.equal(Object.keys(NATIVE_CAD_ADVICE).length, Object.keys(cases).length);
});

test('advice matching ignores case', () => {
  assert.equal(adviceFor('PART.SLDPRT')?.app, 'SolidWorks');
});

test('supported, unknown and extensionless files get no advice', () => {
  assert.equal(adviceFor('model.glb'), null);
  assert.equal(adviceFor('model.fbx'), null);
  assert.equal(adviceFor('notes.txt'), null);
  assert.equal(adviceFor('README'), null);
});

test('no advised extension is a supported upload', () => {
  // Advice is only ever shown for a refused file. An extension in both tables would mean a
  // file that uploads fine but whose advice can never be seen, or a silent contradiction.
  for (const ext of Object.keys(NATIVE_CAD_ADVICE)) {
    assert.equal(SUPPORTED_EXTENSIONS.has(ext), false, ext);
  }
});
