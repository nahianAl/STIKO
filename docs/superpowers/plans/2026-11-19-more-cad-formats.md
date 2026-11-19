# More native CAD formats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inventor `.ipt`, CATIA `.catpart`, NX/Creo `.prt` (incl. Creo `.prt.<n>`), Parasolid `.x_t`/`.x_b`, JT and ACIS `.sat` files convert to GLB on the existing NVIDIA CAD worker and open in the 3D viewer, exactly like SolidWorks parts do today.

**Architecture:** One table of converted formats (`CAD_CONVERSION_FORMATS` in `lib/fileFormats.ts`) replaces every SolidWorks-only check. A per-format switch `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` decides which are live. The worker accepts the same list and names its input file with the real suffix. The claim, cap, callback and polling machinery is unchanged.

**Tech Stack:** Next.js 14 App Router + TypeScript; `node --test` for pure modules; Python 3.12 + pytest for `cad-worker/`; Modal (T4) running NVIDIA `usd-convert-cad==0.3.0`.

**Spec:** `docs/superpowers/specs/2026-11-19-more-cad-formats-design.md`. Read it first. The previous spec it builds on, `docs/superpowers/specs/2026-10-18-sldprt-conversion-design.md`, explains the claim/callback protocol.

## Global Constraints

- **Where you work:** everything happens in the worktree `/Users/user/Desktop/STIKO-more-cad-formats`, branch `feature/more-cad-formats`. **Never** touch `/Users/user/Desktop/STIKO-main`; another session is working there on `feature/kyc-v2`.
- **Commits:** never `git add -A` or `git add .`. Three long-lived untracked handoff directories exist and must not be committed. Add files by explicit path.
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Converted formats, exactly:** `sldprt`, `ipt`, `catpart`, `prt`, `x_t`, `x_b`, `jt`, `sat`.
- **Not converted:** Revit, IFC, Solid Edge (`par`/`psm`) and every assembly format keep their advice.
- **New switch:** `NEXT_PUBLIC_CAD_CONVERSION_FORMATS`. Unset or blank means the legacy `NEXT_PUBLIC_SLDPRT_CONVERSION` behaviour (`['sldprt']` unless that variable is `off`). `off` means none. Otherwise it's a comma list, matched case- and space-insensitively, with unknown names ignored.
- **Monthly cap:** one shared cap, still read from `SLDPRT_MONTHLY_CAP` (default 300).
- **Pure modules:** `lib/fileFormats.ts`, `lib/cadConversion.ts` and `lib/measure/calibration.ts` are run by `node --test`. They must use relative `.ts` imports, never the `@/` alias, and import `lib/queries` types only with `import type`.
- **Local dev uses the production database and R2.** No browser check may upload or write. Serve fixtures and stub write endpoints.
- **Copy:** the app's name and noun come from the table:

  | Key | app | noun |
  |---|---|---|
  | sldprt | SolidWorks | part |
  | ipt | Inventor | part |
  | catpart | CATIA | part |
  | prt | NX or Creo | part |
  | x_t, x_b | Parasolid | model |
  | jt | JT | model |
  | sat | ACIS | model |

---

## File map

| File | Change | Task |
|---|---|---|
| `cad-worker/worker_core.py` | `CAD_EXTENSIONS`, `input_suffix`, validation, input naming | 1 |
| `cad-worker/tests/test_worker_core.py` | tests for the above | 1 |
| `cad-worker/app.py` | `smoke` walks every format, recursively, a few per format | 1 |
| `cad-worker/README.md` | supported list, licence note | 1 |
| `docs/superpowers/specs/2026-11-19-more-cad-formats-design.md` | real-file test results | 2 |
| `lib/fileFormats.ts` | the table, `enabledCadFormats`, `formatTables(list)`, `ENABLED_CAD_FORMATS`, Creo rule in `extensionOf` | 3 |
| `scripts/tests/fileFormats.test.mjs` | tests | 3 |
| `lib/cadConversion.ts` | `isCadFilename`, `cadFormatEnabled`, `cadLabel`, `cadPreparingLabel` | 4 |
| `lib/measure/calibration.ts` | millimetres for every converted format | 4 |
| `lib/useUpload.ts` | trigger for every enabled format | 4 |
| `scripts/tests/cadConversion.test.mjs`, `scripts/tests/measureCalibration.test.mjs` | tests | 4 |
| `app/api/files/[id]/convert-cad/route.ts`, `app/api/conversions/cad-callback/route.ts` | format-neutral checks and logs | 5 |
| `lib/storageKeys.ts` | comment only | 5 |
| `components/viewers/CadPreparer.tsx`, `components/viewers/ViewerContainer.tsx`, `app/portal/[id]/page.tsx` | per-format copy | 6 |

---

### Task 0: Worktree setup

**Files:** none committed.

- [ ] **Step 1: Install dependencies in the worktree.** The worktree has no `node_modules`.

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && npm ci
```
Expected: it finishes without errors.

- [ ] **Step 2: Baseline the gates** so later failures are known to be yours.

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && npm test 2>&1 | tail -5 && npx tsc --noEmit && echo TSC-OK
python3 -m venv /tmp/stiko-cadw && /tmp/stiko-cadw/bin/pip install -q -r cad-worker/requirements-dev.txt modal fastapi && /tmp/stiko-cadw/bin/python -m pytest -q cad-worker/tests 2>&1 | tail -2
```
Expected: all node tests pass, `TSC-OK`, and pytest reports all passed. If anything fails before you've changed code, stop and report it.

---

### Task 1: The worker accepts every converted format

**Files:**
- Modify: `cad-worker/worker_core.py` (module docstring, constants near line 24, `validate_job` around line 89, `process_job` around line 197)
- Modify: `cad-worker/app.py` (docstring line 1, `smoke` at the end)
- Modify: `cad-worker/README.md`
- Test: `cad-worker/tests/test_worker_core.py`

**Interfaces:**
- **Produces:** `worker_core.CAD_EXTENSIONS: tuple[str, ...]`.
- **Produces:** `worker_core.input_suffix(filename: str) -> str | None`. It returns a lowercased suffix including the leading dot (`'.ipt'`, `'.prt.5'`), or `None` for a file the worker won't convert. Task 2 uses it through `smoke`.

