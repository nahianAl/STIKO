# More 3D Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Stiko open FBX, 3MF, Rhino 3DM, IGES and BREP files in the 3D viewer. Refuse native CAD files with specific export advice, and count every refused extension.

**Architecture:** Everything opens in the viewer, never at upload; upload-time conversion is kill-switched (see `app/api/files/upload/route.ts`).
- **FBX, 3MF and 3DM** use three.js loaders on open, as OBJ and DAE do today.
- **IGES and BREP** reuse the STEP pipeline. `STEPLoader` hands off to `runStepConvert`, which hands off to `stepWorker`, which hands off to `stepToGlb`; each layer gains a `format` argument and the OCCT reader is chosen by format.
- **Refused uploads** show advice from a table in `lib/fileFormats.ts`. The drop zone reports their extensions to a new route, which upserts counts into a new `rejected_uploads` table.

**Tech Stack:** Next.js 14 App Router, TypeScript, three.js 0.169 (`FBXLoader`, `ThreeMFLoader`, `Rhino3dmLoader`), occt-import-js 0.0.23, Neon Postgres, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-15-more-3d-formats-design.md`

## Global Constraints

- Budget: $0 running cost. No new paid service and no new npm dependency. rhino3dm comes from three's bundled copy at `node_modules/three/examples/jsm/libs/rhino3dm/`.
- Upload-time conversion stays OFF. Do not touch the kill switch in `app/api/files/upload/route.ts`.
- `STEP_TESSELLATION` values must not change: `bounding_box_ratio` / `0.03` / `0.5`.
- Brand: the product name is written `stiko` (lowercase) in all user-visible text.
- Any `lib/` module reached by a `node --test` file uses relative `.ts`-extensioned imports (no `@/` alias), and type-only imports from `lib/queries` use `import type`.
- Never `git add -A` or `git add .` here. Three long-lived untracked handoff directories get swept in. Always add explicit paths.
- After every task, run `npx tsc --noEmit` as well as the tests. `npm test` and `npm run lint` do not catch iteration-target errors.
- Work on branch `feature/more-3d-formats`, created from `main`.
- Refused-upload counts store the extension only, never filenames.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
cd /Users/user/Desktop/STIKO-main
git checkout -b feature/more-3d-formats
```

Expected: `Switched to a new branch 'feature/more-3d-formats'`

---

### Task 1: Format list and native-CAD advice in `lib/fileFormats.ts`

**Files:**
- Modify: `lib/fileFormats.ts`
- Test: `scripts/tests/fileFormats.test.mjs`

**Interfaces:**
- Produces:
  - `MODEL_FORMATS: readonly string[]` (undotted, lowercase)
  - `interface FormatAdvice { app: string; advice: string }`
  - `NATIVE_CAD_ADVICE: Readonly<Record<string, FormatAdvice>>`
  - `adviceFor(filename: string): FormatAdvice | null`

- [ ] **Step 1: Write the failing tests**

In `scripts/tests/fileFormats.test.mjs`, extend the import and the `VIEWABLE` list, then append the new tests.

Replace the import block with:

```js
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
```

Replace the `VIEWABLE` constant with:

```js
const VIEWABLE = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'pdf',
  'glb', 'gltf', 'obj', 'stl', '3ds', 'ply', 'dae', 'step', 'stp',
  'fbx', '3mf', '3dm', 'igs', 'iges', 'brep',
];
```

Append:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/tests/fileFormats.test.mjs`
Expected: FAIL. The import of `MODEL_FORMATS` fails with "does not provide an export named".

- [ ] **Step 3: Implement**

In `lib/fileFormats.ts`, replace the `MODEL` line with:

```ts
const MODEL = [
  'glb', 'gltf', 'obj', 'stl', '3ds', 'ply', 'dae', 'step', 'stp',
  'fbx', '3mf', '3dm', 'igs', 'iges', 'brep',
];

/**
 * The formats the 3D viewer opens, undotted. ViewerContainer and the portal page derive
 * their checks from this rather than keeping their own copies — there used to be three.
 */
export const MODEL_FORMATS: readonly string[] = MODEL;
```

Append to the end of `lib/fileFormats.ts`:

```ts
export interface FormatAdvice {
  /** The application the file came from, as a reader would name it. */
  app: string;
  /** One sentence telling them what to export instead. */
  advice: string;
}

const EXPORT_STEP = 'Export STEP, then upload.';
const EXPORT_STEP_FROM_TOOL = 'Export STEP from your CAD tool, then upload.';
const EXPORT_FBX_OR_GLB = 'Export FBX or GLB, then upload.';
const EXPORT_GLB = 'Export GLB, then upload.';

/**
 * Native formats nothing free can read. A file with one of these extensions is refused
 * like any other unsupported file, but the refusal says what to do instead of just "no".
 * Disjoint from SUPPORTED_EXTENSIONS by test.
 */
export const NATIVE_CAD_ADVICE: Readonly<Record<string, FormatAdvice>> = {
  sldprt: { app: 'SolidWorks', advice: 'Save As STEP, then upload.' },
  sldasm: { app: 'SolidWorks', advice: 'Save As STEP, then upload.' },
  ipt: { app: 'Inventor', advice: EXPORT_STEP },
  iam: { app: 'Inventor', advice: EXPORT_STEP },
  f3d: { app: 'Fusion', advice: EXPORT_STEP },
  catpart: { app: 'CATIA', advice: EXPORT_STEP },
  catproduct: { app: 'CATIA', advice: EXPORT_STEP },
  prt: { app: 'NX / Creo / Solid Edge', advice: EXPORT_STEP },
  asm: { app: 'NX / Creo / Solid Edge', advice: EXPORT_STEP },
  par: { app: 'Solid Edge', advice: EXPORT_STEP },
  psm: { app: 'Solid Edge', advice: EXPORT_STEP },
  x_t: { app: 'Parasolid', advice: EXPORT_STEP_FROM_TOOL },
  x_b: { app: 'Parasolid', advice: EXPORT_STEP_FROM_TOOL },
  jt: { app: 'JT', advice: EXPORT_STEP_FROM_TOOL },
  rvt: { app: 'Revit', advice: 'Export FBX from a 3D view, then upload.' },
  skp: { app: 'SketchUp', advice: 'Export FBX or OBJ, then upload.' },
  pln: { app: 'ArchiCAD', advice: 'Export OBJ, then upload.' },
  vwx: { app: 'Vectorworks', advice: 'Export FBX or OBJ, then upload.' },
  ifc: { app: 'IFC', advice: "IFC isn't supported yet. Export FBX or OBJ from your BIM tool." },
  c4d: { app: 'Cinema 4D', advice: EXPORT_FBX_OR_GLB },
  ma: { app: 'Maya', advice: EXPORT_FBX_OR_GLB },
  mb: { app: 'Maya', advice: EXPORT_FBX_OR_GLB },
  blend: { app: 'Blender', advice: EXPORT_GLB },
  max: { app: '3ds Max', advice: 'Export FBX, then upload.' },
  usdz: { app: 'USD', advice: EXPORT_GLB },
  usd: { app: 'USD', advice: EXPORT_GLB },
  usda: { app: 'USD', advice: EXPORT_GLB },
  usdc: { app: 'USD', advice: EXPORT_GLB },
};

