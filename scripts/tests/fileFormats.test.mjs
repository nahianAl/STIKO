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
  formatTables,
  sldprtConversionEnabled,
  CAD_CONVERSION_FORMATS,
  ENABLED_CAD_FORMATS,
  enabledCadFormats,
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
    '3dm', '3ds', '3mf', 'brep', 'dae', 'fbx', 'glb', 'gltf', 'iges', 'igs', 'obj', 'ply', 'sldprt', 'step', 'stl', 'stp',
  ]);
});

test('every model format is also a supported upload', () => {
  for (const ext of MODEL_FORMATS) assert.equal(SUPPORTED_EXTENSIONS.has(ext), true, ext);
});

test('native CAD files get the advice row the spec fixed', () => {
  const cases = {
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
    'a.sat': ['ACIS', 'Export STEP from your CAD tool, then upload.'],
  };
  for (const [name, [app, advice]] of Object.entries(cases)) {
    assert.deepEqual(adviceFor(name), { app, advice }, name);
  }
  assert.equal(Object.keys(NATIVE_CAD_ADVICE).length, Object.keys(cases).length);
});

test('advice matching ignores case', () => {
  assert.equal(adviceFor('ASM.SLDASM')?.app, 'SolidWorks');
});

test('supported, unknown and extensionless files get no advice', () => {
  assert.equal(adviceFor('model.glb'), null);
  assert.equal(adviceFor('model.fbx'), null);
  assert.equal(adviceFor('notes.txt'), null);
  assert.equal(adviceFor('README'), null);
  // Inherited Object.prototype keys must not resolve as advice.
  assert.equal(adviceFor('a.constructor'), null);
  assert.equal(adviceFor('a.__proto__'), null);
  assert.equal(adviceFor('a.tostring'), null);
});

test('no advised extension is a supported upload', () => {
  // Advice is only ever shown for a refused file. An extension in both tables would mean a
  // file that uploads fine but whose advice can never be seen, or a silent contradiction.
  for (const ext of Object.keys(NATIVE_CAD_ADVICE)) {
    assert.equal(SUPPORTED_EXTENSIONS.has(ext), false, ext);
  }
});

test('the SolidWorks switch is on unless explicitly off', () => {
  assert.equal(sldprtConversionEnabled(undefined), true);
  assert.equal(sldprtConversionEnabled('on'), true);
  assert.equal(sldprtConversionEnabled(' OFF '), false);
  assert.equal(sldprtConversionEnabled('off'), false);
});

test('formatTables moves each enabled format from the advice table to the model list', () => {
  const none = formatTables([]);
  const some = formatTables(['sldprt', 'ipt', 'prt']);
  assert.equal(none.model.includes('sldprt'), false);
  assert.deepEqual(none.advice.sldprt, { app: 'SolidWorks', advice: 'Save As STEP, then upload.' });
  for (const ext of ['sldprt', 'ipt', 'prt']) {
    assert.equal(some.model.includes(ext), true, ext);
    assert.equal(ext in some.advice, false, ext);
  }
  // A disabled format with an existing advice row keeps that row, not the table's.
  assert.deepEqual(some.advice.catpart, { app: 'CATIA', advice: 'Export STEP, then upload.' });
  assert.deepEqual(none.advice.prt, { app: 'NX / Creo / Solid Edge', advice: 'Export STEP, then upload.' });
  // Assemblies and Solid Edge keep their advice whatever is enabled.
  for (const ext of ['sldasm', 'iam', 'asm', 'par', 'psm']) assert.equal(ext in some.advice, true, ext);
});

test('formatTables keeps the model list and the advice table disjoint for every format', () => {
  const all = Object.keys(CAD_CONVERSION_FORMATS);
  for (const enabled of [[], all, ['jt'], ['x_t', 'sat']]) {
    const t = formatTables(enabled);
    for (const ext of t.model) assert.equal(ext in t.advice, false, `${enabled}: ${ext}`);
    for (const ext of all) assert.equal(t.model.includes(ext) || ext in t.advice, true, `${enabled}: ${ext} vanished`);
  }
});