- [ ] **Step 1: Write the failing tests.** In `cad-worker/tests/test_worker_core.py`, replace `test_only_sldprt_is_accepted` (around line 125) with:

```python
@pytest.mark.parametrize('name,suffix', [
    ('a.sldprt', '.sldprt'), ('A.SLDPRT', '.sldprt'), ('bracket.ipt', '.ipt'), ('b.CATPart', '.catpart'),
    ('nx_part.prt', '.prt'), ('creo_part.prt.5', '.prt.5'), ('CREO.PRT.12', '.prt.12'),
    ('m.x_t', '.x_t'), ('m.X_B', '.x_b'), ('m.jt', '.jt'), ('m.sat', '.sat'), ('dir/sub/m.jt', '.jt'),
])
def test_input_suffix_for_convertible_files(name, suffix):
    assert worker_core.input_suffix(name) == suffix


@pytest.mark.parametrize('name', [
    'a.sldasm', 'a.iam', 'a.catproduct', 'a.asm', 'a.asm.3', 'a.par', 'a.rvt', 'a.ifc', 'a.step',
    'notes.5', '.prt', '.prt.5', 'prt', 'a.prt.', 'a.prt.x', '',
])
def test_input_suffix_refuses_everything_else(name):
    assert worker_core.input_suffix(name) is None


@pytest.mark.parametrize('name', ['a.ipt', 'a.prt.5', 'a.jt', 'a.sldprt'])
def test_convertible_formats_are_accepted(name):
    body = valid()
    body['filename'] = name
    assert worker_core.validate_job(body, STORAGE, CALLBACK)['filename'] == name


@pytest.mark.parametrize('name', ['a.sldasm', 'a.rvt', 'a.step'])
def test_other_formats_are_refused_with_422(name):
    body = valid()
    body['filename'] = name
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 422


def test_the_input_keeps_the_real_suffix(server, tmp_path):
    seen = []

    def convert(src, usd, glb):
        seen.append(src.name)
        glb.write_bytes(GLB)

    worker_core.process_job(job(server, filename='creo_bracket.prt.5'), tmp_path, convert=convert, sleep=lambda s: None)
    worker_core.process_job(job(server, filename='Part.SLDPRT'), tmp_path, convert=convert, sleep=lambda s: None)
    assert seen == ['input.prt.5', 'input.sldprt']
```

- [ ] **Step 2: Run the tests to verify they fail.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && /tmp/stiko-cadw/bin/python -m pytest -q cad-worker/tests/test_worker_core.py 2>&1 | tail -3
```
Expected: FAIL with `AttributeError: module 'worker_core' has no attribute 'input_suffix'`.

- [ ] **Step 3: Implement.** In `cad-worker/worker_core.py`:

  - **Docstring:** in the module docstring, change "download the .sldprt from a presigned GET URL" to "download the CAD part (any of CAD_EXTENSIONS) from a presigned GET URL".
  - **Imports:** add `import re` to the imports, in alphabetical order after `import json`.
  - **Constants:** below `JOB_FIELDS = (...)`, add:

```python
# The native formats this worker converts. Keep in step with CAD_CONVERSION_FORMATS in
# lib/fileFormats.ts: the app decides which of these are switched on; the worker refuses the rest.
CAD_EXTENSIONS = ('sldprt', 'ipt', 'catpart', 'prt', 'x_t', 'x_b', 'jt', 'sat')
# Creo saves each version as name.prt.<n>; the version number is part of the real suffix.
_CREO_VERSION = re.compile(r'.\.(prt\.\d+)$')


def input_suffix(filename):
    """The suffix the downloaded file is saved with ('.ipt', '.prt.5'), or None if it isn't convertible."""
    name = (filename or '').rsplit('/', 1)[-1].lower()
    creo = _CREO_VERSION.search(name)
    if creo:
        return '.' + creo.group(1)
    dot = name.rfind('.')
    if dot <= 0:
        return None
    ext = name[dot + 1:]
    return '.' + ext if ext in CAD_EXTENSIONS else None
```

  - **`validate_job`:** replace

```python
    if not body['filename'].lower().endswith('.sldprt'):
        raise Refused(422, 'only .sldprt files are converted')
```
with
```python
    if input_suffix(body['filename']) is None:
        raise Refused(422, 'not a convertible CAD file')
```

  - **`process_job`:** replace
```python
    src, usd, glb = workdir / 'input.sldprt', workdir / 'out.usdc', workdir / 'out.glb'
```
with
```python
    # HOOPS picks its reader from the suffix, so the input keeps the real one (Creo's .prt.<n> too).
    src, usd, glb = workdir / ('input' + input_suffix(job['filename'])), workdir / 'out.usdc', workdir / 'out.glb'
```

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && /tmp/stiko-cadw/bin/python -m pytest -q cad-worker/tests 2>&1 | tail -2
```
Expected: all pass, the old tests included.

- [ ] **Step 5: Widen `smoke`.** In `cad-worker/app.py`:
  - Change the docstring's first line to `"""Stiko CAD worker on Modal: native CAD parts -> GLB with NVIDIA usd-convert-cad on a T4.`
  - Change the `Smoke:` line to `Smoke:   modal run cad-worker/app.py::smoke --samples DIR --out DIR [--per-format 3]`.
  - Replace the whole `smoke` function with:

```python
def _spread(items, k):
    """Up to k items spread across a size-sorted list: smallest, largest, and evenly between."""
    if len(items) <= k:
        return items
    if k == 1:
        return items[:1]
    return [items[round(i * (len(items) - 1) / (k - 1))] for i in range(k)]


@app.local_entrypoint()
def smoke(samples: str, out: str, per_format: int = 3):
    import re
    import sys

    sys.path.insert(0, str(HERE))
    import worker_core

    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    groups = {}
    for p in Path(samples).rglob('*'):
        suffix = p.is_file() and worker_core.input_suffix(p.name)
        if suffix:
            # Creo's .prt.<n> is its own group, so NX and Creo .prt are both sampled.
            groups.setdefault(re.sub(r'\d+$', 'n', suffix), []).append(p)
    for key in sorted(groups):
        for f in _spread(sorted(groups[key], key=lambda p: p.stat().st_size), per_format):
            r = convert_bytes.remote(f.name, f.read_bytes())
            glb = r.pop('glb', None)
            if glb:
                (out_dir / (f.name + '.glb')).write_bytes(glb)
            print(key, f.stat().st_size, r, len(glb or b''))
```