/** The export advice for a refused file, or null when there is none to give. */
export function adviceFor(filename: string): FormatAdvice | null {
  return NATIVE_CAD_ADVICE[extensionOf(filename)] ?? null;
}
```

Also replace the comment block above `const CAD = ['dwg', 'dxf'];` (it says "createStepToGlbJob is STEP-only") with:

```ts
// DWG and DXF: accepted, no viewer yet. That work is in progress separately; they upload and
// download normally and the viewport shows its unsupported-type message.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/fileFormats.test.mjs && npx tsc --noEmit`
Expected: all tests PASS; tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/fileFormats.ts scripts/tests/fileFormats.test.mjs
git commit -m "feat(formats): accept FBX, 3MF, Rhino, IGES, BREP; export advice for native CAD"
```

---

### Task 2: Read IGES and BREP through OCCT

**Files:**
- Modify: `types/occt-import-js.d.ts`
- Modify: `lib/storageKeys.ts`
- Modify: `lib/model/stepToGlb.ts:70-104`
- Test: `scripts/tests/storageKeys.test.mjs`, `scripts/tests/stepToGlb.test.mjs`

**Interfaces:**
- Produces:
  - `type OcctFormat = 'step' | 'iges' | 'brep'` and `occtFormatOf(filename: string): OcctFormat | null`, both in `lib/storageKeys.ts`
  - `stepToGlb(bytes: Uint8Array, options?: { locateFile?: (path: string) => string; format?: OcctFormat }): Promise<Uint8Array>` (`format` defaults to `'step'`)

- [ ] **Step 1: Write the failing tests**

In `scripts/tests/storageKeys.test.mjs`:
- Add `occtFormatOf` to the import list.
- Replace the test `'the tessellatable set is exactly stp and step'` with the first test below.
- Replace the `producesViewerVariant` test with the second test below.
- Append the third test.

```js
test('the tessellatable set is the OCCT family: STEP, IGES and BREP', () => {
  assert.deepEqual([...TESSELLATABLE_EXTENSIONS].sort(), ['brep', 'iges', 'igs', 'step', 'stp']);
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
});
```

In `scripts/tests/stepToGlb.test.mjs`, append:

```js
const IGES_CUBE = 'node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.igs';
const BREP_ASSEMBLY = 'node_modules/occt-import-js/test/testfiles/cax-if-brep/as1_pe_203.brep';

test('an IGES file converts to a readable GLB with geometry', async () => {
  const glb = await stepToGlb(new Uint8Array(readFileSync(IGES_CUBE)), { locateFile, format: 'iges' });
  const doc = await new WebIO().readBinary(glb);
  assert.ok(doc.getRoot().listMeshes().length >= 1, 'expected at least one mesh');
});

test('a BREP file converts to a readable GLB with every solid', async () => {
  const glb = await stepToGlb(new Uint8Array(readFileSync(BREP_ASSEMBLY)), { locateFile, format: 'brep' });
  const doc = await new WebIO().readBinary(glb);
  // Measured during the 2026-10-15 spike: OCCT reads 18 meshes from this assembly.
  assert.ok(doc.getRoot().listMeshes().length >= 18, 'expected the assembly\'s solids');
});