test('the converted-format table is exactly the agreed formats, each with a name, noun and advice', () => {
  assert.deepEqual(Object.keys(CAD_CONVERSION_FORMATS).sort(), ['catpart', 'ipt', 'jt', 'prt', 'sat', 'sldasm', 'sldprt', 'x_b', 'x_t']);
  assert.deepEqual(CAD_CONVERSION_FORMATS.prt, { app: 'NX or Creo', noun: 'part', advice: 'Export STEP, then upload.' });
  assert.deepEqual(CAD_CONVERSION_FORMATS.jt, { app: 'JT', noun: 'model', advice: 'Export STEP from your CAD tool, then upload.' });
  for (const f of Object.values(CAD_CONVERSION_FORMATS)) {
    assert.ok(f.app && f.advice && (f.noun === 'part' || f.noun === 'model' || f.noun === 'assembly'));
  }
  assert.deepEqual(CAD_CONVERSION_FORMATS.sldasm, { app: 'SolidWorks', noun: 'assembly', advice: 'Save As STEP, then upload.' });
});

test('enabledCadFormats: unset or blank falls back to the SolidWorks switch', () => {
  assert.deepEqual(enabledCadFormats(undefined, undefined), ['sldprt']);
  assert.deepEqual(enabledCadFormats('   ', 'on'), ['sldprt']);
  assert.deepEqual(enabledCadFormats('', 'off'), []);
});

test('enabledCadFormats: off, lists, case, spaces, duplicates and unknown names', () => {
  assert.deepEqual(enabledCadFormats('off', undefined), []);
  assert.deepEqual(enabledCadFormats(' OFF ', 'on'), []);
  assert.deepEqual(enabledCadFormats('sldprt,ipt', 'off'), ['sldprt', 'ipt']);
  assert.deepEqual(enabledCadFormats(' JT , x_t,, ', undefined), ['jt', 'x_t']);
  assert.deepEqual(enabledCadFormats('ipt,ipt', undefined), ['ipt']);
  assert.deepEqual(enabledCadFormats('rvt,constructor,__proto__,ipt', undefined), ['ipt']);
});

test('enabledCadFormats: commas, semicolons, pipes and whitespace all separate names', () => {
  assert.deepEqual(enabledCadFormats('Sldprt; ipt', undefined), ['sldprt', 'ipt']);
  assert.deepEqual(enabledCadFormats('sldprt ipt', undefined), ['sldprt', 'ipt']);
  assert.deepEqual(enabledCadFormats('sldprt|ipt', undefined), ['sldprt', 'ipt']);
  assert.deepEqual(enabledCadFormats('sldprt,\n ipt;jt | x_t', undefined), ['sldprt', 'ipt', 'jt', 'x_t']);
});

function captureWarnings(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => calls.push(args);
  try {
    return { result: fn(), calls };
  } finally {
    console.warn = original;
  }
}

test('enabledCadFormats: a value with no known format warns and falls back to the legacy switch', () => {
  const on = captureWarnings(() => enabledCadFormats('solidworks', undefined));
  assert.deepEqual(on.result, ['sldprt']);
  assert.equal(on.calls.length, 1);
  assert.match(String(on.calls[0][0]), /solidworks/);
  assert.match(String(on.calls[0][0]), /SolidWorks/);

  const off = captureWarnings(() => enabledCadFormats('solidworks', 'off'));
  assert.deepEqual(off.result, []);
  assert.equal(off.calls.length, 1);
});

test('enabledCadFormats: no warning for unset, blank, off or any known format', () => {
  const { calls } = captureWarnings(() => {
    enabledCadFormats(undefined, undefined);
    enabledCadFormats('   ', 'off');
    enabledCadFormats('off', undefined);
    enabledCadFormats('sldprt,rvt', undefined);
    enabledCadFormats('ipt', 'off');
  });
  assert.equal(calls.length, 0);
});

test('with the env unset the enabled list is the legacy SolidWorks one', () => {
  assert.deepEqual([...ENABLED_CAD_FORMATS], ['sldprt']);
});

test("Creo's version suffix is read as the real extension", () => {
  assert.equal(extensionOf('bracket.prt.5'), 'prt');
  assert.equal(extensionOf('BRACKET.PRT.12'), 'prt');
  assert.equal(extensionOf('top.asm.3'), 'asm');
  assert.equal(extensionOf('sheet.drw.1'), 'drw');
  assert.equal(extensionOf('Rev1.2/bracket.prt.5'), 'prt');
  // Anything else keeps the plain last-segment rule.
  assert.equal(extensionOf('notes.5'), '5');
  assert.equal(extensionOf('.prt.5'), '5');
  assert.equal(extensionOf('a.step.5'), '5');
  assert.equal(extensionOf('a.prt.x'), 'x');
});