- [ ] **Step 6: Update `cad-worker/README.md`.**
  - Wherever it says the worker converts `.sldprt`, say it converts the formats in `CAD_EXTENSIONS` (`.sldprt`, `.ipt`, `.catpart`, `.prt` and Creo's `.prt.<n>`, `.x_t`, `.x_b`, `.jt`, `.sat`) and that the app's `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` decides which are live.
  - In the licence section add one line: "NVIDIA's README says proprietary CAD formats can require CAD converter licensing; that question, open with NVIDIA, now covers Inventor, CATIA, NX, Creo, Parasolid and JT as well as SolidWorks."

- [ ] **Step 7: Commit.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && git add cad-worker/worker_core.py cad-worker/app.py cad-worker/README.md cad-worker/tests/test_worker_core.py && git commit -m "feat(cad-worker): accept Inventor, CATIA, NX/Creo, Parasolid, JT and ACIS parts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Real-file test on Modal (gate for every format)

This task decides which formats ship. **Nothing in Tasks 3–6 may add a format that fails here.** `modal run` starts a temporary app; it does not touch the deployed production worker.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-19-more-cad-formats-design.md` (add a "Real-file test" section after the Status line)
- Scratch only, never committed: `/tmp/stiko-cad-smoke/` (GLBs) and `/tmp/stiko-bbox.mjs`

**Interfaces:**
- **Consumes:** `smoke` from Task 1.
- **Produces:** the list of formats that passed. Task 7's release step and the spec use it.

- [ ] **Step 1: Run the smoke test on every format.** The Modal token is already in `~/.modal.toml`.

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && /tmp/stiko-cadw/bin/modal run cad-worker/app.py::smoke --samples ~/Desktop/stiko-cad-samples --out /tmp/stiko-cad-smoke --per-format 3 2>&1 | tee /tmp/stiko-cad-smoke.log | grep -vE '^\s*$' | tail -40
```
Expected: one line per file, `<group> <bytes> {'name': …, 'seconds': …} <glb bytes>`, for the groups `.catpart .jt .prt .prt.n .sat .sldprt .x_b .x_t .ipt`, or `{'name': …, 'error': …}` for a failure. The first file is a cold start of about 20 s.

- [ ] **Step 2: If Creo `.prt.n` fails with an "unreadable"/unknown-format error, try the bare suffix once.** Copy one Creo file to `/tmp/creo-test/x.prt` and run:

```bash
/tmp/stiko-cadw/bin/modal run cad-worker/app.py::smoke --samples /tmp/creo-test --out /tmp/stiko-cad-smoke-creo --per-format 1
```
If that converts, change `input_suffix` so a Creo match returns `'.prt'`, update the `test_input_suffix_for_convertible_files` cases (`'.prt.5'` becomes `'.prt'`) and `test_the_input_keeps_the_real_suffix` (expect `'input.prt'`), re-run pytest and commit with `fix(cad-worker): give Creo version files a plain .prt suffix`. If neither works, Creo is dropped (Step 5).

- [ ] **Step 3: Check scale against NIST's STEP exports.** Write `/tmp/stiko-bbox.mjs`:

```js
// node /tmp/stiko-bbox.mjs <glbDir> <stepDir>
// For each GLB whose name holds a NIST id (ctc_01, ftc_06…), compare its extents with the STEP of the same part.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('/Users/user/Desktop/STIKO-more-cad-formats/package.json');
const occt = await require('occt-import-js')();
const [glbDir, stepDir] = process.argv.slice(2);
const idOf = (n) => (/(ctc|ftc|stc|htc)_\d+/i.exec(n) || [])[0]?.toLowerCase();

function extentOf(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  points((x, y, z) => {
    [x, y, z].forEach((v, i) => { if (v < min[i]) min[i] = v; if (v > max[i]) max[i] = v; });
  });
  return max.map((v, i) => v - min[i]);
}

function glbExtent(file) {
  const b = fs.readFileSync(file);
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  // usd_to_glb.py bakes world transforms into positions, so accessor bounds are model bounds.
  return extentOf((visit) => {
    for (const m of json.meshes ?? []) for (const p of m.primitives) {
      const a = json.accessors[p.attributes.POSITION];
      visit(...a.min); visit(...a.max);
    }
  });
}

function stepExtent(file) {
  const r = occt.ReadStepFile(new Uint8Array(fs.readFileSync(file)), { linearUnit: 'millimeter' });
  return extentOf((visit) => {
    for (const m of r.meshes) {
      const a = m.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) visit(a[i], a[i + 1], a[i + 2]);
    }
  });
}

const steps = new Map(fs.readdirSync(stepDir).map((n) => [idOf(n), path.join(stepDir, n)]));
for (const n of fs.readdirSync(glbDir).filter((f) => f.endsWith('.glb')).sort()) {
  const step = steps.get(idOf(n));
  if (!step) { console.log(`${n}: no STEP reference`); continue; }
  const g = glbExtent(path.join(glbDir, n));
  const s = stepExtent(step);
  const [gs, ss] = [[...g].sort((a, b) => a - b), [...s].sort((a, b) => a - b)];
  const worst = Math.max(...gs.map((v, i) => Math.abs(v / ss[i] - 1)));
  console.log(`${worst < 0.01 ? 'OK  ' : 'BAD '} ${n}  glb ${g.map((v) => v.toFixed(1)).join(' x ')}  step ${s.map((v) => v.toFixed(1)).join(' x ')}  worst ${(worst * 100).toFixed(2)}%`);
}
```

Run it:
```bash
node /tmp/stiko-bbox.mjs /tmp/stiko-cad-smoke ~/Desktop/stiko-cad-samples/step-reference
```
Expected: `OK` on every NIST part, meaning sorted extents within 1% of the STEP. A ratio near 25.4 or 1000 means a unit bug. The unsorted extents show orientation: for NIST parts the GLB's tallest axis should be Y wherever the STEP's is Z.

- [ ] **Step 4: Look at one GLB per format in the real viewer.** Use the local-visual-verification harness: serve the GLB from `public/uploads/…` through `ModelViewer`, with no uploads. Check that it stands upright, has its colours, and that the parts panel lists bodies. Take one screenshot per format.

- [ ] **Step 5: Record and decide.** Add this section to the spec after its Status line, filled with the real numbers:

```markdown
## Real-file test (2026-11-19)

| Format | Files | Converted | Cold / warm s | GLB size | Scale vs STEP | Upright, colours | Verdict |
|---|---|---|---|---|---|---|---|
| .ipt | … | … | … | … | … | … | ship / drop |
| … one row per group from the smoke log … |
```
Every format whose row is not all-good gets **drop** and is removed from the release list. Tasks 3–6 still build the full table; the switch list is what decides what ships. If a format fails in a way that suggests a worker fix (as Creo's suffix might), report it to the user before going on.

- [ ] **Step 6: Commit the results.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && git add docs/superpowers/specs/2026-11-19-more-cad-formats-design.md && git commit -m "docs(spec): real-file test results for the new CAD formats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The format table, the switch and Creo's suffix

**Files:**
- Modify: `lib/fileFormats.ts`
- Test: `scripts/tests/fileFormats.test.mjs`

**Interfaces:**
- **Produces, from `lib/fileFormats.ts`:**
  - `interface CadFormat { app: string; noun: 'part' | 'model'; advice: string }`
  - `CAD_CONVERSION_FORMATS: Readonly<Record<string, Readonly<CadFormat>>>`
  - `enabledCadFormats(list?: string, legacy?: string): string[]`
  - `formatTables(enabled: readonly string[]): { model: string[]; advice: Record<string, FormatAdvice> }`
  - `ENABLED_CAD_FORMATS: readonly string[]`
  - `extensionOf`, which now maps `x.prt.<n>`, `x.asm.<n>` and `x.drw.<n>` to `prt`/`asm`/`drw`
  - `sldprtConversionEnabled`, which stays but is now used only inside `enabledCadFormats`

- [ ] **Step 1: Write the failing tests.** In `scripts/tests/fileFormats.test.mjs`:

  - **Import list:** add `CAD_CONVERSION_FORMATS`, `ENABLED_CAD_FORMATS` and `enabledCadFormats`.
  - **Model-list test:** leave `'the model list is exactly the formats the 3D viewer opens'` unchanged. With the env unset, the legacy switch gives `['sldprt']`.
  - **Advice test:** in `'native CAD files get the advice row the spec fixed'`, add one case to `cases`:

```js
    'a.sat': ['ACIS', 'Export STEP from your CAD tool, then upload.'],
```

  - **Switch test:** replace the test `'switching SolidWorks off moves .sldprt from the model list back to the advice table'` with:

```js
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
  assert.deepEqual(Object.keys(CAD_CONVERSION_FORMATS).sort(), ['catpart', 'ipt', 'jt', 'prt', 'sat', 'sldprt', 'x_b', 'x_t']);
  assert.deepEqual(CAD_CONVERSION_FORMATS.prt, { app: 'NX or Creo', noun: 'part', advice: 'Export STEP, then upload.' });
  assert.deepEqual(CAD_CONVERSION_FORMATS.jt, { app: 'JT', noun: 'model', advice: 'Export STEP from your CAD tool, then upload.' });
  for (const f of Object.values(CAD_CONVERSION_FORMATS)) {
    assert.ok(f.app && f.advice && (f.noun === 'part' || f.noun === 'model'));
  }
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
```

- [ ] **Step 2: Run the tests to verify they fail.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && node --test scripts/tests/fileFormats.test.mjs 2>&1 | tail -8
```
Expected: FAIL. The import of `CAD_CONVERSION_FORMATS` is undefined, and several tests fail.

- [ ] **Step 3: Implement in `lib/fileFormats.ts`.**

  **3a.** Delete the line `const SLDPRT_ADVICE: FormatAdvice = { app: 'SolidWorks', advice: 'Save As STEP, then upload.' };`.

  **3b.** Directly after the closing `};` of `ADVICE_BASE`, add:

```ts
export interface CadFormat extends FormatAdvice {
  /** How the viewer names one file: "Converting Inventor part…", "Converting JT model…". */
  noun: 'part' | 'model';
}

/**
 * Native CAD formats the CAD worker (cad-worker/, on Modal) converts to GLB, keyed by extension.
 * Once converted a file opens through its GLB (opensAsModel in lib/cadConversion.ts). A format
 * switched off by NEXT_PUBLIC_CAD_CONVERSION_FORMATS is refused with its advice instead.
 * Keep in step with CAD_EXTENSIONS in cad-worker/worker_core.py.
 */
export const CAD_CONVERSION_FORMATS: Readonly<Record<string, Readonly<CadFormat>>> = Object.freeze({
  sldprt: { app: 'SolidWorks', noun: 'part', advice: 'Save As STEP, then upload.' },
  ipt: { app: 'Inventor', noun: 'part', advice: EXPORT_STEP },
  catpart: { app: 'CATIA', noun: 'part', advice: EXPORT_STEP },
  prt: { app: 'NX or Creo', noun: 'part', advice: EXPORT_STEP },
  x_t: { app: 'Parasolid', noun: 'model', advice: EXPORT_STEP_FROM_TOOL },
  x_b: { app: 'Parasolid', noun: 'model', advice: EXPORT_STEP_FROM_TOOL },
  jt: { app: 'JT', noun: 'model', advice: EXPORT_STEP_FROM_TOOL },
  sat: { app: 'ACIS', noun: 'model', advice: EXPORT_STEP_FROM_TOOL },
});
```

  **3c.** Replace the `sldprtConversionEnabled` doc comment's first sentence with "The legacy SolidWorks-only switch, read only when NEXT_PUBLIC_CAD_CONVERSION_FORMATS is unset." Keep the function as is.

  **3d.** Replace the whole `formatTables` function and the `const TABLES = …` line with:

```ts
/**
 * Which converted formats are switched on. NEXT_PUBLIC_CAD_CONVERSION_FORMATS is a comma list
 * ('sldprt,ipt,jt') or 'off'; unset or blank, the legacy SolidWorks switch decides. Both are read
 * as literal process.env.NEXT_PUBLIC_… expressions so Next inlines them into the browser bundle:
 * the dropzone decides what to accept on the client. Pure given its arguments, for tests.
 */
export function enabledCadFormats(
  list: string | undefined = process.env.NEXT_PUBLIC_CAD_CONVERSION_FORMATS,
  legacy: string | undefined = process.env.NEXT_PUBLIC_SLDPRT_CONVERSION
): string[] {
  const value = (list ?? '').trim().toLowerCase();
  if (!value) return sldprtConversionEnabled(legacy) ? ['sldprt'] : [];
  if (value === 'off') return [];
  const names = value.split(',').map((s) => s.trim());
  // Own keys only: 'constructor' or '__proto__' in the env must not count as a format.
  const known = names.filter((n) => Object.prototype.hasOwnProperty.call(CAD_CONVERSION_FORMATS, n));
  return [...new Set(known)];
}

/**
 * The model list and the advice table for a set of enabled formats. Pure, for tests. An enabled
 * format joins the model list; a disabled one is refused with advice, and where ADVICE_BASE
 * already has a row for it (prt: 'NX / Creo / Solid Edge'), that row wins.
 */
export function formatTables(enabled: readonly string[]): { model: string[]; advice: Record<string, FormatAdvice> } {
  const on = new Set(enabled);
  const advice: Record<string, FormatAdvice> = {};
  for (const [ext, f] of Object.entries(CAD_CONVERSION_FORMATS)) {
    if (!on.has(ext)) advice[ext] = { app: f.app, advice: f.advice };
  }
  for (const [ext, a] of Object.entries(ADVICE_BASE)) {
    if (!on.has(ext)) advice[ext] = a;
  }
  const converted = Object.keys(CAD_CONVERSION_FORMATS).filter((ext) => on.has(ext));
  return { model: [...MODEL, ...converted], advice };
}

/** The converted formats switched on in this build. */
export const ENABLED_CAD_FORMATS: readonly string[] = enabledCadFormats();

const TABLES = formatTables(ENABLED_CAD_FORMATS);
```

  **3e.** In the `MODEL_FORMATS` doc comment, replace "A .sldprt opens through its converted GLB" with "A converted CAD format opens through its GLB".

  **3f.** Replace `extensionOf` and its doc comment with:

```ts
/** Creo saves each version as name.prt.<n> (also .asm.<n>, .drw.<n>): that is still a .prt. */
const CREO_VERSIONED = /.\.(prt|asm|drw)\.\d+$/i;

/**
 * The lowercased extension without its dot, or '' when there isn't one.
 *
 * Three cases the naive `split('.').pop()` gets wrong, and all actually occur:
 * a leading dot is a hidden file rather than an extension ('.DS_Store' lands in
 * every dropped macOS folder), the dropzone carries paths, so a dot in a
 * folder name ('Rev1.2/sheet') must not be read as one, and Creo's version
 * files ('bracket.prt.5') are .prt files.
 */
export function extensionOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const creo = CREO_VERSIONED.exec(base);
  if (creo) return creo[1].toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}