test('an unreadable IGES file rejects instead of trying the STEP wireframe fallback', async () => {
  // The wireframe fallback parses STEP text. Feeding it IGES bytes would at best find
  // nothing and at worst invent geometry from coincidental tokens, so non-STEP formats
  // fail plainly.
  const junk = new TextEncoder().encode('not an iges file at all');
  await assert.rejects(
    () => stepToGlb(junk, { locateFile, format: 'iges' }),
    /IGES file could not be read/
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/tests/storageKeys.test.mjs scripts/tests/stepToGlb.test.mjs`
Expected: FAIL. `occtFormatOf` is not exported, and the IGES test fails because STEP's reader rejects IGES bytes.

- [ ] **Step 3: Implement**

In `types/occt-import-js.d.ts`, replace the `OcctImportJs` interface with:

```ts
  interface OcctImportJs {
    ReadStepFile: (buffer: Uint8Array, params: OcctImportParams | null) => OcctResult;
    ReadIgesFile: (buffer: Uint8Array, params: OcctImportParams | null) => OcctResult;
    /** linearUnit has no effect for BREP: the format carries no unit, per the README. */
    ReadBrepFile: (buffer: Uint8Array, params: OcctImportParams | null) => OcctResult;
  }
```

In `lib/storageKeys.ts`, replace the `TESSELLATABLE_EXTENSIONS` declaration and its doc comment with:

```ts
/**
 * Formats OCCT tessellates: STEP, IGES and BREP. A SEPARATE predicate from
 * isOptimizableFilename rather than more members of that set, because they go through OCCT,
 * not the gltf-transform chain. All of them produce the same `.optimized.glb` variant key,
 * because all produce the object the viewer should load instead of the original.
 */
export const TESSELLATABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'stp', 'step', 'igs', 'iges', 'brep',
]);

/** Which OCCT reader a tessellatable file needs. */
export type OcctFormat = 'step' | 'iges' | 'brep';

const OCCT_FORMAT_BY_EXTENSION: Readonly<Record<string, OcctFormat>> = {
  stp: 'step',
  step: 'step',
  igs: 'iges',
  iges: 'iges',
  brep: 'brep',
};

/**
 * The OCCT reader for a filename or URL pathname, or null when OCCT does not read it.
 * Callers that hold a URL must pass its pathname, never the full URL with a query string.
 */
export function occtFormatOf(filename: string): OcctFormat | null {
  return OCCT_FORMAT_BY_EXTENSION[extensionOf(filename)] ?? null;
}
```

In `lib/model/stepToGlb.ts`:
- Add `import type { OcctFormat } from '../storageKeys.ts';` below the existing imports.
- Replace the whole `stepToGlb` function (lines 70–104) with the code below.
- Update the module doc comment on line 7 to read `STEP, IGES and BREP → GLB, and the only module in the codebase that knows OpenCascade exists.`

```ts
export async function stepToGlb(
  bytes: Uint8Array,
  options: { locateFile?: (path: string) => string; format?: OcctFormat } = {}
): Promise<Uint8Array> {
  const occt = await initOcct(options.locateFile);
  const format = options.format ?? 'step';

  if (format !== 'step') {
    // IGES and BREP share STEP's tessellation settings and GLB building, but not its
    // wireframe fallback below: that parses STEP text, and has nothing to say about these.
    const result =
      format === 'iges'
        ? occt.ReadIgesFile(bytes, STEP_TESSELLATION)
        : occt.ReadBrepFile(bytes, STEP_TESSELLATION);
    if (result.success && result.meshes.length) return buildGlbDocument(result);
    const label = format === 'iges' ? 'IGES' : 'BREP';
    throw new Error(
      result.success
        ? `${label} file contained no displayable geometry`
        : `${label} file could not be read`
    );
  }

  const result = occt.ReadStepFile(bytes, STEP_TESSELLATION);
  if (result.success && result.meshes.length) {
    return buildGlbDocument(result);
  }

  // No triangles. OCCT only ever meshes faces (importer-xcaf.cpp walks TopAbs_FACE/SHELL/
  // SOLID and nothing else), so this is the expected result for a curve-only export —
  // Rhino's GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION, which is what a panel
  // layout or a toolpath arrives as. Measured on a 4.4 MB Rhino wireframe: ReadStepFile
  // returns success in 1.7 s with meshes: [], and every curve in the file is discarded.
  //
  // The fallback runs on the `!success` path too, deliberately. OCCT rejects outright some
  // files whose curve data is perfectly readable — a minimal hand-written wireframe among
  // them — and a file it could not parse is one this cannot make worse.
  const wireframe = extractWireframe(decodeStep(bytes));
  if (wireframe.polylines.length) {
    return buildWireframeDocument(wireframe);
  }

  if (!result.success) {
    throw new Error('STEP file could not be read');
  }

  // Parsed, but holding neither solids nor curves: a drawing-only, annotation-only or
  // reference-geometry export. Returning an empty GLB would show an empty viewport with no
  // explanation, so this is an error — and it names what was found so the console says
  // something truer than "too complex".
  throw new Error(`STEP file contained no displayable geometry${describeUnsupported(wireframe)}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/storageKeys.test.mjs scripts/tests/stepToGlb.test.mjs && npx tsc --noEmit`
Expected: all PASS; tsc silent.

If the junk-IGES test fails because OCCT reports `success: true` with no meshes, change only the test's regex to `/IGES file (could not be read|contained no displayable geometry)/`. Do not change the implementation.

- [ ] **Step 5: Commit**

```bash
git add types/occt-import-js.d.ts lib/storageKeys.ts lib/model/stepToGlb.ts scripts/tests/storageKeys.test.mjs scripts/tests/stepToGlb.test.mjs
git commit -m "feat(model): tessellate IGES and BREP through the STEP pipeline"
```

---

### Task 3: Carry the format through the worker and the loader

**Files:**
- Modify: `lib/model/stepWorker.ts`
- Modify: `lib/model/runStepConvert.ts` (the `runStepConvert` signature and the `postMessage` call)
- Modify: `lib/STEPLoader.ts`
- Modify: `lib/model/runOptimize.ts:97-108`
- Test: `scripts/tests/runStepConvert.test.mjs`

**Interfaces:**
- Consumes: `OcctFormat`, `occtFormatOf` from Task 2.
- Produces:
  - `runStepConvert(bytes: ArrayBuffer, options?: { format?: OcctFormat; createWorker?: () => ConvertWorker; timeoutMs?: number }): Promise<ArrayBuffer | null>`
  - The worker message is `{ bytes: ArrayBuffer; format: OcctFormat }`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tests/runStepConvert.test.mjs`:

```js
test('the worker is told which OCCT reader to use, and the bytes travel with it', async () => {
  let posted;
  const worker = {
    postMessage(message, transfer) {
      posted = { message, transfer };
      queueMicrotask(() => worker.onmessage({ data: { ok: true, buffer: new ArrayBuffer(1) } }));
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  };
  const bytes = new ArrayBuffer(8);
  await runStepConvert(bytes, { createWorker: () => worker, format: 'iges' });

  assert.equal(posted.message.format, 'iges');
  assert.equal(posted.message.bytes, bytes);
  assert.deepEqual(posted.transfer, [bytes], 'the bytes must be transferred, not copied');
});

test('the format defaults to STEP', async () => {
  let posted;
  const worker = {
    postMessage(message) {
      posted = message;
      queueMicrotask(() => worker.onmessage({ data: { ok: true, buffer: new ArrayBuffer(1) } }));
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  };
  await runStepConvert(new ArrayBuffer(8), { createWorker: () => worker });
  assert.equal(posted.format, 'step');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/runStepConvert.test.mjs`
Expected: the two new tests FAIL (`posted.message.format` is undefined, because the bytes are posted bare). The existing tests still pass.

- [ ] **Step 3: Implement**

In `lib/model/runStepConvert.ts`:
- Add `import type { OcctFormat } from '../storageKeys.ts';` at the top of the file. Use the `.ts` extension, because `scripts/tests/runStepConvert.test.mjs` imports this module under `node --test`.
- Change the options type to `options: { format?: OcctFormat; createWorker?: () => ConvertWorker; timeoutMs?: number } = {}`.
- Replace the `worker.postMessage(bytes, [bytes]);` line with:

```ts
      worker.postMessage({ bytes, format: options.format ?? 'step' }, [bytes]);
```

Keep the TAKES OWNERSHIP doc comment. It is still true, because `bytes` is in the transfer list.

Replace `lib/model/stepWorker.ts`'s `onmessage` handler with:

```ts
self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; format: OcctFormat }>) => {
  try {
    const { bytes, format } = event.data;
    const glb = await stepToGlb(new Uint8Array(bytes), { format });

    // Copy out of the WASM heap view into a standalone ArrayBuffer so it can be
    // transferred. glb.buffer may be the whole heap, and may be larger than glb.
    const buffer = glb.slice().buffer;
    self.postMessage({ ok: true, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
```

Add `import type { OcctFormat } from '../storageKeys';` below its existing import, and change "Worker entry for STEP tessellation" in its doc comment to "Worker entry for OCCT tessellation (STEP, IGES, BREP)".

In `lib/STEPLoader.ts`:
- Add `import { occtFormatOf } from './storageKeys';` with the other imports.
- Change the class doc's first line to "Loads a STEP, IGES or BREP file by tessellating it to GLB in a worker, then parsing that GLB."
- Replace the `runStepConvert` call with:

```ts
    // The presigned URL's pathname still ends in the original extension (uploadStorageKey
    // keeps it), so it names the reader. STEP is the default for anything unrecognised, which
    // is what this loader did before it knew other formats existed.
    const format = occtFormatOf(new URL(url, 'http://local').pathname) ?? 'step';
    const glb = await runStepConvert(bytes, { timeoutMs: STEP_VIEWER_TIMEOUT_MS, format });
```

In `lib/model/runOptimize.ts`, change the import from `'../storageKeys.ts'` to also bring in `occtFormatOf`. Then replace lines 98–108, the tessellatable branch of `prepareViewerVariantNow`, with:

```ts
  const occtFormat = occtFormatOf(file.name);
  if (occtFormat) {
    const bytes = await file.arrayBuffer();
    const glb = await runStepConvert(bytes, { format: occtFormat });
    if (!glb) return null;
    return {
      buffer: glb,
      summary:
        `Tessellated ${file.name}: ` +
        `${Math.round(file.size / 1024)}KB ${occtFormat.toUpperCase()} → ${Math.round(glb.byteLength / 1024)}KB GLB`,
    };
  }
```

`isTessellatableFilename` stays imported, because `shouldPrepareVariant` still uses it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/runStepConvert.test.mjs scripts/tests/stepToGlb.test.mjs && npx tsc --noEmit`
Expected: all PASS, including the existing ownership test (`bytes.byteLength === 0`); tsc silent.

- [ ] **Step 5: Commit**

```bash
git add lib/model/runStepConvert.ts lib/model/stepWorker.ts lib/STEPLoader.ts lib/model/runOptimize.ts scripts/tests/runStepConvert.test.mjs
git commit -m "feat(model): pass the OCCT format from loader to worker"
```

---

### Task 4: Self-host rhino3dm and add model fixtures

**Files:**
- Modify: `package.json` (`postinstall`)
- Modify: `.gitignore`
- Modify: `middleware.ts` (the `config.matcher` comment and pattern)
- Create: `scripts/fixtures/make-3dm-fixtures.mjs`
- Create: `scripts/tests/fixtures/models/README.md`
- Create (binary): `scripts/tests/fixtures/models/phong_cube.fbx`, `box.3mf`, `production_components.3mf`, `box-mesh.3dm`, `sphere-no-render-mesh.3dm`
- Test: `scripts/tests/middlewareMatcher.test.mjs` (new)

**Interfaces:**
- Produces: `/rhino3dm/rhino3dm.js` and `/rhino3dm/rhino3dm.wasm`, served unauthenticated (consumed by Task 5's `setLibraryPath('/rhino3dm/')`). Also the fixture files used by Task 8's browser check.

- [ ] **Step 1: Write the failing matcher test**

Create `scripts/tests/middlewareMatcher.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// middleware.ts imports next/server and the auth stack, so it cannot be imported under
// node --test. The matcher is a plain string literal; read it out of the source and apply it
// the way Next does: the pattern must match the WHOLE pathname for middleware to run.
const source = readFileSync('middleware.ts', 'utf8');
const pattern = source.match(/matcher:\s*\['([^']+)'\]/)[1];
const runsMiddleware = (pathname) => new RegExp(`^${pattern}$`).test(pathname);

test('the WASM assets the viewer workers fetch skip auth', () => {
  for (const p of ['/occt-import-js.wasm', '/rhino3dm/rhino3dm.js', '/rhino3dm/rhino3dm.wasm']) {
    assert.equal(runsMiddleware(p), false, p);
  }
});

test('ordinary pages and API routes still run middleware', () => {
  for (const p of ['/', '/portal/abc', '/api/files/url', '/api/uploads/rejected']) {
    assert.equal(runsMiddleware(p), true, p);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/tests/middlewareMatcher.test.mjs`
Expected: FAIL on `/rhino3dm/rhino3dm.js` (middleware runs, so the asset would 307 to `/login`).

- [ ] **Step 3: Exempt rhino3dm in middleware**

In `middleware.ts`, replace the matcher line with:

```ts
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|uploads|occt-import-js.wasm|rhino3dm/).*)'],
```

Add to the comment above it, after the `occt-import-js.wasm` paragraph:

```ts
  // rhino3dm/: the same category for Rhino files. three's 3DMLoader fetches rhino3dm.js and
  // rhino3dm.wasm from here (ModelViewerInner sets its library path), copied from three's own
  // bundled copy by the postinstall script. Without the exemption both 307 to /login.
```

- [ ] **Step 4: Copy rhino3dm at install time**

In `package.json`, replace the `postinstall` value with:

```json
"postinstall": "mkdir -p public/rhino3dm && cp node_modules/occt-import-js/dist/occt-import-js.wasm public/occt-import-js.wasm && cp node_modules/three/examples/jsm/libs/rhino3dm/rhino3dm.js node_modules/three/examples/jsm/libs/rhino3dm/rhino3dm.wasm public/rhino3dm/"
```

In `.gitignore`, add below `/public/occt-import-js.wasm`:

```
/public/rhino3dm/
```

Run: `npm run postinstall && ls public/rhino3dm`
Expected: `rhino3dm.js  rhino3dm.wasm`

Using three's bundled copy, rather than an npm `rhino3dm`, guarantees the library matches the `3DMLoader` that calls it, and adds no dependency.

- [ ] **Step 5: Run the matcher test to verify it passes**

Run: `node --test scripts/tests/middlewareMatcher.test.mjs`
Expected: PASS.

- [ ] **Step 6: Add the fixtures**

Create `scripts/fixtures/make-3dm-fixtures.mjs`:

```js
// Generates the two Rhino fixtures in scripts/tests/fixtures/models/.
//
// rhino3dm is NOT a dependency of this repo, and three's bundled copy does not load under
// node. Install it somewhere throwaway and point this script at it:
//
//   mkdir -p /tmp/rhino-gen && (cd /tmp/rhino-gen && npm init -y >/dev/null && npm i rhino3dm@8.35.0)
//   node scripts/fixtures/make-3dm-fixtures.mjs /tmp/rhino-gen scripts/tests/fixtures/models
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [rhinoHome, outDir] = process.argv.slice(2);
if (!rhinoHome || !outDir) {
  console.error('usage: node make-3dm-fixtures.mjs <dir with node_modules/rhino3dm> <outDir>');
  process.exit(1);
}
const rhino = await createRequire(path.join(rhinoHome, 'noop.js'))('rhino3dm')();

// A 10 mm box stored as a Mesh object: always displayable, like any Rhino mesh.
{
  const doc = new rhino.File3dm();
  const mesh = new rhino.Mesh();
  const v = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  for (const [x, y, z] of v) mesh.vertices().add(x, y, z);
  for (const [a, b, c, d] of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]) {
    mesh.faces().addQuadFace(a, b, c, d);
  }
  mesh.normals().computeNormals();
  const attrs = new rhino.ObjectAttributes();
  attrs.name = 'fixture box';
  doc.objects().add(mesh, attrs);
  fs.writeFileSync(path.join(outDir, 'box-mesh.3dm'), doc.toByteArray());
}

// A sphere Brep with NO render mesh: what a "Save Small" Rhino file looks like to rhino3dm.
{
  const doc = new rhino.File3dm();
  doc.objects().add(new rhino.Sphere([0, 0, 0], 5).toBrep(), null);
  fs.writeFileSync(path.join(outDir, 'sphere-no-render-mesh.3dm'), doc.toByteArray());
}
```

Generate the Rhino fixtures, then fetch the assimp ones. The pinned commit avoids drift.

```bash
mkdir -p scripts/tests/fixtures/models /tmp/rhino-gen
(cd /tmp/rhino-gen && npm init -y >/dev/null && npm i rhino3dm@8.35.0)
node scripts/fixtures/make-3dm-fixtures.mjs /tmp/rhino-gen scripts/tests/fixtures/models
ASSIMP_SHA=$(git ls-remote https://github.com/assimp/assimp.git HEAD | cut -f1)
for f in FBX/phong_cube.fbx 3MF/box.3mf 3MF/production_components.3mf; do
  curl -sfL "https://raw.githubusercontent.com/assimp/assimp/$ASSIMP_SHA/test/models/$f" -o "scripts/tests/fixtures/models/$(basename $f)"
done
echo "$ASSIMP_SHA"
ls -la scripts/tests/fixtures/models
```

Expected: five files, each under 20 KB. Note the printed SHA for the README.

Create `scripts/tests/fixtures/models/README.md`, replacing `<SHA>` with the printed value:

```markdown
# 3D model fixtures

Small files for checking the viewer's newer formats by hand (see the browser check in
docs/superpowers/plans/2026-10-15-more-3d-formats.md). IGES and BREP fixtures are not here:
tests read them from node_modules/occt-import-js/test/testfiles/.

| File | Source | Licence |
|---|---|---|
| phong_cube.fbx | assimp test/models/FBX at `<SHA>` | BSD-3-Clause (assimp) |
| box.3mf | assimp test/models/3MF at `<SHA>`: minimal core 3MF box | BSD-3-Clause (assimp) |
| production_components.3mf | assimp test/models/3MF at `<SHA>`: synthetic Production Extension components file; assimpjs returned it empty | BSD-3-Clause (assimp) |
| box-mesh.3dm | generated by scripts/fixtures/make-3dm-fixtures.mjs | ours |
| sphere-no-render-mesh.3dm | same; a Brep with no render mesh, which must show the "no display meshes" message | ours |
```

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore middleware.ts scripts/tests/middlewareMatcher.test.mjs scripts/fixtures/make-3dm-fixtures.mjs scripts/tests/fixtures/models
git commit -m "feat(viewer): self-host rhino3dm and add 3D format fixtures"
```

---

### Task 5: Open the new formats in the viewer

**Files:**
- Create: `lib/model/modelDisplayError.ts`
- Modify: `components/viewers/ModelErrorBoundary.tsx`
- Modify: `components/viewers/ModelViewerInner.tsx` (imports at lines 7–13, `getLoaderForExt` at lines 232–243, `useLoader` call and root memo in `Model`)
- Modify: `components/viewers/ViewerContainer.tsx:127`
- Modify: `app/portal/[id]/page.tsx:77` and `:670-674`
- Test: `scripts/tests/modelDisplayError.test.mjs` (new)

**Interfaces:**
- Consumes: `MODEL_FORMATS` (Task 1); `/rhino3dm/` assets (Task 4); STEPLoader handling IGES and BREP (Task 3).
- Produces:
  - `class ModelDisplayError extends Error { readonly userMessage: string }`
  - `hasDrawableGeometry(root: THREE.Object3D): boolean`
  - `EMPTY_RHINO_MESSAGE: string`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/modelDisplayError.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ModelDisplayError,
  hasDrawableGeometry,
  EMPTY_RHINO_MESSAGE,
} from '../../lib/model/modelDisplayError.ts';

const geometry = () => new THREE.BufferGeometry();

test('a mesh, a line or a point cloud anywhere in the tree is drawable', () => {
  for (const make of [
    () => new THREE.Mesh(geometry()),
    () => new THREE.Line(geometry()),
    () => new THREE.Points(geometry()),
  ]) {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(make());
    root.add(inner);
    assert.equal(hasDrawableGeometry(root), true);
  }
});

test('an empty tree, or one of bare groups, is not drawable', () => {
  assert.equal(hasDrawableGeometry(new THREE.Group()), false);
  const root = new THREE.Object3D();
  root.add(new THREE.Group(), new THREE.Object3D());
  assert.equal(hasDrawableGeometry(root), false);
});

test('ModelDisplayError is an Error that carries a message written for people', () => {
  const err = new ModelDisplayError(EMPTY_RHINO_MESSAGE);
  assert.ok(err instanceof Error);
  assert.equal(err.userMessage, EMPTY_RHINO_MESSAGE);
  assert.match(EMPTY_RHINO_MESSAGE, /Save Small/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/tests/modelDisplayError.test.mjs`
Expected: FAIL with "Cannot find module ... modelDisplayError.ts".

- [ ] **Step 3: Create `lib/model/modelDisplayError.ts`**

```ts
import type * as THREE from 'three';

/**
 * A model failure with something specific to tell the person looking at it. Thrown from
 * inside the viewer's render; ModelErrorBoundary shows `userMessage` in place of its generic
 * "could not be displayed" text. Anything else thrown keeps the generic text.
 */
export class ModelDisplayError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = 'ModelDisplayError';
    this.userMessage = userMessage;
  }
}

/**
 * Rhino stores render meshes beside its NURBS only when the file is saved with them, and
 * rhino3dm cannot mesh a Brep itself. A "Save Small" file therefore loads as an empty tree.
 */
export const EMPTY_RHINO_MESSAGE =
  'This Rhino file has no display meshes. Open it in Rhino, turn off Save Small, and save again.';

/** True when anything in the tree would put pixels on screen: a mesh, a line or points. */
export function hasDrawableGeometry(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((node) => {
    const n = node as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean };
    if (n.isMesh || n.isLine || n.isPoints) found = true;
  });
  return found;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/modelDisplayError.test.mjs`
Expected: PASS.

- [ ] **Step 5: Show the specific message in `ModelErrorBoundary`**

In `components/viewers/ModelErrorBoundary.tsx`:
- Add `import { ModelDisplayError } from '@/lib/model/modelDisplayError';` below the react import.
- Change `State` to `{ failed: boolean; message: string | null }`.
- Change the initial state to `{ failed: false, message: null }`.
- Replace `getDerivedStateFromError` with:

```tsx
  static getDerivedStateFromError(error: unknown): State {
    return {
      failed: true,
      message: error instanceof ModelDisplayError ? error.userMessage : null,
    };
  }
```

In `render()`, replace the second `<p>` (the "It may be too complex…" line) with:

```tsx
          <p className="mt-1 text-sm text-gray-500">
            {this.state.message ??
              'It may be too complex for the browser to prepare, or the file may not have uploaded correctly.'}
          </p>
```

- [ ] **Step 6: Add the loaders to `ModelViewerInner`**

Add these imports below the `ColladaLoader` import (line 12):

```tsx
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js';
import { ModelDisplayError, EMPTY_RHINO_MESSAGE, hasDrawableGeometry } from '@/lib/model/modelDisplayError';
```

Replace `getLoaderForExt` with:

```tsx
function getLoaderForExt(ext: string) {
  switch (ext) {
    case '.obj': return OBJLoader;
    case '.stl': return STLLoader;
    case '.3ds': return TDSLoader;
    case '.ply': return PLYLoader;
    case '.dae': return ColladaLoader;
    case '.fbx': return FBXLoader;
    case '.3mf': return ThreeMFLoader;
    case '.3dm': return Rhino3dmLoader;
    // Every OCCT format goes through STEPLoader, which picks the reader from the URL.
    case '.step':
    case '.stp':
    case '.igs':
    case '.iges':
    case '.brep': return STEPLoader;
    default: return GLTFLoader;
  }
}

/**
 * rhino3dm is fetched at runtime, not bundled. 3DMLoader's default library path is empty,
 * so it must be pointed at the copy the postinstall script places in public/rhino3dm/
 * (exempted from auth in middleware.ts). Every other loader needs no configuration.
 */
function configureLoader(loader: THREE.Loader) {
  if (loader instanceof Rhino3dmLoader) loader.setLibraryPath('/rhino3dm/');
}
```

In `Model`, replace the `useLoader` line with:

```tsx
  const data = useLoader(LoaderClass as any, url, configureLoader as any);
```

Keep the `eslint-disable-next-line` comment above it.

Directly after the `root` `useMemo`, insert:

```tsx
  // A Rhino file saved without render meshes parses fine and yields an empty tree. Say so,
  // rather than framing an empty scene. Throwing here is what reaches ModelErrorBoundary,
  // which shows the message and releases the viewport indicator.
  if (ext === '.3dm' && root && !hasDrawableGeometry(root)) {
    throw new ModelDisplayError(EMPTY_RHINO_MESSAGE);
  }
```

Update the comment "Materials that ship inside the file (OBJ / 3DS / DAE / STEP / glTF)" to "(OBJ / 3DS / DAE / FBX / 3MF / 3DM / STEP / glTF)".

- [ ] **Step 7: Use the single model list in `ViewerContainer` and the portal page**

In `components/viewers/ViewerContainer.tsx`, add `import { MODEL_FORMATS } from '@/lib/fileFormats';` with the other `@/lib` imports, and replace line 127 with:

```tsx
const MODEL_EXTENSIONS = MODEL_FORMATS.map((ext) => `.${ext}`);
```

In `app/portal/[id]/page.tsx`:
- Delete line 77 (`const MODEL_3D_EXTENSIONS = …`).
- Add `MODEL_FORMATS` to the existing `@/lib/fileFormats` import, or add `import { MODEL_FORMATS } from '@/lib/fileFormats';` if there is none.
- Replace the `is3DFile` memo body's return line with:

```tsx
    return MODEL_FORMATS.includes(ext);
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: tsc silent; all tests pass; lint clean.

If tsc rejects the `configureLoader as any` argument, the third `useLoader` parameter's type in the installed `@react-three/fiber` differs. Keep the `as any` (it matches the existing `LoaderClass as any`) and look up the exact type in `node_modules/@react-three/fiber/dist/declarations/src/core/hooks.d.ts`.

- [ ] **Step 9: Commit**

```bash
git add lib/model/modelDisplayError.ts scripts/tests/modelDisplayError.test.mjs components/viewers/ModelErrorBoundary.tsx components/viewers/ModelViewerInner.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx"
git commit -m "feat(viewer): open FBX, 3MF, Rhino, IGES and BREP files"
```

---

### Task 6: Export advice in the drop zone

**Files:**
- Modify: `components/ui/FileDropzone.tsx` (import, default `hint` at line 88, rejected list at lines 289–296)
- Modify: `components/portal/NewVersionDrawer.tsx:235` (its `hint` prop)

**Interfaces:**
- Consumes: `adviceFor` (Task 1).

- [ ] **Step 1: Show advice per refused file**

In `components/ui/FileDropzone.tsx`, add `adviceFor,` to the `@/lib/fileFormats` import. Replace the `rejected.slice(0, 5).map(...)` block with:

```tsx
                {rejected.slice(0, 5).map((name, i) => {
                  const advice = adviceFor(name);
                  return (
                    <li
                      key={`${name}-${i}`}
                      className={advice ? 'font-medium' : 'truncate font-medium'}
                    >
                      {name}
                      {advice ? (
                        <span className="ml-1 font-normal">
                          — {advice.app}. {advice.advice}
                        </span>
                      ) : (
                        <span className="ml-1 opacity-70">
                          ({extensionOf(name) ? `.${extensionOf(name)}` : "no extension"})
                        </span>
                      )}
                    </li>
                  );
                })}
```

An advised line is not truncated, because the advice is the whole point of the line.

- [ ] **Step 2: Name the new formats in both hints**

In `FileDropzone.tsx`, change the default `hint` to:

```tsx
  hint = 'Folders keep their structure · PDF, DWG, DXF, GLB, STEP, IGES, FBX, 3MF, Rhino, OBJ, STL, images, video',
```

In `components/portal/NewVersionDrawer.tsx`, change the `hint` prop to:

```tsx
            hint="Files with a matching name replace the earlier copy; new ones are added · PDF, DWG, DXF, GLB, STEP, IGES, FBX, 3MF, Rhino, OBJ, STL, images, video"
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add components/ui/FileDropzone.tsx components/portal/NewVersionDrawer.tsx
git commit -m "feat(upload): tell people what to export when a native CAD file is refused"
```

---

### Task 7: Count refused extensions

**Files:**
- Create: `lib/migrations/017-rejected-uploads.sql`
- Modify: `lib/schema.sql` (append the mirrored table)
- Create: `lib/rejectedUploads.ts`
- Create: `app/api/uploads/rejected/route.ts`
- Modify: `components/ui/FileDropzone.tsx` (`addFiles`)
- Test: `scripts/tests/rejectedUploads.test.mjs` (new)

**Interfaces:**
- Consumes: `extensionOf` from `lib/fileFormats.ts`.
- Produces:
  - `MAX_REJECTED_PER_REPORT = 20`
  - `normalizeRejectedExtensions(input: unknown): string[]`
  - `POST /api/uploads/rejected` with body `{ extensions: string[] }`, returning 204, or 401 without a session

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/rejectedUploads.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRejectedExtensions,
  MAX_REJECTED_PER_REPORT,
} from '../../lib/rejectedUploads.ts';

test('extensions are lowercased and kept once per refused file', () => {
  // Duplicates are deliberate: three refused .sldprt files are three data points.
  assert.deepEqual(normalizeRejectedExtensions(['SLDPRT', 'sldprt', 'rvt']), ['sldprt', 'sldprt', 'rvt']);
});

test('an empty string means a file with no extension and is stored as (none)', () => {
  assert.deepEqual(normalizeRejectedExtensions(['']), ['(none)']);
});

test('anything that does not look like an extension is dropped', () => {
  assert.deepEqual(
    normalizeRejectedExtensions(['x_t', 'a.b', 'has space', 'waytoolongext', "'; drop", 42, null]),
    ['x_t']
  );
});

test('a report is capped so one request cannot write unbounded rows', () => {
  const many = Array.from({ length: 50 }, () => 'skp');
  assert.equal(normalizeRejectedExtensions(many).length, MAX_REJECTED_PER_REPORT);
  assert.equal(MAX_REJECTED_PER_REPORT, 20);
});

test('a body that is not an array yields nothing', () => {
  for (const bad of [undefined, null, 'sldprt', { extensions: ['sldprt'] }]) {
    assert.deepEqual(normalizeRejectedExtensions(bad), []);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/tests/rejectedUploads.test.mjs`
Expected: FAIL with "Cannot find module ... rejectedUploads.ts".

- [ ] **Step 3: Implement `lib/rejectedUploads.ts`**

```ts
/**
 * Validation for refused-upload reports. Only extensions ever leave the browser — never
 * filenames — so this counts demand without recording what anyone was working on.
 */

export const MAX_REJECTED_PER_REPORT = 20;

const EXTENSION = /^[a-z0-9_]{1,10}$/;

/**
 * The extensions worth counting from an untrusted request body: lowercased, one entry per
 * refused file (duplicates kept), junk dropped, capped. '' is a file with no extension.
 */
export function normalizeRejectedExtensions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const ext = raw.toLowerCase();
    if (ext === '') out.push('(none)');
    else if (EXTENSION.test(ext)) out.push(ext);
    if (out.length === MAX_REJECTED_PER_REPORT) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/rejectedUploads.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add the migration and mirror it in the schema**

Before naming the file, confirm `017-rejected-uploads.sql` is not already recorded. `schema_migrations` is keyed on filename, and unmerged branches have claimed numbers before. The release step runs this check against production. Create `lib/migrations/017-rejected-uploads.sql`:

```sql
-- lib/migrations/017-rejected-uploads.sql
--
-- Counts of files the drop zone refused, by extension (2026-10-15). Mirrored in
-- lib/schema.sql. Extensions only, never filenames: this measures demand for formats
-- stiko cannot open, nothing more. Read it in the Neon console:
--   SELECT * FROM rejected_uploads ORDER BY count DESC;
CREATE TABLE IF NOT EXISTS rejected_uploads (
  extension TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL
);
```

Append to `lib/schema.sql`:

```sql

-- Refused uploads by extension. Added in 017-rejected-uploads.sql.
CREATE TABLE IF NOT EXISTS rejected_uploads (
  extension TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL
);
```

- [ ] **Step 6: Add the route**

Create `app/api/uploads/rejected/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { normalizeRejectedExtensions } from '@/lib/rejectedUploads';

/**
 * Counts refused uploads by extension. Fire-and-forget from FileDropzone: nothing waits on
 * it, so every failure here is swallowed into a 204 rather than surfaced.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const extensions = normalizeRejectedExtensions(body?.extensions);
  if (extensions.length === 0) return new NextResponse(null, { status: 204 });

  try {
    // GROUP BY first: ON CONFLICT DO UPDATE cannot touch the same row twice in one
    // statement, and three refused .sldprt files in one drop arrive as three entries.
    await sql`
      INSERT INTO rejected_uploads (extension, count, last_seen)
      SELECT ext, COUNT(*)::int, now()
      FROM unnest(${extensions}::text[]) AS t(ext)
      GROUP BY ext
      ON CONFLICT (extension) DO UPDATE
        SET count = rejected_uploads.count + EXCLUDED.count,
            last_seen = EXCLUDED.last_seen
    `;
  } catch (error) {
    // 42P01 undefined_table: migration 017 has not been applied yet. Migrations here are
    // manual and have been forgotten before; a missing table must cost counts, not uploads.
    if ((error as { code?: string }).code !== '42P01') {
      console.warn('Could not record refused uploads', error);
    }
  }
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 7: Execute the SQL once against PGlite**

The repo has no committed database test harness. Run the statement for real once, the way the PGlite SQL harness notes describe, in the scratchpad. Create `<scratchpad>/pglite-rejected/check.mjs`:

```js
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const upsert = (exts) => db.query(
  `INSERT INTO rejected_uploads (extension, count, last_seen)
   SELECT ext, COUNT(*)::int, now() FROM unnest($1::text[]) AS t(ext) GROUP BY ext
   ON CONFLICT (extension) DO UPDATE
     SET count = rejected_uploads.count + EXCLUDED.count, last_seen = EXCLUDED.last_seen`,
  [exts]
);

// Missing table: must raise 42P01, which the route swallows.
try { await upsert(['skp']); console.log('UNEXPECTED: no error'); }
catch (e) { console.log('missing table code:', e.code); }

await db.exec(readFileSync(process.argv[2], 'utf8'));
await upsert(['sldprt', 'sldprt', 'rvt']);
await upsert(['sldprt']);
console.log((await db.query('SELECT extension, count FROM rejected_uploads ORDER BY extension')).rows);
```

Run:

```bash
mkdir -p "$SCRATCH/pglite-rejected" && cd "$SCRATCH/pglite-rejected" && npm init -y >/dev/null && npm i @electric-sql/pglite
node check.mjs /Users/user/Desktop/STIKO-main/lib/migrations/017-rejected-uploads.sql
```

`$SCRATCH` is the session scratchpad directory.

Expected:

```
missing table code: 42P01
[ { extension: 'rvt', count: 1 }, { extension: 'sldprt', count: 3 } ]
```

Neon is real Postgres, and PGlite is Postgres compiled to WASM, so this exercises the same `unnest`/`GROUP BY`/`ON CONFLICT` semantics. One difference: neon's tagged template sends the JS array as a single text-array parameter, which `$1::text[]` reproduces here.

- [ ] **Step 8: Report refused extensions from the drop zone**

In `components/ui/FileDropzone.tsx`, inside `addFiles`, directly after `setRejected(refused.map((f) => f.file.name));`, add:

```tsx
      if (refused.length > 0) {
        // Demand data for formats stiko can't open: extensions only, never names. Nothing
        // waits on this and a failure changes nothing for the person uploading.
        fetch('/api/uploads/rejected', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extensions: refused.map((f) => extensionOf(f.file.name)) }),
          keepalive: true,
        }).catch(() => {});
      }
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add lib/migrations/017-rejected-uploads.sql lib/schema.sql lib/rejectedUploads.ts app/api/uploads/rejected/route.ts components/ui/FileDropzone.tsx scripts/tests/rejectedUploads.test.mjs
git commit -m "feat(upload): count refused uploads by extension"
```

---

### Task 8: Full verification in the browser

**Files:** none changed unless a defect is found. A defect gets its own failing test (where one is possible) and its own commit.

- [ ] **Step 1: Full static checks and build**

Run: `npx tsc --noEmit && npm test && npm run lint && npx next build`
Expected: all succeed. The build must finish without `UnhandledSchemeError` or worker-bundling errors.

- [ ] **Step 2: Boot the app locally**

Follow the local visual verification notes: start the dev server, sign in, and stub `/api/home` if the account has no projects. Open a package where you can upload.

- [ ] **Step 3: Check each format end to end**

Upload each of these, then open it in the viewer:
- `scripts/tests/fixtures/models/phong_cube.fbx`
- `box.3mf`
- `production_components.3mf`
- `box-mesh.3dm`
- `node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.igs`
- `node_modules/occt-import-js/test/testfiles/cax-if-brep/as1_pe_203.brep`
- one existing `.stp`, as a regression check

For each one, confirm:
- Geometry renders, and the loading indicator ends.
- Orbit, comment pins and the measure tool work.
- The console shows no errors.

`sphere-no-render-mesh.3dm` must show "This Rhino file has no display meshes. Open it in Rhino, turn off Save Small, and save again." Record anything that renders but looks wrong (rotation, scale) in the summary; do not fix it in this plan.

- [ ] **Step 4: Check the refusals**

In the upload drop zone:
1. Drop a file renamed to `test.sldprt` and confirm the line reads `test.sldprt — SolidWorks. Save As STEP, then upload.`
2. Drop `notes.docx` and confirm it shows `(.docx)`.
3. In the network panel, confirm `POST /api/uploads/rejected` returns 204. It returns 204 even without migration 017 applied locally; that is the 42P01 path.

- [ ] **Step 5: Check that rhino3dm is not auth-gated**

In a private window (signed out), open `http://localhost:3000/rhino3dm/rhino3dm.wasm`.
Expected: a binary download. It must not redirect to `/login`.

- [ ] **Step 6: Record the outcome in the summary**

List what was checked, what passed, and anything that looked wrong. Do not merge from this plan. Merging and releasing are the user's steps, below.

---

## Release (for the user, after review)

Production is the only environment. Each step is a paste block.

1. **Check the migration name is free, then apply it.** Open a terminal and paste the
   command below. It is the exact form from the credential notes: the `sed` trim is required,
   and the final pipe stops a failure from printing the connection string.
   ```bash
   cd /Users/user/Desktop/STIKO-main && DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node -e 'const {neon}=require("@neondatabase/serverless");neon(process.env.DATABASE_URL)`SELECT name FROM schema_migrations ORDER BY name`.then(r=>console.log(r.map(x=>x.name).join("\n")))' 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
   ```
   If `017-rejected-uploads.sql` is not listed, first do a dry run. `npm run migrate` applies
   EVERY outstanding migration, not only 017. Confirm the outstanding set is only 017, or
   016 + 017 if the mentions migration was never applied. Note that `--dry` lists all
   migrations, so compare its output against the applied list from the first command.
   ```bash
   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate -- --dry 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
   ```
   Then apply it, re-run the check, and confirm 017 is listed:
   ```bash
   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
   ```
2. **Merge and deploy:** `git checkout main && git merge --no-ff feature/more-3d-formats && git push`
3. **Check production:** in a package, upload and open:
   - one FBX, one Rhino, one IGES and one 3MF file
   - one existing STEP file, as a regression check on the real R2 path, which the browser
     harness never exercised
   
   Also look at the drop-zone hint in the compact "new submission" drawer.

**Rollback:** `git revert -m 1 <merge commit> && git push`. The `rejected_uploads` table can stay; nothing else reads it.