```

The `.` before `\.` in `CREO_VERSIONED` requires a character before `.prt`, so `.prt.5` falls through to `5`.

- [ ] **Step 4: Run the tests to verify they pass.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && node --test scripts/tests/fileFormats.test.mjs 2>&1 | tail -4
```
Expected: all pass. Then run `npm test 2>&1 | tail -4` and `npx tsc --noEmit`. Expected: other tests still pass. tsc may now report callers of `formatTables(boolean)`; fix any such call by passing a list (none are expected outside the test).

- [ ] **Step 5: Commit.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && git add lib/fileFormats.ts scripts/tests/fileFormats.test.mjs && git commit -m "feat(formats): table of converted CAD formats, per-format switch, Creo .prt.<n>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared helpers, upload trigger and units

**Files:**
- Modify: `lib/cadConversion.ts:1-26`
- Modify: `lib/measure/calibration.ts` (`assumedMmPerUnit`)
- Modify: `lib/useUpload.ts:8-9`, `lib/useUpload.ts:297-301`
- Test: `scripts/tests/cadConversion.test.mjs`, `scripts/tests/measureCalibration.test.mjs`

**Interfaces:**
- **Consumes:** `CAD_CONVERSION_FORMATS`, `ENABLED_CAD_FORMATS`, `extensionOf` and `CadFormat` from Task 3.
- **Produces, from `lib/cadConversion.ts`:**
  - `isCadFilename(filename: string): boolean`
  - `cadFormatEnabled(filename: string, enabled?: readonly string[]): boolean`
  - `cadLabel(filename: string): CadFormat | null`
  - `cadPreparingLabel(filename: string): string`
  - `isPendingCad` and `opensAsModel`, same signatures
- **Removes:** `isSldprtFilename`. Every caller moves to `isCadFilename` or `cadFormatEnabled`. After this task `grep -rn isSldprtFilename app lib components` must print nothing; Tasks 5 and 6 fix the remaining callers, and tsc points at them.

- [ ] **Step 1: Write the failing tests.** In `scripts/tests/cadConversion.test.mjs`:
  - In the import list, replace `isSldprtFilename` with `isCadFilename, cadFormatEnabled, cadLabel, cadPreparingLabel`.
  - Replace the first test (`'only .sldprt is a SolidWorks part, in any case'`) with:

```js
test('every converted format is a CAD file, in any case, enabled or not', () => {
  for (const n of ['a.sldprt', 'A.SLDPRT', 'dir/Part.SldPrt', 'b.ipt', 'c.CATPart', 'nx.prt', 'creo.prt.5', 'd.x_t', 'd.X_B', 'e.jt', 'f.sat']) {
    assert.equal(isCadFilename(n), true, n);
  }
  for (const n of ['a.sldasm', 'a.iam', 'a.asm.3', 'a.step', 'sldprt', '.sldprt', 'a.sldprt.glb', 'a.constructor', 'notes.5']) {
    assert.equal(isCadFilename(n), false, n);
  }
});

test('cadFormatEnabled follows the enabled list', () => {
  assert.equal(cadFormatEnabled('a.ipt', ['sldprt', 'ipt']), true);
  assert.equal(cadFormatEnabled('a.jt', ['sldprt', 'ipt']), false);
  assert.equal(cadFormatEnabled('creo.prt.5', ['prt']), true);
  assert.equal(cadFormatEnabled('a.step', ['sldprt']), false);
  // Default: this build's list, which with the env unset is SolidWorks only.
  assert.equal(cadFormatEnabled('a.sldprt'), true);
  assert.equal(cadFormatEnabled('a.ipt'), false);
});

test('cadLabel and cadPreparingLabel name the format', () => {
  assert.deepEqual(cadLabel('a.ipt'), { app: 'Inventor', noun: 'part', advice: 'Export STEP, then upload.' });
  assert.equal(cadLabel('a.step'), null);
  assert.equal(cadPreparingLabel('a.sldprt'), 'Preparing SolidWorks part…');
  assert.equal(cadPreparingLabel('creo.prt.5'), 'Preparing NX or Creo part…');
  assert.equal(cadPreparingLabel('m.jt'), 'Preparing JT model…');
  assert.equal(cadPreparingLabel('a.step'), 'Preparing file…');
});
```

  - In the next test (the `isPendingCad`/`opensAsModel` one), add these lines at the end of its body:

```js
  assert.equal(isPendingCad('a.ipt', null), true);
  assert.equal(opensAsModel('a.ipt', null), false);
  assert.equal(opensAsModel('creo.prt.5', 'k/creo.prt.5.glb'), true);
```

  - In `scripts/tests/measureCalibration.test.mjs`, replace the test `'SolidWorks parts are millimetres, because the worker writes them that way'` with:

```js
test('every converted CAD format is millimetres, because the worker writes them that way', () => {
  for (const n of ['bracket.sldprt', 'BRACKET.SLDPRT', 'a.ipt', 'a.catpart', 'a.prt', 'a.prt.5', 'a.x_t', 'a.x_b', 'a.jt', 'a.sat']) {
    assert.equal(assumedMmPerUnit(n), 1, n);
  }
  assert.equal(assumedMmPerUnit('assembly.sldasm'), null);
  assert.equal(assumedMmPerUnit('a.constructor'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && node --test scripts/tests/cadConversion.test.mjs scripts/tests/measureCalibration.test.mjs 2>&1 | tail -6
```
Expected: FAIL, because `isCadFilename` is not a function.

- [ ] **Step 3: Implement `lib/cadConversion.ts`.** Replace lines 1–26 (the imports through `opensAsModel`) with:

```ts
import {
  CAD_CONVERSION_FORMATS,
  ENABLED_CAD_FORMATS,
  extensionOf,
  MODEL_FORMATS,
  type CadFormat,
} from './fileFormats.ts';

/**
 * Native CAD parts (SolidWorks, Inventor, CATIA, NX/Creo, Parasolid, JT, ACIS) are shown as GLBs:
 * the CAD worker (cad-worker/, on Modal) converts each one once, and the GLB becomes the file's
 * converted_storage_key. These are the rules around that, kept pure so they can be tested and
 * shared by the routes, the viewer and the portal page. The worker and the claim/callback protocol
 * are in docs/superpowers/specs/2026-10-18-sldprt-conversion-design.md; the format table in
 * docs/superpowers/specs/2026-11-19-more-cad-formats-design.md.
 */

/** Any format the worker converts, switched on or not: a converted file must keep opening. */
export function isCadFilename(filename: string): boolean {
  return Object.prototype.hasOwnProperty.call(CAD_CONVERSION_FORMATS, extensionOf(filename));
}

/** Whether this build converts the file's format (NEXT_PUBLIC_CAD_CONVERSION_FORMATS). */
export function cadFormatEnabled(filename: string, enabled: readonly string[] = ENABLED_CAD_FORMATS): boolean {
  return isCadFilename(filename) && enabled.includes(extensionOf(filename));
}

/** The app, noun and fallback advice for a CAD file, or null for anything else. */
export function cadLabel(filename: string): CadFormat | null {
  return isCadFilename(filename) ? CAD_CONVERSION_FORMATS[extensionOf(filename)] : null;
}

/** The portal's loading text while a CAD file has no GLB yet. */
export function cadPreparingLabel(filename: string): string {
  const label = cadLabel(filename);
  return label ? `Preparing ${label.app} ${label.noun}…` : 'Preparing file…';
}

/** A CAD file with no GLB yet: converting, deferred, failed, or switched off. */
export function isPendingCad(filename: string, convertedStorageKey: string | null): boolean {
  return isCadFilename(filename) && !convertedStorageKey;
}

/**
 * Whether the 3D viewer shows this file. A CAD file only through its GLB, whatever the switch
 * says, so files converted before a switch-off keep working.
 */
export function opensAsModel(filename: string, convertedStorageKey: string | null): boolean {
  if (isCadFilename(filename)) return !!convertedStorageKey;
  return MODEL_FORMATS.includes(extensionOf(filename));
}
```
Leave the rest of the file (claims onward) unchanged. In the `monthlyCap` doc comment, change "SLDPRT_MONTHLY_CAP as a whole number of conversions" to "SLDPRT_MONTHLY_CAP (shared by every converted format, despite its name) as a whole number of conversions".

- [ ] **Step 4: Implement `lib/measure/calibration.ts`.**
  - Change the import line to `import { CAD_CONVERSION_FORMATS, extensionOf } from '../fileFormats.ts';`.
  - Replace the body of `assumedMmPerUnit` with:

```ts
  const ext = extensionOf(filename);
  // The CAD worker writes every format it converts in millimetres, whatever unit it was drawn in.
  if (Object.prototype.hasOwnProperty.call(CAD_CONVERSION_FORMATS, ext)) return 1;
  switch (ext) {
    case 'step':
    case 'stp':
    case 'igs':
    case 'iges':
      return 1;
    case 'glb':
    case 'gltf':
      return 1000;
    default:
      return null;
  }
```

- [ ] **Step 5: Implement `lib/useUpload.ts`.**
  - Replace the two imports at lines 8–9 (`isSldprtFilename` and `sldprtConversionEnabled`) with the single line `import { cadFormatEnabled } from '@/lib/cadConversion';`.
  - Replace the SolidWorks block at lines 297–301 with:

```ts
        // Native CAD (SolidWorks, Inventor, …): start the GLB conversion now; nothing waits on it,
        // and the viewer starts it again if this is lost.
        if (cadFormatEnabled(entry.file.name)) {
          fetch(`/api/files/${fileId}/convert-cad`, { method: 'POST', keepalive: true }).catch(() => {});
        }
```

- [ ] **Step 6: Run the tests and tsc.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && npm test 2>&1 | tail -4 && npx tsc --noEmit 2>&1 | head
```
Expected: node tests all pass. tsc reports `isSldprtFilename` and `sldprtConversionEnabled` missing in `app/api/files/[id]/convert-cad/route.ts`, which is fixed in Task 5 and nowhere else. If tsc names any other file, fix it in this task.

- [ ] **Step 7: Commit.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && git add lib/cadConversion.ts lib/measure/calibration.ts lib/useUpload.ts scripts/tests/cadConversion.test.mjs scripts/tests/measureCalibration.test.mjs && git commit -m "feat(cad): format-neutral CAD helpers, upload trigger and millimetre units

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Routes

**Files:**
- Modify: `app/api/files/[id]/convert-cad/route.ts`
- Modify: `app/api/conversions/cad-callback/route.ts`
- Modify: `lib/storageKeys.ts:150-151` (comment)
- Scratch only: a PGlite route harness in the session scratchpad. Never in the repo.

**Interfaces:**
- **Consumes:** `isCadFilename` and `cadFormatEnabled` from Task 4.
- **Produces:** the HTTP behaviour.
  - `POST /api/files/:id/convert-cad` answers 400 `{error: 'Not a convertible CAD file'}` for a non-CAD file.
  - It answers 503 `{reason: 'disabled'}` for a CAD format not in this build's list.
  - Otherwise it behaves exactly as before.

- [ ] **Step 1: Edit `convert-cad/route.ts`.**
  - **Imports:** delete the line `import { sldprtConversionEnabled } from '@/lib/fileFormats';`. In the `@/lib/cadConversion` import list, replace `isSldprtFilename,` with `cadFormatEnabled,` and `isCadFilename,`, keeping the list alphabetical.
  - **Comment:** change "Start converting one SolidWorks part to GLB" to "Start converting one native CAD part (SolidWorks, Inventor, CATIA, NX/Creo, Parasolid, JT, ACIS) to GLB". Change "whenever a .sldprt" to "whenever a CAD file".
  - **The 400 check:** replace
    ```ts
      if (!isSldprtFilename(file.filename)) {
        return NextResponse.json({ error: 'Not a SolidWorks part' }, { status: 400 });
      }
    ```
    with
    ```ts
      if (!isCadFilename(file.filename)) {
        return NextResponse.json({ error: 'Not a convertible CAD file' }, { status: 400 });
      }
    ```
  - **The switch check:** replace `if (!sldprtConversionEnabled()) {` with `if (!cadFormatEnabled(file.filename)) {`.
  - **Log lines:** in the three `console.error` strings, replace `SolidWorks conversion` with `CAD conversion`.

- [ ] **Step 2: Edit `cad-callback/route.ts`.** In its four log strings (`console.error`/`console.warn`), replace `SolidWorks callback` with `CAD callback` and `SolidWorks conversion` with `CAD conversion`. Change nothing else.

- [ ] **Step 3: Edit `lib/storageKeys.ts`.** In the `cadGlbKey` comment, replace "Where a SolidWorks part's converted GLB lives" with "Where a native CAD part's converted GLB lives".

- [ ] **Step 4: Check that no SolidWorks-only code is left.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && grep -rnE "isSldprtFilename|sldprtConversionEnabled" app lib components | grep -v "lib/fileFormats.ts"; npx tsc --noEmit && echo TSC-OK
```
Expected: no grep output, then `TSC-OK`.

- [ ] **Step 5: Run the routes for real on PGlite.** Build the harness in the session scratchpad following the memory note "PGlite SQL harness" (`stiko-pglite-sql-harness`). It needs:
  - **Database:** PGlite loaded with `lib/schema.sql`.
  - **Loader hook:** an ESM loader hook (`--import ./register.mjs --experimental-strip-types`) that resolves `@/…` to the worktree, retries bare specifiers with `.js`, and stubs `@/lib/db` (a `sql` tagged template over PGlite), `@/lib/auth` (returns `globalThis.__session`) and `@/lib/s3` (presign functions return `https://acct.r2.cloudflarestorage.com/<key>?sig`).
  - **Worker stub:** `globalThis.fetch` returns `new Response(JSON.stringify({callId: 'fc-1'}), {status: 200})`.
  - **Env:** `CAD_WORKER_URL=https://w.example/start`, `CAD_WORKER_SECRET=s`, `NEXT_PUBLIC_APP_URL=https://app.stiko.design`.
  - **Data:** insert a user, project, portal/version and file rows. Copy the insert shapes from the October harness: user owns the project, the file belongs to the version.

  Run each scenario as a separate `node` process, because `ENABLED_CAD_FORMATS` is fixed when the module loads:

  | # | Env `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` | File | Expect |
  |---|---|---|---|
  | 1 | `sldprt,ipt,prt` | `notes.pdf` | 400, `error: 'Not a convertible CAD file'` |
  | 2 | `sldprt,ipt,prt` | `m.jt` | 503, `reason: 'disabled'`, row unchanged (`conversion_job_id` NULL) |
  | 3 | `sldprt,ipt,prt` | `bracket.ipt` | 200 `processing`; row has `conversion_job_id` like `cad:1:%`; the stubbed worker got `filename: 'bracket.ipt'` and a `targetUrl` for `<storage_key>.glb` |
  | 4 | `sldprt,ipt,prt` | `creo.prt.5` | 200 `processing`, and the worker got `filename: 'creo.prt.5'` |
  | 5 | unset | `bracket.ipt` | 503 `disabled` (legacy = SolidWorks only) |
  | 6 | unset | `a.sldprt` | 200 `processing` (unchanged behaviour) |
  | 7 | `sldprt,ipt` | `bracket.ipt` with a valid callback POST to `cad-callback` (HMAC from `lib/cadWorkerToken.ts`), `ok: true`, `glbBytes: 10` | 200; row `completed`, `converted_storage_key` = `<storage_key>.glb` |

  Also re-run the October scenarios that still apply (claim race, stale reclaim, attempt-3 cutoff, cap reached) once with an `.ipt` file. Expected: identical results to `.sldprt`.

- [ ] **Step 6: Commit.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && git add "app/api/files/[id]/convert-cad/route.ts" app/api/conversions/cad-callback/route.ts lib/storageKeys.ts && git commit -m "feat(cad): convert-cad and its callback serve every enabled CAD format

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Viewer and portal copy

**Files:**
- Modify: `components/viewers/CadPreparer.tsx` (Props, the `lines` table)
- Modify: `components/viewers/ViewerContainer.tsx:163-164`, `:208-213`
- Modify: `app/portal/[id]/page.tsx` (comments at 705 and 724, label at 2472, import at 58)

**Interfaces:**
- **Consumes:** `cadLabel` and `cadPreparingLabel` from Task 4.
- **Produces:** `CadPreparer` takes a new required prop, `filename: string`.

- [ ] **Step 1: Edit `CadPreparer.tsx`.**
  - **Import:** add `cadLabel` to the `@/lib/cadConversion` import.
  - **Props:** add as the second field of `interface Props`:
    ```ts
      /** The original upload's name: decides the format's name and advice in the messages. */
      filename: string;
    ```
  - **Component signature:** add `filename` to the destructured props.
  - **Doc comment:** change "Shown for a .sldprt that has no GLB yet" to "Shown for a native CAD file that has no GLB yet".
  - **Messages:** replace the whole `const lines = { … };` block with:

```tsx
  // ViewerContainer only mounts this for a CAD file, so cadLabel is never null in practice.
  const { app, noun, advice } = cadLabel(filename) ?? { app: 'CAD', noun: 'model', advice: 'Export STEP, then upload.' };
  const lines: Record<View['kind'], [string, string | null]> = {
    converting: [`Converting ${app} ${noun}…`, 'The first one after a quiet spell can take a couple of minutes.'],
    failed: [`Couldn't convert this ${app} ${noun}.`, advice],
    deferred: ['', advice],
    disabled: [`${app} preview is turned off.`, advice],
    unavailable: [`${app} preview isn't available right now.`, `Try again in a few minutes. ${advice}`],
    slow: ['Still converting.', 'Check back in a few minutes.'],
  };
```

- [ ] **Step 2: Edit `ViewerContainer.tsx`.**
  - Change the comment at line 163 to `// A CAD file (SolidWorks, Inventor, …) is shown through its GLB; until that exists it is pending.`
  - In the `<CadPreparer` element, add `filename={file.filename}` after `fileId={file.id}`.

- [ ] **Step 3: Edit `app/portal/[id]/page.tsx`.**
  - **Import (line 58):** `import { cadPreparingLabel, isPendingCad, opensAsModel } from '@/lib/cadConversion';`.
  - **Line 705 comment:** "A CAD file counts only once its GLB exists; until then there is no model to measure or pin."
  - **Line 724 comment:** "A CAD file whose GLB does not exist yet (converting, deferred, failed, or switched off)."
  - **Line 988 comment:** "(or a CAD part's GLB)" instead of "(or a SolidWorks part's GLB)".
  - **Label:** replace `? 'Preparing SolidWorks part…'` with `? cadPreparingLabel(selectedFile?.filename ?? '')`.

- [ ] **Step 4: tsc, lint and tests.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -3
```
Expected: no tsc errors, no new lint errors, all tests pass.

- [ ] **Step 5: Browser check.** Use the local-visual-verification harness (memory note `stiko-local-visual-verification`); never upload. Serve two GLBs from Task 2 (one `.ipt`, one `.jt`) through `ViewerContainer` with `convertedStorageKey` set, and confirm each renders. Then mount `CadPreparer` with `filename='bracket.ipt'` and `filename='m.jt'`. Stub `POST /api/files/:id/convert-cad` and the status poll so it shows, in turn:
  - converting → "Converting Inventor part…"
  - failed → "Couldn't convert this Inventor part." / "Export STEP, then upload."
  - deferred → "Preview available from …" / advice
  - disabled → "JT preview is turned off." / "Export STEP from your CAD tool, then upload."
  - unavailable

  Screenshot each.

- [ ] **Step 6: Commit.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && git add components/viewers/CadPreparer.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx" && git commit -m "feat(cad): viewer and portal name the CAD format they are preparing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final gates and release notes

**Files:**
- Modify: `docs/superpowers/specs/2026-11-19-more-cad-formats-design.md` (Release, step 2: the real list from Task 2)

- [ ] **Step 1: Run every gate.**

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -3 && /tmp/stiko-cadw/bin/python -m pytest -q cad-worker/tests 2>&1 | tail -2 && NEXT_PUBLIC_CAD_CONVERSION_FORMATS=sldprt,ipt,catpart,prt,x_t,x_b,jt,sat npm run build 2>&1 | tail -5
```
Expected: everything passes, and the build ends with the route table.

- [ ] **Step 2: Check the build actually inlined the switch.** After the build, check that the client bundle contains the enabled list:

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && grep -rl "sldprt,ipt,catpart" .next/static | head -2
```
Expected: at least one file. If none, `enabledCadFormats`'s default argument is not being inlined. Stop and report.

- [ ] **Step 3: Put the real release list in the spec.** In the spec's Release step 2, replace the example list with the formats that passed Task 2. Commit:

```bash
cd /Users/user/Desktop/STIKO-more-cad-formats && git add docs/superpowers/specs/2026-11-19-more-cad-formats-design.md && git commit -m "docs(spec): release list from the real-file test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Stop.** Do not deploy the worker, set env vars, merge or push. Those are the user's release steps, in the spec's Release section:
  1. `modal deploy cad-worker/app.py`.
  2. Set `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` on Vercel.
  3. Merge with `--no-ff` and push.
  4. Upload one real file per format.

  **Rollback:** remove formats from the variable and redeploy. Never `git revert`.
