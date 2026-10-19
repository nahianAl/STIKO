# SolidWorks parts shown as GLB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `.sldprt` upload is converted once to a millimetre, Y-up GLB on a Modal T4 worker running NVIDIA `usd-convert-cad`. The GLB becomes the file's `converted_storage_key`, so the existing 3D viewer shows it.

**Architecture:** The worker lives in `cad-worker/`, a Python Modal app with no Stiko credentials.
- A CPU endpoint checks a shared secret and spawns a GPU job.
- The GPU job downloads from a presigned URL, runs `usd-convert-cad` and then our own `usd_to_glb.py`, uploads the GLB to a presigned URL, and POSTs a signed callback.
- On the Next side, `POST /api/files/[id]/convert-cad` claims the row and starts the job, and `POST /api/conversions/cad-callback` records the result.
- The viewer's `CadPreparer` polls the existing `conversion-status` route.
- Pure rules live in `lib/cadConversion.ts`.

**Tech Stack:**
- Next.js 14 App Router
- TypeScript under `node --test`
- Neon SQL tagged templates
- Python 3.12 on Modal 1.x with `usd-convert-cad==0.3.0`, Pixar `usd-core==26.8` and `numpy==2.5.4`
- pytest

**Spec:** `docs/superpowers/specs/2026-10-18-sldprt-conversion-design.md` (commit 9e5b762).

## Global Constraints

- **Scope:** `.sldprt` only. `.sldasm` and every other native format keep their export advice.
- **Switch:** `NEXT_PUBLIC_SLDPRT_CONVERSION`. Anything other than `off` (trimmed, any case) means on. It must be read as the literal expression `process.env.NEXT_PUBLIC_SLDPRT_CONVERSION` so Next inlines it.
- **Cap:** `SLDPRT_MONTHLY_CAP` defaults to 300. Claims are counted with `LIKE 'cad:%:YYYY-MM-%'`.
- **Claim format:** `cad:<attempt>:<ISO time>`.
  - Stale after 15 minutes (`CAD_CLAIM_STALE_MS = 900_000`).
  - `CAD_MAX_ATTEMPTS = 3`.
  - `failed` is never retried.
- **Polling:** `CAD_POLL_INTERVAL_MS = 3000`, `CAD_POLL_LIMIT_MS = 300_000`.
- **Presigned URLs:** 60 minutes (3600 s). The worker's download cap is 200 MB. The GPU function times out at 600 s.
- **GLB key:** `cadGlbKey('…/abc.sldprt')` → `'…/abc.sldprt.glb'`.
- **GLB contents:** millimetres (1 unit = 1 mm), Y-up. One node per USD mesh, named `Body N`, with `extras.stikoPart = true`.
- **Units in the viewer:** `assumedMmPerUnit('x.sldprt') === 1`.
- **Env vars on stiko:**
  - `CAD_WORKER_URL` (https; http only for localhost)
  - `CAD_WORKER_SECRET`
  - `SLDPRT_MONTHLY_CAP`
  - `NEXT_PUBLIC_SLDPRT_CONVERSION`
  - The callback base URL comes from `appBaseUrl()` (NEXTAUTH_URL / APP_URL), **never** from the request.
- **Modal secret** `stiko-cad-worker`:
  - `CAD_WORKER_SECRET`
  - `WORKER_STORAGE_HOSTS=.r2.cloudflarestorage.com`
  - `WORKER_CALLBACK_HOSTS=app.stiko.design`
- **Imports:** no `@/` imports in modules under `node --test`, and `lib/queries` types only via `import type` (memory: stiko-node-test-imports).
- **Calibrations:** every place that sets `converted_storage_key` also deletes `file_calibrations` for the file, in its own try/catch.
- **Git:** never `git add -A` or `git add .`; add named paths only (memory: stiko-never-git-add-all). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **The app has no attributions/legal page.** NVIDIA's required notice goes in `cad-worker/NOTICE`, deliberately differing from the spec's "attributions or legal page"; this is called out to the user at release.

## File structure

| File | Responsibility |
|---|---|
| `cad-worker/usd_to_glb.py` (create) | USD stage → GLB (mm, Y-up, per-colour primitives, part markers). CLI exit 3 = verdict on the file |
| `cad-worker/worker_core.py` (create) | Stdlib-only job logic: validate request, capped download, run the converters, PUT, callback with retry |
| `cad-worker/app.py` (create) | Modal wiring: images, secret, CPU `start` endpoint, GPU `convert_job`, `smoke` entrypoint |
| `cad-worker/README.md`, `cad-worker/NOTICE`, `cad-worker/requirements-dev.txt` (create) | Runbook, NVIDIA notice and licence terms in use, test deps |
| `cad-worker/tests/test_usd_to_glb.py`, `cad-worker/tests/test_worker_core.py` (create) | pytest |
| `lib/fileFormats.ts` (modify) | `sldprtConversionEnabled()`, `formatTables(enabled)`; `sldprt` moves between MODEL and advice |
| `lib/cadConversion.ts` (create) | Pure rules: filename checks, claim ids and decisions, cap, outcomes, polling |
| `lib/cadWorkerToken.ts` (create) | Server-only HMAC for the callback token |
| `lib/storageKeys.ts` (modify) | `cadGlbKey()` |
| `lib/measure/calibration.ts` (modify) | `sldprt → 1` |
| `lib/routeAccess.ts` (modify) | `/api/conversions/cad-callback` public |
| `app/api/files/[id]/convert-cad/route.ts` (create) | Claim + start the worker |
| `app/api/conversions/cad-callback/route.ts` (create) | Record the worker's result |
| `components/viewers/CadPreparer.tsx` (create) | Waiting/failed/deferred/disabled states, polling |
| `components/viewers/ViewerContainer.tsx`, `app/portal/[id]/page.tsx`, `lib/useUpload.ts` (modify) | Wiring |
| `scripts/tests/cadConversion.test.mjs`, `scripts/tests/cadWorkerToken.test.mjs` (create); `fileFormats`, `storageKeys`, `measureCalibration`, `routeAccess` tests (modify) | node tests |

---

### Task 1: USD → GLB converter

**Files:**
- Create: `cad-worker/usd_to_glb.py`
- Create: `cad-worker/requirements-dev.txt`
- Test: `cad-worker/tests/test_usd_to_glb.py`

**Interfaces:**
- Produces:
  - `convert(usd_path: str, glb_path: str) -> dict` returning `{meshes, materials, triangles, bytes}`; raises `ConversionError(reason)`.
  - CLI `python usd_to_glb.py in.usdc out.glb`: exit 0 prints the dict as JSON; exit 3 prints the reason to stderr.

- [ ] **Step 1: Set up the test environment**

`cad-worker/requirements-dev.txt`:
```
usd-core==26.8
numpy==2.5.4
pytest==8.4.2
```
Run:
```bash
python3 -m venv /tmp/cadworker-venv && /tmp/cadworker-venv/bin/pip install -q -r cad-worker/requirements-dev.txt
```

- [ ] **Step 2: Write the failing tests** — `cad-worker/tests/test_usd_to_glb.py`

```python
"""usd_to_glb on small hand-built USD stages. Run: /tmp/cadworker-venv/bin/python -m pytest -q cad-worker/tests"""
import json
import os
import struct
import subprocess
import sys

import pytest
from pxr import Gf, Sdf, Usd, UsdGeom, Vt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import usd_to_glb  # noqa: E402

CUBE_POINTS = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
CUBE_COUNTS = [4] * 6
CUBE_INDICES = [0, 3, 2, 1, 4, 5, 6, 7, 0, 1, 5, 4, 2, 3, 7, 6, 1, 2, 6, 5, 0, 4, 7, 3]


def stage(tmp_path, *, mpu=0.001, up='Y', size=10.0, meshes=1, colors=None, uniform=None,
          left=False, invisible=False, normals=True):
    path = str(tmp_path / 'in.usda')
    s = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageMetersPerUnit(s, mpu)
    UsdGeom.SetStageUpAxis(s, UsdGeom.Tokens.y if up == 'Y' else UsdGeom.Tokens.z)
    for i in range(meshes):
        m = UsdGeom.Mesh.Define(s, f'/Part/Body{i}/Mesh')
        m.CreatePointsAttr([Gf.Vec3f(*(c * size for c in p)) for p in CUBE_POINTS])
        m.CreateFaceVertexCountsAttr(CUBE_COUNTS)
        m.CreateFaceVertexIndicesAttr(CUBE_INDICES)
        if i:
            UsdGeom.Xformable(s.GetPrimAtPath(f'/Part/Body{i}')).AddTranslateOp().Set(Gf.Vec3d(size * 2 * i, 0, 0))
        if left:
            m.CreateOrientationAttr(UsdGeom.Tokens.leftHanded)
        if invisible:
            m.CreateVisibilityAttr(UsdGeom.Tokens.invisible)
        pv = UsdGeom.PrimvarsAPI(m.GetPrim())
        if colors is not None:
            pv.CreatePrimvar('displayColor', Sdf.ValueTypeNames.Color3fArray, UsdGeom.Tokens.constant).Set([Gf.Vec3f(*colors)])
        if uniform is not None:
            p = pv.CreatePrimvar('displayColor', Sdf.ValueTypeNames.Color3fArray, UsdGeom.Tokens.uniform)
            p.Set([Gf.Vec3f(*c) for c in uniform['values']])
            p.SetIndices(Vt.IntArray(uniform['indices']))
        if normals:
            n = pv.CreatePrimvar('normals', Sdf.ValueTypeNames.Normal3fArray, UsdGeom.Tokens.faceVarying)
            face_normals = [(0, 0, -1), (0, 0, 1), (0, -1, 0), (0, 1, 0), (1, 0, 0), (-1, 0, 0)]
            n.Set([Gf.Vec3f(*face_normals[f]) for f in range(6) for _ in range(4)])
    s.GetRootLayer().Save()
    return path


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, total = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2 and total == len(data)
    jlen, jtype = struct.unpack_from('<II', data, 12)
    assert jtype == 0x4E4F534A
    gltf = json.loads(data[20:20 + jlen])
    blen, btype = struct.unpack_from('<II', data, 20 + jlen)
    assert btype == 0x004E4942
    return gltf, data[28 + jlen:28 + jlen + blen]


def bounds(gltf):
    lo, hi = [float('inf')] * 3, [float('-inf')] * 3
    for mesh in gltf['meshes']:
        for p in mesh['primitives']:
            a = gltf['accessors'][p['attributes']['POSITION']]
            lo = [min(x, y) for x, y in zip(lo, a['min'])]
            hi = [max(x, y) for x, y in zip(hi, a['max'])]
    return lo, hi


def test_millimetre_stage_keeps_its_size(tmp_path):
    out = str(tmp_path / 'o.glb')
    info = usd_to_glb.convert(stage(tmp_path), out)
    gltf, _ = read_glb(out)
    lo, hi = bounds(gltf)
    assert [round(h - l, 4) for l, h in zip(lo, hi)] == [10.0, 10.0, 10.0]
    assert info['triangles'] == 12 and info['meshes'] == 1


def test_inch_stage_is_scaled_to_millimetres(tmp_path):
    out = str(tmp_path / 'o.glb')
    usd_to_glb.convert(stage(tmp_path, mpu=0.0254, size=1.0), out)
    lo, hi = bounds(read_glb(out)[0])
    assert [round(h - l, 3) for l, h in zip(lo, hi)] == [25.4, 25.4, 25.4]


def test_constant_colour_is_one_primitive_with_that_colour(tmp_path):
    out = str(tmp_path / 'o.glb')
    usd_to_glb.convert(stage(tmp_path, colors=(1.0, 0.0, 0.0)), out)
    gltf, _ = read_glb(out)
    prims = gltf['meshes'][0]['primitives']
    assert len(prims) == 1
    assert gltf['materials'][prims[0]['material']]['pbrMetallicRoughness']['baseColorFactor'][:3] == [1.0, 0.0, 0.0]


def test_per_face_colours_become_one_primitive_per_colour(tmp_path):
    out = str(tmp_path / 'o.glb')
    uniform = {'values': [(1, 0, 0), (0, 0, 1)], 'indices': [0, 0, 0, 1, 1, 1]}
    usd_to_glb.convert(stage(tmp_path, uniform=uniform), out)
    gltf, _ = read_glb(out)
    prims = gltf['meshes'][0]['primitives']
    colours = sorted(tuple(gltf['materials'][p['material']]['pbrMetallicRoughness']['baseColorFactor'][:3]) for p in prims)
    assert colours == [(0.0, 0.0, 1.0), (1.0, 0.0, 0.0)]
    assert sum(gltf['accessors'][p['indices']]['count'] for p in prims) == 36


def test_normals_are_carried(tmp_path):
    out = str(tmp_path / 'o.glb')
    usd_to_glb.convert(stage(tmp_path), out)
    assert all('NORMAL' in p['attributes'] for p in read_glb(out)[0]['meshes'][0]['primitives'])


def test_missing_normals_are_allowed(tmp_path):
    out = str(tmp_path / 'o.glb')
    usd_to_glb.convert(stage(tmp_path, normals=False), out)
    assert all('NORMAL' not in p['attributes'] for p in read_glb(out)[0]['meshes'][0]['primitives'])


def _first_triangle_normal(gltf, binary):
    p = gltf['meshes'][0]['primitives'][0]
    pos_acc = gltf['accessors'][p['attributes']['POSITION']]
    idx_acc = gltf['accessors'][p['indices']]
    pv, iv = gltf['bufferViews'][pos_acc['bufferView']], gltf['bufferViews'][idx_acc['bufferView']]
    fmt = '<H' if idx_acc['componentType'] == 5123 else '<I'
    step = 2 if fmt == '<H' else 4
    tri = [struct.unpack_from(fmt, binary, iv['byteOffset'] + k * step)[0] for k in range(3)]
    pts = [struct.unpack_from('<fff', binary, pv['byteOffset'] + t * 12) for t in tri]
    a = [pts[1][i] - pts[0][i] for i in range(3)]
    b = [pts[2][i] - pts[0][i] for i in range(3)]
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def test_left_handed_meshes_are_rewound(tmp_path):
    rdir, ldir = tmp_path / 'r', tmp_path / 'l'
    rdir.mkdir()
    ldir.mkdir()
    right, left = str(rdir / 'o.glb'), str(ldir / 'o.glb')
    usd_to_glb.convert(stage(rdir, normals=False), right)
    usd_to_glb.convert(stage(ldir, normals=False, left=True), left)
    nr = _first_triangle_normal(*read_glb(right))
    nl = _first_triangle_normal(*read_glb(left))
    assert nr == tuple(-v for v in nl)


def test_each_mesh_is_a_marked_body(tmp_path):
    out = str(tmp_path / 'o.glb')
    usd_to_glb.convert(stage(tmp_path, meshes=2), out)
    gltf, _ = read_glb(out)
    assert [n['name'] for n in gltf['nodes']] == ['Body 1', 'Body 2']
    assert all(n['extras'] == {'stikoPart': True} for n in gltf['nodes'])
    lo, hi = bounds(gltf)
    assert round(hi[0] - lo[0], 4) == 30.0  # second body translated by 20 mm


def test_invisible_only_stage_is_a_verdict(tmp_path):
    with pytest.raises(usd_to_glb.ConversionError, match='no visible mesh'):
        usd_to_glb.convert(stage(tmp_path, invisible=True), str(tmp_path / 'o.glb'))


def test_z_up_stage_is_refused(tmp_path):
    with pytest.raises(usd_to_glb.ConversionError, match='Y-up'):
        usd_to_glb.convert(stage(tmp_path, up='Z'), str(tmp_path / 'o.glb'))


def test_cli_exit_codes(tmp_path):
    script = os.path.join(os.path.dirname(HERE), 'usd_to_glb.py')
    ok = subprocess.run([sys.executable, script, stage(tmp_path), str(tmp_path / 'o.glb')], capture_output=True, text=True)
    assert ok.returncode == 0 and json.loads(ok.stdout)['meshes'] == 1
    bad_dir = tmp_path / 'bad'
    bad_dir.mkdir()
    bad = subprocess.run([sys.executable, script, stage(bad_dir, invisible=True), str(bad_dir / 'o.glb')], capture_output=True, text=True)
    assert bad.returncode == 3 and 'no visible mesh' in bad.stderr
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `/tmp/cadworker-venv/bin/python -m pytest -q cad-worker/tests/test_usd_to_glb.py`
Expected: collection error, `ModuleNotFoundError: No module named 'usd_to_glb'`.

- [ ] **Step 4: Implement** — `cad-worker/usd_to_glb.py`

```python
"""USD (from usd-convert-cad) -> GLB in millimetres, Y-up.

One glTF node and mesh per USD mesh, named `Body N` and stamped `extras.stikoPart = true` (the
marker lib/model/partTree.ts reads; SolidWorks body names do not survive usd-convert-cad). World
transforms and the stage's metersPerUnit are baked into the positions, so one unit is one
millimetre whatever unit the part was drawn in. Each mesh is split into one primitive per distinct
colour, so per-face colours (displayColor with uniform interpolation) survive as materials.

usd2gltf was tried first and rejected: it crashes on indexed per-face colours and writes GLBs
2-7x larger (real-file test, 2026-10-18).

CLI: python usd_to_glb.py in.usdc out.glb  ->  exit 0 and a JSON summary, or exit 3 and the
reason on stderr when the stage cannot become a GLB (a verdict on the file, not a crash).
"""

import json
import struct
import sys

import numpy as np
from pxr import Usd, UsdGeom, UsdShade

DEFAULT_COLOR = (0.8, 0.8, 0.8)
PART_MARKER = 'stikoPart'


class ConversionError(Exception):
    """The stage cannot become a GLB. The message is the reason reported to Stiko."""


def _material_color(prim):
    """diffuseColor of the bound UsdPreviewSurface, if any."""
    material, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
    if not material:
        return None
    shader = material.ComputeSurfaceSource()[0]
    if not shader:
        return None
    inp = shader.GetInput('diffuseColor')
    value = inp.Get() if inp else None
    return tuple(float(v) for v in value) if value is not None else None


def _face_colors(prim, face_count):
    """One RGB per face: displayColor (constant or uniform), else the material, else grey."""
    pv = UsdGeom.PrimvarsAPI(prim).GetPrimvar('displayColor')
    if pv and pv.HasAuthoredValue():
        values = pv.ComputeFlattened()
        if values is not None and len(values) > 0:
            arr = np.asarray(values, dtype=np.float64).reshape(-1, 3)
            interp = pv.GetInterpolation()
            if interp == UsdGeom.Tokens.constant or len(arr) == 1:
                return np.repeat(arr[:1], face_count, axis=0)
            if interp == UsdGeom.Tokens.uniform and len(arr) == face_count:
                return arr
    color = _material_color(prim) or DEFAULT_COLOR
    return np.repeat(np.asarray([color], dtype=np.float64), face_count, axis=0)


def _normals(prim, counts, indices, xf):
    """Per face-vertex world-space normals, or None when the mesh authors none we can map."""
    # usd-convert-cad authors indexed primvars:normals; fall back to the plain attribute.
    pv = UsdGeom.PrimvarsAPI(prim).GetPrimvar('normals')
    if pv and pv.HasAuthoredValue():
        raw, interp = pv.ComputeFlattened(), pv.GetInterpolation()
    else:
        mesh = UsdGeom.Mesh(prim)
        attr = mesh.GetNormalsAttr()
        raw, interp = (attr.Get() if attr else None), mesh.GetNormalsInterpolation()
    if raw is None or len(raw) == 0:
        return None
    n = np.asarray(raw, dtype=np.float64).reshape(-1, 3)
    total = int(counts.sum())
    if interp == UsdGeom.Tokens.faceVarying and len(n) == total:
        per_fv = n
    elif interp in (UsdGeom.Tokens.vertex, UsdGeom.Tokens.varying) and len(n) > int(indices.max()):
        per_fv = n[indices]
    elif interp == UsdGeom.Tokens.uniform and len(n) == len(counts):
        per_fv = np.repeat(n, counts, axis=0)
    else:
        return None
    # Normals transform by the inverse transpose of the upper 3x3 (row-vector convention).
    out = per_fv @ np.linalg.inv(xf[:3, :3])
    length = np.linalg.norm(out, axis=1, keepdims=True)
    length[length == 0] = 1
    return out / length


def _triangulate(counts):
    """Fan triangles as positions into the face-vertex arrays, and the face each came from."""
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    tri_fv, tri_face = [], []
    for f in np.nonzero(counts >= 3)[0]:
        s, c = int(starts[f]), int(counts[f])
        for k in range(1, c - 1):
            tri_fv.append((s, s + k, s + k + 1))
            tri_face.append(f)
    return np.asarray(tri_fv, dtype=np.int64).reshape(-1, 3), np.asarray(tri_face, dtype=np.int64)


def convert(usd_path, glb_path):
    stage = Usd.Stage.Open(usd_path)
    if UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.y:
        raise ConversionError('expected a Y-up stage (usd-convert-cad --up-axis y)')
    mm_per_unit = UsdGeom.GetStageMetersPerUnit(stage) * 1000.0
    cache = UsdGeom.XformCache(Usd.TimeCode.Default())

    buffer = bytearray()
    buffer_views, accessors, meshes, nodes, materials = [], [], [], [], []
    material_ids = {}

    def add_accessor(array, kind, component, target, minmax=False):
        while len(buffer) % 4:
            buffer.append(0)
        data = array.tobytes()
        buffer_views.append({'buffer': 0, 'byteOffset': len(buffer), 'byteLength': len(data), 'target': target})
        buffer.extend(data)
        acc = {'bufferView': len(buffer_views) - 1, 'componentType': component, 'count': int(array.shape[0]), 'type': kind}
        if minmax:
            acc['min'] = array.min(axis=0).tolist()
            acc['max'] = array.max(axis=0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    def material_for(rgb):
        key = tuple(round(float(c), 4) for c in rgb)
        if key not in material_ids:
            materials.append({
                'name': 'color_%02x%02x%02x' % tuple(int(max(0.0, min(1.0, c)) * 255) for c in key),
                'pbrMetallicRoughness': {'baseColorFactor': [*key, 1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.6},
                'doubleSided': True,
            })
            material_ids[key] = len(materials) - 1
        return material_ids[key]

    total_tris = 0
    for prim in Usd.PrimRange(stage.GetPseudoRoot(), Usd.TraverseInstanceProxies()):
        if not prim.IsA(UsdGeom.Mesh):
            continue
        if UsdGeom.Imageable(prim).ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue
        mesh = UsdGeom.Mesh(prim)
        points = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        indices = mesh.GetFaceVertexIndicesAttr().Get()
        if not points or not counts or not indices:
            continue
        points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
        counts = np.asarray(counts, dtype=np.int64)
        indices = np.asarray(indices, dtype=np.int64)
        xf = np.asarray(cache.GetLocalToWorldTransform(prim), dtype=np.float64)
        world = (np.c_[points, np.ones(len(points))] @ xf)[:, :3] * mm_per_unit
        normals = _normals(prim, counts, indices, xf)
        colors = _face_colors(prim, len(counts))

        tri_fv, tri_face = _triangulate(counts)
        if len(tri_fv) == 0:
            continue
        left_handed = mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded
        if np.linalg.det(xf[:3, :3]) < 0:
            left_handed = not left_handed
        if left_handed:
            tri_fv = tri_fv[:, [0, 2, 1]]

        primitives = []
        unique_rgb, group = np.unique(np.round(colors[tri_face], 4), axis=0, return_inverse=True)
        group = group.reshape(-1)
        for g, rgb in enumerate(unique_rgb):
            fv = tri_fv[group == g].reshape(-1)
            columns = [world[indices[fv]].astype(np.float32)]
            if normals is not None:
                columns.append(normals[fv].astype(np.float32))
            uniq, inverse = np.unique(np.concatenate(columns, axis=1), axis=0, return_inverse=True)
            inverse = inverse.reshape(-1)
            attributes = {'POSITION': add_accessor(np.ascontiguousarray(uniq[:, :3]), 'VEC3', 5126, 34962, minmax=True)}
            if normals is not None:
                attributes['NORMAL'] = add_accessor(np.ascontiguousarray(uniq[:, 3:6]), 'VEC3', 5126, 34962)
            wide = len(uniq) > 65535
            idx = inverse.astype(np.uint32 if wide else np.uint16)
            primitives.append({
                'attributes': attributes,
                'indices': add_accessor(idx, 'SCALAR', 5125 if wide else 5123, 34963),
                'material': material_for(rgb),
                'mode': 4,
            })
            total_tris += len(fv) // 3
        body = f'Body {len(meshes) + 1}'
        meshes.append({'name': body, 'primitives': primitives})
        nodes.append({'name': body, 'mesh': len(meshes) - 1, 'extras': {PART_MARKER: True}})

    if not meshes:
        raise ConversionError('no visible mesh in the converted part')

    gltf = {
        'asset': {'version': '2.0', 'generator': 'stiko cad-worker usd_to_glb'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': materials,
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': len(buffer)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(buffer) % 4:
        buffer.append(0)
    total = 12 + 8 + len(js) + 8 + len(buffer)
    with open(glb_path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(buffer), 0x004E4942) + bytes(buffer))
    return {'meshes': len(meshes), 'materials': len(materials), 'triangles': total_tris, 'bytes': total}


def main(argv):
    try:
        print(json.dumps(convert(argv[1], argv[2])))
        return 0
    except ConversionError as e:
        print(str(e), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main(sys.argv))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `/tmp/cadworker-venv/bin/python -m pytest -q cad-worker/tests/test_usd_to_glb.py`
Expected: `11 passed`.

- [ ] **Step 6: Commit**

```bash
git add cad-worker/usd_to_glb.py cad-worker/requirements-dev.txt cad-worker/tests/test_usd_to_glb.py
git commit -m "feat(cad-worker): USD to millimetre GLB with per-colour primitives and part markers"
```

---

### Task 2: Worker job logic

**Files:**
- Create: `cad-worker/worker_core.py`
- Test: `cad-worker/tests/test_worker_core.py`

**Interfaces:**
- Consumes: `usd_to_glb.py` CLI from Task 1 (exit 3 = verdict).
- Produces:
  - `parse_hosts(value) -> list[str]`
  - `validate_job(body, storage_hosts, callback_hosts, allow_local_http=False) -> dict`, raising `Refused(status, reason)`
  - `process_job(job, workdir, *, convert=default_convert, sleep=time.sleep) -> dict | None`
  - `default_convert(src: Path, usd: Path, glb: Path)`, raising `JobFailed(reason)`
  - `JOB_FIELDS`

- [ ] **Step 1: Write the failing tests** — `cad-worker/tests/test_worker_core.py`

```python
"""worker_core against a fake storage + callback server. No Modal, no GPU."""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import worker_core  # noqa: E402
from worker_core import JobFailed, Refused  # noqa: E402

GLB = b'glTF' + b'\x02\x00\x00\x00' + b'\x0c\x00\x00\x00'


class Fake(BaseHTTPRequestHandler):
    source = b'SLDPRT-BYTES'
    puts, callbacks, callback_statuses = [], [], []

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == '/redirect':
            self.send_response(302)
            self.send_header('Location', '/source')
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Length', str(len(Fake.source)))
        self.end_headers()
        self.wfile.write(Fake.source)

    def do_PUT(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        Fake.puts.append((self.path, self.headers['Content-Type'], body))
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        Fake.callbacks.append(body)
        status = Fake.callback_statuses.pop(0) if Fake.callback_statuses else 200
        self.send_response(status)
        self.end_headers()


@pytest.fixture
def server():
    Fake.source, Fake.puts, Fake.callbacks, Fake.callback_statuses = b'SLDPRT-BYTES', [], [], []
    srv = ThreadingHTTPServer(('127.0.0.1', 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{srv.server_address[1]}'
    srv.shutdown()


def job(base, **over):
    j = {'sourceUrl': f'{base}/source', 'targetUrl': f'{base}/target', 'callbackUrl': f'{base}/callback',
         'fileId': 'f1', 'claimId': 'cad:1:2026-10-18T10:00:00.000Z', 'token': 'tok', 'filename': 'Part.SLDPRT'}
    j.update(over)
    return j


def fake_convert(src, usd, glb):
    assert src.read_bytes() == Fake.source
    glb.write_bytes(GLB)


# --- validate_job -----------------------------------------------------------------------------

STORAGE = worker_core.parse_hosts('.r2.cloudflarestorage.com')
CALLBACK = worker_core.parse_hosts('app.stiko.design')


def valid():
    return {'sourceUrl': 'https://acct.r2.cloudflarestorage.com/b/a.sldprt?X-Amz=1',
            'targetUrl': 'https://acct.r2.cloudflarestorage.com/b/a.sldprt.glb?X-Amz=1',
            'callbackUrl': 'https://app.stiko.design/api/conversions/cad-callback',
            'fileId': 'f', 'claimId': 'cad:1:x', 'token': 't', 'filename': 'a.sldprt'}


def test_a_valid_job_passes():
    assert worker_core.validate_job(valid(), STORAGE, CALLBACK)['fileId'] == 'f'


@pytest.mark.parametrize('field', worker_core.JOB_FIELDS)
def test_every_field_is_required(field):
    body = valid()
    del body[field]
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 400


@pytest.mark.parametrize('field,url', [
    ('sourceUrl', 'http://acct.r2.cloudflarestorage.com/b/a'),
    ('targetUrl', 'https://evil.example/b/a'),
    ('callbackUrl', 'https://app.stiko.design.evil.example/cb'),
    ('callbackUrl', 'http://app.stiko.design/cb'),
])
def test_wrong_scheme_or_host_is_refused(field, url):
    body = valid()
    body[field] = url
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 400


def test_only_sldprt_is_accepted():
    body = valid()
    body['filename'] = 'a.sldasm'
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 422


# --- process_job ------------------------------------------------------------------------------

def test_success_uploads_the_glb_and_reports_it(server, tmp_path):
    payload = worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=lambda s: None)
    assert payload == {'fileId': 'f1', 'claimId': 'cad:1:2026-10-18T10:00:00.000Z', 'token': 'tok', 'ok': True, 'glbBytes': len(GLB)}
    assert Fake.puts == [('/target', 'model/gltf-binary', GLB)]
    assert Fake.callbacks == [payload]


def test_too_large_is_a_verdict_and_nothing_is_uploaded(server, tmp_path, monkeypatch):
    monkeypatch.setattr(worker_core, 'MAX_INPUT_BYTES', 4)
    payload = worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=lambda s: None)
    assert payload['ok'] is False and payload['reason'] == 'too_large'
    assert Fake.puts == [] and Fake.callbacks == [payload]


def test_a_conversion_verdict_is_reported(server, tmp_path):
    def unreadable(src, usd, glb):
        raise JobFailed('unreadable: bad file')
    payload = worker_core.process_job(job(server), tmp_path, convert=unreadable, sleep=lambda s: None)
    assert payload['ok'] is False and payload['reason'] == 'unreadable: bad file'
    assert Fake.callbacks == [payload]


def test_a_transient_failure_reports_nothing(server, tmp_path):
    def crash(src, usd, glb):
        raise RuntimeError('GPU fell over')
    assert worker_core.process_job(job(server), tmp_path, convert=crash, sleep=lambda s: None) is None
    assert Fake.callbacks == []


def test_a_redirecting_source_is_not_followed(server, tmp_path):
    assert worker_core.process_job(job(server, sourceUrl=f'{server}/redirect'), tmp_path,
                                   convert=fake_convert, sleep=lambda s: None) is None
    assert Fake.puts == [] and Fake.callbacks == []


def test_the_callback_is_retried_on_5xx(server, tmp_path):
    Fake.callback_statuses = [503, 502, 200]
    slept = []
    worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=slept.append)
    assert len(Fake.callbacks) == 3 and len(slept) == 2


def test_the_callback_is_not_retried_on_4xx(server, tmp_path):
    Fake.callback_statuses = [401]
    worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=lambda s: None)
    assert len(Fake.callbacks) == 1


# --- default_convert's GLB check ------------------------------------------------------------------

def test_usd_to_glb_exit_3_is_a_verdict(tmp_path):
    class R:
        returncode, stdout, stderr = 3, '', 'no visible mesh in the converted part'
    with pytest.raises(JobFailed, match='no visible mesh'):
        worker_core.run_usd_to_glb(tmp_path / 'a.usdc', tmp_path / 'a.glb', run=lambda *a, **k: R())


def test_output_that_is_not_a_glb_is_a_verdict(tmp_path):
    class R:
        returncode, stdout, stderr = 0, '{}', ''
    def run(*a, **k):
        (tmp_path / 'a.glb').write_bytes(b'not a glb')
        return R()
    with pytest.raises(JobFailed, match='bad_glb'):
        worker_core.run_usd_to_glb(tmp_path / 'a.usdc', tmp_path / 'a.glb', run=run)


def test_a_converter_timeout_is_a_verdict(tmp_path):
    import subprocess
    def run(*a, **k):
        raise subprocess.TimeoutExpired(cmd='usd-convert-cad', timeout=1)
    with pytest.raises(JobFailed, match='timeout'):
        worker_core.run_converter(tmp_path / 'a.sldprt', tmp_path / 'a.usdc', run=run)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `/tmp/cadworker-venv/bin/python -m pytest -q cad-worker/tests/test_worker_core.py`
Expected: `ModuleNotFoundError: No module named 'worker_core'`.

- [ ] **Step 3: Implement** — `cad-worker/worker_core.py`

```python
"""Job logic for the Stiko CAD worker, kept free of Modal so it can be tested on a laptop.

Standard library only. A job: download the .sldprt from a presigned GET URL, convert it
(usd-convert-cad, then usd_to_glb.py), PUT the GLB to a presigned URL, POST the result to Stiko's
callback. The worker never holds Stiko credentials: it gets URLs and echoes the token it was given.

Two kinds of failure, kept apart on purpose (see the spec's failure table):
- JobFailed: a verdict on the FILE (too large, unreadable, empty, too slow). Reported with ok=false,
  and Stiko marks the file 'failed' for good.
- anything else: transient (network, storage, a crash). Nothing is reported; the claim goes stale
  after 15 minutes and Stiko retries, at most three attempts in all.
"""

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

MAX_INPUT_BYTES = 200 * 1024 * 1024
CONVERT_TIMEOUT_S = 420
GLB_TIMEOUT_S = 120
GLTF_PYTHON = '/opt/gltf/bin/python'
HERE = Path(__file__).resolve().parent
JOB_FIELDS = ('sourceUrl', 'targetUrl', 'callbackUrl', 'fileId', 'claimId', 'token', 'filename')


class Refused(Exception):
    """The start request itself is unacceptable. status is the HTTP status to answer with."""

    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status
        self.reason = reason


class JobFailed(Exception):
    """A verdict on the file. The message is the reason Stiko logs."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def parse_hosts(value):
    return [h.strip().lower() for h in (value or '').split(',') if h.strip()]


def _host_allowed(host, entries):
    host = (host or '').lower()
    return any(host.endswith(e) if e.startswith('.') else host == e for e in entries)


def _check_url(field, url, entries, allow_local_http):
    parts = urlsplit(url)
    local = parts.hostname in ('127.0.0.1', 'localhost')
    if parts.scheme == 'https' and _host_allowed(parts.hostname, entries):
        return
    if allow_local_http and parts.scheme == 'http' and local:
        return
    raise Refused(400, f'{field} is not an allowed https URL')


def validate_job(body, storage_hosts, callback_hosts, allow_local_http=False):
    if not isinstance(body, dict):
        raise Refused(400, 'body must be a JSON object')
    for field in JOB_FIELDS:
        if not isinstance(body.get(field), str) or not body[field]:
            raise Refused(400, f'{field} is required')
    _check_url('sourceUrl', body['sourceUrl'], storage_hosts, allow_local_http)
    _check_url('targetUrl', body['targetUrl'], storage_hosts, allow_local_http)
    _check_url('callbackUrl', body['callbackUrl'], callback_hosts, allow_local_http)
    if not body['filename'].lower().endswith('.sldprt'):
        raise Refused(422, 'only .sldprt files are converted')
    return {field: body[field] for field in JOB_FIELDS}


def download(url, dest, timeout=60):
    """Stream to dest. Over MAX_INPUT_BYTES is a verdict; any other problem is transient."""
    with _opener.open(url, timeout=timeout) as res:
        if res.status != 200:
            raise RuntimeError(f'source answered {res.status}')
        declared = res.headers.get('Content-Length')
        if declared and int(declared) > MAX_INPUT_BYTES:
            raise JobFailed('too_large')
        total = 0
        with open(dest, 'wb') as out:
            while True:
                chunk = res.read(1 << 20)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_INPUT_BYTES:
                    raise JobFailed('too_large')
                out.write(chunk)
    return total


def run_converter(src, usd, run=subprocess.run):
    cmd = ['usd-convert-cad', '-i', str(src), '-o', str(usd), '--up-axis', 'y', '--material-type', 'preview-surface']
    try:
        p = run(cmd, capture_output=True, text=True, timeout=CONVERT_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise JobFailed('timeout') from None
    if p.returncode != 0 or not Path(usd).exists():
        raise JobFailed('unreadable: ' + (p.stderr or p.stdout or '').strip()[-300:])


def run_usd_to_glb(usd, glb, run=subprocess.run, python=GLTF_PYTHON):
    cmd = [python, str(HERE / 'usd_to_glb.py'), str(usd), str(glb)]
    try:
        p = run(cmd, capture_output=True, text=True, timeout=GLB_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise JobFailed('timeout') from None
    if p.returncode == 3:
        raise JobFailed((p.stderr or '').strip()[-300:] or 'no visible mesh')
    if p.returncode != 0:
        raise RuntimeError('usd_to_glb crashed: ' + (p.stderr or '').strip()[-300:])
    glb = Path(glb)
    if not glb.exists() or glb.stat().st_size < 12 or glb.read_bytes()[:4] != b'glTF':
        raise JobFailed('bad_glb')


def default_convert(src, usd, glb):
    run_converter(src, usd)
    run_usd_to_glb(usd, glb)


def put_file(url, path, content_type='model/gltf-binary', timeout=120):
    data = Path(path).read_bytes()
    req = urllib.request.Request(url, data=data, method='PUT', headers={'Content-Type': content_type})
    with _opener.open(req, timeout=timeout) as res:
        if res.status != 200:
            raise RuntimeError(f'target answered {res.status}')


def post_callback(url, payload, attempts=3, sleep=time.sleep, timeout=20):
    """POST the result. Retries network errors and 5xx; a 4xx is final. Returns the last status."""
    data = json.dumps(payload).encode()
    status = None
    for attempt in range(attempts):
        req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': 'application/json'})
        try:
            with _opener.open(req, timeout=timeout) as res:
                return res.status
        except urllib.error.HTTPError as e:
            status = e.code
            if e.code < 500:
                print(f'cad-worker: callback refused with {e.code}', file=sys.stderr)
                return status
        except (urllib.error.URLError, OSError) as e:
            print(f'cad-worker: callback failed: {e!r}', file=sys.stderr)
        if attempt < attempts - 1:
            sleep(2 ** attempt)
    return status


def process_job(job, workdir, *, convert=default_convert, sleep=time.sleep):
    """Run one job end to end and report it. Returns the payload sent, or None if nothing was."""
    workdir = Path(workdir)
    base = {'fileId': job['fileId'], 'claimId': job['claimId'], 'token': job['token']}
    src, usd, glb = workdir / 'input.sldprt', workdir / 'out.usdc', workdir / 'out.glb'
    try:
        download(job['sourceUrl'], src)
        convert(src, usd, glb)
        put_file(job['targetUrl'], glb)
        payload = {**base, 'ok': True, 'glbBytes': glb.stat().st_size}
    except JobFailed as e:
        payload = {**base, 'ok': False, 'reason': str(e)[:500]}
    except Exception as e:  # noqa: BLE001 - transient by definition; the claim goes stale and Stiko retries
        print(f'cad-worker: transient failure for {job["fileId"]}, not reported: {e!r}', file=sys.stderr)
        return None
    post_callback(job['callbackUrl'], payload, sleep=sleep)
    return payload
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `/tmp/cadworker-venv/bin/python -m pytest -q cad-worker/tests`
Expected: all pass (11 from Task 1 + 22 here).

- [ ] **Step 5: Commit**

```bash
git add cad-worker/worker_core.py cad-worker/tests/test_worker_core.py
git commit -m "feat(cad-worker): job logic with verdict/transient split, capped download, callback retry"
```

---

### Task 3: Modal app, deploy, and real-file smoke test

**Files:**
- Create: `cad-worker/app.py`
- Create: `cad-worker/README.md`
- Create: `cad-worker/NOTICE`

**Interfaces:**
- Consumes: `worker_core.validate_job`, `worker_core.process_job`, `worker_core.default_convert`, `worker_core.parse_hosts`, `worker_core.Refused`.
- Produces:
  - **`start` endpoint:** `POST <url>` with header `X-Worker-Secret` and JSON `{sourceUrl,targetUrl,callbackUrl,fileId,claimId,token,filename}`.
  - **Replies:**

    | Status | Body |
    |---|---|
    | 200 | `{callId}` |
    | 401 | bad secret |
    | 400 | bad body or URL |
    | 422 | not `.sldprt` |

  - The deployed URL is recorded in `cad-worker/README.md`.

- [ ] **Step 1: Write `cad-worker/app.py`**

```python
"""Stiko CAD worker on Modal: .sldprt -> GLB with NVIDIA usd-convert-cad on a T4.

Deploy:  modal deploy cad-worker/app.py      (needs `pip install modal fastapi` locally)
Smoke:   modal run cad-worker/app.py::smoke --samples DIR --out DIR
See README.md for the secret, the licence terms in use, and the runbook.
"""

import os
import tempfile
import time
from pathlib import Path

import fastapi
import modal

HERE = Path(__file__).resolve().parent
secret = modal.Secret.from_name('stiko-cad-worker')

# usd-convert-cad bundles its own OpenUSD; usd_to_glb.py needs Pixar's usd-core. They live in
# separate environments so the two USD builds never load into one interpreter.
gpu_image = (
    modal.Image.debian_slim(python_version='3.12')
    .apt_install('libgl1', 'libglib2.0-0', 'libxext6', 'libsm6', 'libxrender1', 'libgomp1', 'libxi6', 'libxt6')
    .uv_pip_install('usd-convert-cad==0.3.0')
    .run_commands('python -m venv /opt/gltf', '/opt/gltf/bin/pip install -q usd-core==26.8 numpy==2.5.4')
    # NVIDIA AI Product Terms 11.1.3: telemetry off.
    .env({'OMNI_TELEMETRY_DISABLE': '1', 'NV_TELEMETRY_DISABLE': '1'})
    .add_local_file(HERE / 'worker_core.py', '/root/worker_core.py')
    .add_local_file(HERE / 'usd_to_glb.py', '/root/usd_to_glb.py')
)
web_image = (
    modal.Image.debian_slim(python_version='3.12')
    .uv_pip_install('fastapi[standard]==0.146.0')
    .add_local_file(HERE / 'worker_core.py', '/root/worker_core.py')
)

app = modal.App('stiko-cad-worker')


@app.function(image=gpu_image, gpu='T4', timeout=600, retries=0, secrets=[secret])
def convert_job(job: dict):
    # NVIDIA AI Product Terms 8.15: Omniverse runs only on NVIDIA platforms, hence gpu='T4'.
    import worker_core

    with tempfile.TemporaryDirectory() as d:
        return worker_core.process_job(job, Path(d))


@app.function(image=web_image, secrets=[secret])
@modal.fastapi_endpoint(method='POST')
async def start(request: fastapi.Request):
    import hmac

    import worker_core
    from fastapi.responses import JSONResponse

    expected = os.environ.get('CAD_WORKER_SECRET', '')
    given = request.headers.get('x-worker-secret', '')
    if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
        return JSONResponse({'error': 'unauthorized'}, status_code=401)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({'error': 'body must be JSON'}, status_code=400)
    try:
        job = worker_core.validate_job(
            body,
            worker_core.parse_hosts(os.environ.get('WORKER_STORAGE_HOSTS', '.r2.cloudflarestorage.com')),
            worker_core.parse_hosts(os.environ.get('WORKER_CALLBACK_HOSTS', '')),
        )
    except worker_core.Refused as e:
        return JSONResponse({'error': e.reason}, status_code=e.status)
    call = await convert_job.spawn.aio(job)
    return {'callId': call.object_id}


@app.function(image=gpu_image, gpu='T4', timeout=600)
def convert_bytes(name: str, data: bytes) -> dict:
    """Smoke test only: the same conversion as convert_job, on bytes, with no storage or callback."""
    import worker_core

    with tempfile.TemporaryDirectory() as d:
        src, usd, glb = Path(d) / name, Path(d) / 'out.usdc', Path(d) / 'out.glb'
        src.write_bytes(data)
        t = time.time()
        try:
            worker_core.default_convert(src, usd, glb)
        except worker_core.JobFailed as e:
            return {'name': name, 'error': str(e)}
        return {'name': name, 'seconds': round(time.time() - t, 2), 'glb': glb.read_bytes()}


@app.local_entrypoint()
def smoke(samples: str, out: str):
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in sorted(Path(samples).glob('*.sldprt'), key=lambda p: p.stat().st_size):
        r = convert_bytes.remote(f.name, f.read_bytes())
        glb = r.pop('glb', None)
        if glb:
            (out_dir / (f.stem + '.glb')).write_bytes(glb)
        print(r, len(glb or b''))
```

- [ ] **Step 2: Write `cad-worker/NOTICE`**

```
This software contains source code provided by NVIDIA Corporation.

The Stiko CAD worker runs NVIDIA's Omniverse CAD Converter (usd-convert-cad, PyPI), which uses the
Tech Soft 3D HOOPS Exchange SDK licensed by NVIDIA. It is governed by the NVIDIA Software License
Agreement and the Product Specific Terms for NVIDIA AI Products:
https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-software-license-agreement/
https://www.nvidia.com/en-us/agreements/enterprise-software/product-specific-terms-for-ai-products/
Third-party notices: https://github.com/NVIDIA-Omniverse/usd-convert-cad/blob/main/THIRD_PARTY_NOTICES.md
```

- [ ] **Step 3: Create the Modal secret and deploy**

Generate one secret value and keep it for Task 8's Vercel step. Do not print it into a commit or a file in the repo:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))" > /private/tmp/claude-501/-Users-user-Desktop-STIKO-main/683a3a1c-f511-4dc9-ac15-95acc76ef6e6/scratchpad/cad-worker-secret.txt
M=/private/tmp/claude-501/-Users-user-Desktop-STIKO-main/683a3a1c-f511-4dc9-ac15-95acc76ef6e6/scratchpad/modal-venv/bin
$M/pip install -q fastapi==0.146.0
$M/modal secret create stiko-cad-worker \
  CAD_WORKER_SECRET="$(cat /private/tmp/claude-501/-Users-user-Desktop-STIKO-main/683a3a1c-f511-4dc9-ac15-95acc76ef6e6/scratchpad/cad-worker-secret.txt)" \
  WORKER_STORAGE_HOSTS=.r2.cloudflarestorage.com WORKER_CALLBACK_HOSTS=app.stiko.design
$M/modal deploy cad-worker/app.py
```
Expected: the deploy prints the `start` endpoint URL, e.g. `https://hello-63953--stiko-cad-worker-start.modal.run`. Record it.

- [ ] **Step 4: Check the endpoint's refusals**

```bash
URL=<start url>
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL" -H 'Content-Type: application/json' -d '{}'   # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL" -H "X-Worker-Secret: $(cat <secret file>)" -H 'Content-Type: application/json' -d '{}'   # 400
curl -s -w '\n%{http_code}\n' -X POST "$URL" -H "X-Worker-Secret: $(cat <secret file>)" -H 'Content-Type: application/json' \
  -d '{"sourceUrl":"https://evil.example/a","targetUrl":"https://x.r2.cloudflarestorage.com/a","callbackUrl":"https://app.stiko.design/cb","fileId":"f","claimId":"c","token":"t","filename":"a.sldprt"}'   # 400 sourceUrl
```

- [ ] **Step 5: Run the real-file smoke test through the deployed image**

```bash
S=/private/tmp/claude-501/-Users-user-Desktop-STIKO-main/683a3a1c-f511-4dc9-ac15-95acc76ef6e6/scratchpad
$S/modal-venv/bin/modal run cad-worker/app.py::smoke --samples $S/sldprt-samples --out $S/smoke-out
node $S/sldprt-spike/check_glb.mjs $S/sldprt-spike/validator $S/smoke-out
```
Expected:
- 10 lines with `seconds` and no `error`.
- The validator reports `errors=0 warnings=0` for all 10.
- `sizeMm`: `[10,10,10]` for the three cubes, `[14,4,14]` for the torus, `[53.1,287.37,53.1]` for the Saturn V.

- [ ] **Step 6: Write `cad-worker/README.md`**

The README includes:
- **Deployed endpoint:** the URL from Step 3.
- **Deploy and smoke commands:** the ones above.
- **The secret's three keys:**
  - `CAD_WORKER_SECRET`: shared with stiko's `CAD_WORKER_SECRET`. Rotate both together.
  - `WORKER_STORAGE_HOSTS`: a leading dot means any subdomain.
  - `WORKER_CALLBACK_HOSTS`: an exact host.
- **Licence terms in use:**
  - §1.1.2.1: offer as a service on leased infrastructure.
  - §8.15: NVIDIA platforms only (T4).
  - §1.7: notice text and monthly use reports on request.
  - §11.1.3: telemetry, disabled.
  - The two open questions sent to NVIDIA.
- **Tests:** `/tmp/cadworker-venv/bin/python -m pytest -q cad-worker/tests`.
- **Logs:** `modal app logs stiko-cad-worker`. Grep for `cad-worker:`.

- [ ] **Step 7: Commit**

```bash
git add cad-worker/app.py cad-worker/README.md cad-worker/NOTICE
git commit -m "feat(cad-worker): Modal app with secret-checked start endpoint and T4 conversion job"
```

---

### Task 4: Format switch and pure rules

**Files:**
- Modify: `lib/fileFormats.ts`
- Create: `lib/cadConversion.ts`
- Modify: `lib/storageKeys.ts`
- Modify: `lib/measure/calibration.ts:38-49`
- Test: `scripts/tests/fileFormats.test.mjs`
- Create: `scripts/tests/cadConversion.test.mjs`
- Test: `scripts/tests/storageKeys.test.mjs`
- Test: `scripts/tests/measureCalibration.test.mjs`

**Interfaces:**
- Produces:
  - `sldprtConversionEnabled(value?: string): boolean`
  - `formatTables(enabled: boolean): { model: string[]; advice: Record<string, FormatAdvice> }`
  - `isSldprtFilename(f)`, `isPendingCad(f, key)`, `opensAsModel(f, key)`
  - `cadClaimId(attempt, now)`, `parseCadClaim(jobId)`, `claimDecision(status, jobId, now)`
  - `capLikePattern(now)`, `firstOfNextMonth(now)`, `monthlyCap(value)`
  - `workerStartOutcome(status, body)`, `parseCallbackBody(raw)`, `callbackOutcome(body)`
  - `nextCadPollStep(status, key, elapsedMs)`
  - `CAD_CLAIM_STALE_MS`, `CAD_MAX_ATTEMPTS`, `CAD_POLL_INTERVAL_MS`, `CAD_POLL_LIMIT_MS`
  - `cadGlbKey(key)`

- [ ] **Step 1: Write the failing tests**

`scripts/tests/cadConversion.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSldprtFilename, isPendingCad, opensAsModel, cadClaimId, parseCadClaim, claimDecision,
  capLikePattern, firstOfNextMonth, monthlyCap, workerStartOutcome, parseCallbackBody,
  callbackOutcome, nextCadPollStep, CAD_CLAIM_STALE_MS, CAD_MAX_ATTEMPTS, CAD_POLL_LIMIT_MS,
} from '../../lib/cadConversion.ts';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

test('only .sldprt is a SolidWorks part, in any case', () => {
  for (const n of ['a.sldprt', 'A.SLDPRT', 'dir/Part.SldPrt']) assert.equal(isSldprtFilename(n), true, n);
  for (const n of ['a.sldasm', 'a.step', 'sldprt', '.sldprt', 'a.sldprt.glb']) assert.equal(isSldprtFilename(n), false, n);
});

test('a part without a GLB is pending; with one it opens as a model', () => {
  assert.equal(isPendingCad('a.sldprt', null), true);
  assert.equal(isPendingCad('a.sldprt', 'k/a.sldprt.glb'), false);
  assert.equal(isPendingCad('a.step', null), false);
  assert.equal(opensAsModel('a.sldprt', null), false);
  assert.equal(opensAsModel('a.sldprt', 'k/a.sldprt.glb'), true);
  assert.equal(opensAsModel('a.step', null), true);
  assert.equal(opensAsModel('a.png', null), false);
});

test('claim ids carry the attempt and the time, and parse back', () => {
  const id = cadClaimId(2, NOW);
  assert.equal(id, 'cad:2:2026-10-18T12:00:00.000Z');
  assert.deepEqual(parseCadClaim(id), { attempt: 2, claimedAt: NOW.getTime() });
  for (const bad of [null, '', 'drawing:2026-10-18T12:00:00.000Z', 'cad:x:2026', 'cad:1:not-a-date', 'cad:0:2026-10-18T12:00:00.000Z']) {
    assert.equal(parseCadClaim(bad), null, String(bad));
  }
});

test('claim decisions', () => {
  assert.deepEqual(claimDecision(null, null, NOW), { kind: 'claim', attempt: 1 });
  assert.deepEqual(claimDecision('pending', null, NOW), { kind: 'claim', attempt: 1 });
  assert.deepEqual(claimDecision('completed', 'cad:1:x', NOW), { kind: 'final' });
  assert.deepEqual(claimDecision('failed', 'cad:1:x', NOW), { kind: 'final' });
  assert.deepEqual(claimDecision('processing', cadClaimId(1, ago(60_000)), NOW), { kind: 'wait' });
  assert.deepEqual(claimDecision('processing', cadClaimId(1, ago(CAD_CLAIM_STALE_MS + 1)), NOW), { kind: 'claim', attempt: 2 });
  assert.deepEqual(claimDecision('processing', cadClaimId(CAD_MAX_ATTEMPTS, ago(CAD_CLAIM_STALE_MS + 1)), NOW), { kind: 'give-up' });
  // A processing row with no readable cad claim (another feature's, or garbage) starts afresh.
  assert.deepEqual(claimDecision('processing', 'job-123', NOW), { kind: 'claim', attempt: 1 });
});

test('the cap counts this month\'s claims and reopens on the 1st', () => {
  assert.equal(capLikePattern(NOW), 'cad:%:2026-10-%');
  assert.equal(firstOfNextMonth(NOW), '2026-11-01');
  assert.equal(firstOfNextMonth(new Date('2026-12-31T23:59:59.000Z')), '2027-01-01');
  assert.equal(monthlyCap(undefined), 300);
  assert.equal(monthlyCap(''), 300);
  assert.equal(monthlyCap('abc'), 300);
  assert.equal(monthlyCap('-5'), 300);
  assert.equal(monthlyCap('0'), 0);
  assert.equal(monthlyCap(' 120 '), 120);
});

test('only a 200 with a call id means the worker started', () => {
  assert.equal(workerStartOutcome(200, { callId: 'fc-1' }), 'started');
  assert.equal(workerStartOutcome(200, {}), 'retry');
  assert.equal(workerStartOutcome(200, { callId: '' }), 'retry');
  for (const s of [null, 400, 401, 413, 422, 500, 502, 302]) assert.equal(workerStartOutcome(s, { callId: 'x' }), 'retry', String(s));
});

test('callback bodies are validated and classified', () => {
  const ok = { fileId: 'f', claimId: 'c', token: 't', ok: true, glbBytes: 10 };
  assert.deepEqual(parseCallbackBody(ok), ok);
  assert.equal(callbackOutcome(ok), 'completed');
  assert.equal(callbackOutcome({ ...ok, glbBytes: 0 }), 'failed');
  assert.equal(callbackOutcome({ ...ok, ok: false, reason: 'too_large' }), 'failed');
  for (const bad of [null, 'x', {}, { ...ok, fileId: 1 }, { ...ok, ok: 'yes' }, { ...ok, token: '' }]) {
    assert.equal(parseCallbackBody(bad), null, JSON.stringify(bad));
  }
});

test('poll steps', () => {
  assert.equal(nextCadPollStep('completed', 'k', 0), 'done');
  assert.equal(nextCadPollStep('completed', null, 0), 'wait');
  assert.equal(nextCadPollStep('failed', null, 0), 'failed');
  assert.equal(nextCadPollStep('processing', null, 1000), 'wait');
  assert.equal(nextCadPollStep('processing', null, CAD_POLL_LIMIT_MS), 'timeout');
});
```

Append to `scripts/tests/fileFormats.test.mjs`. Also update the import list to add `formatTables` and `sldprtConversionEnabled`:
```js
test('the SolidWorks switch is on unless explicitly off', () => {
  assert.equal(sldprtConversionEnabled(undefined), true);
  assert.equal(sldprtConversionEnabled('on'), true);
  assert.equal(sldprtConversionEnabled(' OFF '), false);
  assert.equal(sldprtConversionEnabled('off'), false);
});

test('switching SolidWorks off moves .sldprt from the model list back to the advice table', () => {
  const on = formatTables(true);
  const off = formatTables(false);
  assert.equal(on.model.includes('sldprt'), true);
  assert.equal('sldprt' in on.advice, false);
  assert.equal(off.model.includes('sldprt'), false);
  assert.deepEqual(off.advice.sldprt, { app: 'SolidWorks', advice: 'Save As STEP, then upload.' });
  // Assemblies keep their advice either way.
  assert.equal('sldasm' in on.advice && 'sldasm' in off.advice, true);
});
```
Edit the existing tests in that file (the test process runs with the switch unset, i.e. on):
- **Model-list test:** add `'sldprt'` to the expected sorted array, between `'ply'` and `'step'`.
- **Native-CAD advice test:** delete the `'part.sldprt'` row.
- **Case-insensitivity test:** change `adviceFor('PART.SLDPRT')` to `adviceFor('ASM.SLDASM')`.

Append to `scripts/tests/storageKeys.test.mjs` (add `cadGlbKey` to the import):
```js
test('a SolidWorks part\'s GLB sits beside it with the full original name', () => {
  assert.equal(cadGlbKey('uploads/p/po/v/abc-123.sldprt'), 'uploads/p/po/v/abc-123.sldprt.glb');
  assert.equal(cadGlbKey('uploads/p/po/v/abc-123.SLDPRT'), 'uploads/p/po/v/abc-123.SLDPRT.glb');
});
```

Append to `scripts/tests/measureCalibration.test.mjs`:
```js
test('SolidWorks parts are millimetres, because the worker writes them that way', () => {
  assert.equal(assumedMmPerUnit('bracket.sldprt'), 1);
  assert.equal(assumedMmPerUnit('BRACKET.SLDPRT'), 1);
  assert.equal(assumedMmPerUnit('assembly.sldasm'), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/tests/cadConversion.test.mjs scripts/tests/fileFormats.test.mjs scripts/tests/storageKeys.test.mjs scripts/tests/measureCalibration.test.mjs`
Expected: FAIL. `cadConversion.ts` cannot be found, `formatTables` is not exported, and `cadGlbKey` is not exported.

- [ ] **Step 3: Implement**

In `lib/fileFormats.ts`:
- Remove `sldprt` from the literal `NATIVE_CAD_ADVICE` object and rename that object `const ADVICE_BASE`.
- Replace the `MODEL_FORMATS` / `SUPPORTED_EXTENSIONS` / `NATIVE_CAD_ADVICE` definitions with the code below.
- Keep `MODEL` as the base list (without `sldprt`).
```ts
const SLDPRT_ADVICE: FormatAdvice = { app: 'SolidWorks', advice: 'Save As STEP, then upload.' };

/**
 * Whether SolidWorks parts are converted (lib/cadConversion.ts). On unless the switch is 'off', so
 * production can turn it off with one env var and a redeploy. Read as the literal
 * process.env.NEXT_PUBLIC_SLDPRT_CONVERSION expression so Next inlines it into the browser bundle:
 * the dropzone decides what to accept on the client.
 */
export function sldprtConversionEnabled(value: string | undefined = process.env.NEXT_PUBLIC_SLDPRT_CONVERSION): boolean {
  return (value ?? '').trim().toLowerCase() !== 'off';
}

/** The model list and the advice table for either switch position. Pure, for tests. */
export function formatTables(enabled: boolean): { model: string[]; advice: Record<string, FormatAdvice> } {
  return enabled
    ? { model: [...MODEL, 'sldprt'], advice: { ...ADVICE_BASE } }
    : { model: [...MODEL], advice: { sldprt: SLDPRT_ADVICE, ...ADVICE_BASE } };
}

const TABLES = formatTables(sldprtConversionEnabled());

/**
 * The formats the 3D viewer opens, undotted. ViewerContainer and the portal page derive
 * their checks from this rather than keeping their own copies — there used to be three.
 * A .sldprt opens through its converted GLB; see opensAsModel in lib/cadConversion.ts.
 */
export const MODEL_FORMATS: readonly string[] = TABLES.model;

export const NATIVE_CAD_ADVICE: Readonly<Record<string, FormatAdvice>> = TABLES.advice;

export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...IMAGE,
  ...VIDEO,
  ...DOCUMENT,
  ...TABLES.model,
  ...CAD,
]);
```
`FormatAdvice` and the advice constants are declared further down the file. Move the `FormatAdvice` interface, the `EXPORT_*` constants and `ADVICE_BASE` **above** this block, so nothing is used before it is defined.

Create `lib/cadConversion.ts`:
```ts
import { extensionOf, MODEL_FORMATS } from './fileFormats.ts';

/**
 * SolidWorks parts are shown as GLBs: the CAD worker (cad-worker/, on Modal) converts each one
 * once, and the GLB becomes the file's converted_storage_key. These are the rules around that,
 * kept pure so they can be tested and shared by the routes, the viewer and the portal page.
 * The worker and the claim/callback protocol are in docs/superpowers/specs/2026-10-18-sldprt-conversion-design.md.
 */

export function isSldprtFilename(filename: string): boolean {
  return extensionOf(filename) === 'sldprt';
}

/** A .sldprt with no GLB yet: converting, deferred, failed, or switched off. */
export function isPendingCad(filename: string, convertedStorageKey: string | null): boolean {
  return isSldprtFilename(filename) && !convertedStorageKey;
}

/**
 * Whether the 3D viewer shows this file. A .sldprt only through its GLB, whatever the switch
 * says, so parts converted before a switch-off keep working.
 */
export function opensAsModel(filename: string, convertedStorageKey: string | null): boolean {
  if (isSldprtFilename(filename)) return !!convertedStorageKey;
  return MODEL_FORMATS.includes(extensionOf(filename));
}

/** files.conversion_job_id while a part converts: 'cad:<attempt>:<ISO time>'. */
export const CAD_CLAIM_PREFIX = 'cad:';
/** The worker gives up at 10 minutes; a claim older than this belongs to a job that died. */
export const CAD_CLAIM_STALE_MS = 15 * 60_000;
/** Stale claims are retried, but a file that kills the worker three times is marked failed. */
export const CAD_MAX_ATTEMPTS = 3;

export function cadClaimId(attempt: number, now: Date): string {
  return `${CAD_CLAIM_PREFIX}${attempt}:${now.toISOString()}`;
}

export function parseCadClaim(jobId: string | null): { attempt: number; claimedAt: number } | null {
  const match = /^cad:([1-9]\d*):(.+)$/.exec(jobId ?? '');
  if (!match) return null;
  const claimedAt = Date.parse(match[2]);
  if (Number.isNaN(claimedAt)) return null;
  return { attempt: Number(match[1]), claimedAt };
}

export type ConversionStatus = 'pending' | 'processing' | 'completed' | 'failed' | null;

export type ClaimDecision =
  | { kind: 'claim'; attempt: number }
  | { kind: 'wait' }
  | { kind: 'give-up' }
  | { kind: 'final' };

/** What the start route does with a row: claim it, wait for a live claim, give up, or leave it. */
export function claimDecision(status: ConversionStatus, jobId: string | null, now: Date): ClaimDecision {
  if (status === 'completed' || status === 'failed') return { kind: 'final' };
  if (status !== 'processing') return { kind: 'claim', attempt: 1 };
  const claim = parseCadClaim(jobId);
  if (!claim) return { kind: 'claim', attempt: 1 };
  if (now.getTime() - claim.claimedAt <= CAD_CLAIM_STALE_MS) return { kind: 'wait' };
  if (claim.attempt >= CAD_MAX_ATTEMPTS) return { kind: 'give-up' };
  return { kind: 'claim', attempt: claim.attempt + 1 };
}

/** LIKE pattern for this UTC month's claims. A reclaim overwrites the earlier one, so it can undercount slightly. */
export function capLikePattern(now: Date): string {
  return `${CAD_CLAIM_PREFIX}%:${now.toISOString().slice(0, 7)}-%`;
}

/** The first day of next month (UTC), as YYYY-MM-DD, for "Preview available from …". */
export function firstOfNextMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export const DEFAULT_MONTHLY_CAP = 300;

/** SLDPRT_MONTHLY_CAP as a whole number of conversions; anything unreadable means the default. */
export function monthlyCap(value: string | undefined): number {
  const trimmed = (value ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_MONTHLY_CAP;
  return Number(trimmed);
}

/**
 * The worker's start reply. The start endpoint never reads the file, so no reply is a verdict on
 * it: only a 200 with a call id means a job is running, and everything else is retried.
 */
export function workerStartOutcome(status: number | null, body: unknown): 'started' | 'retry' {
  const callId = (body as { callId?: unknown } | null)?.callId;
  return status === 200 && typeof callId === 'string' && callId.length > 0 ? 'started' : 'retry';
}

export interface CallbackBody {
  fileId: string;
  claimId: string;
  token: string;
  ok: boolean;
  glbBytes?: number;
  reason?: string;
}

export function parseCallbackBody(raw: unknown): CallbackBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  for (const key of ['fileId', 'claimId', 'token'] as const) {
    if (typeof b[key] !== 'string' || (b[key] as string).length === 0) return null;
  }
  if (typeof b.ok !== 'boolean') return null;
  return {
    fileId: b.fileId as string,
    claimId: b.claimId as string,
    token: b.token as string,
    ok: b.ok,
    ...(typeof b.glbBytes === 'number' ? { glbBytes: b.glbBytes } : {}),
    ...(typeof b.reason === 'string' ? { reason: b.reason } : {}),
  };
}

export function callbackOutcome(body: CallbackBody): 'completed' | 'failed' {
  return body.ok && typeof body.glbBytes === 'number' && body.glbBytes > 0 ? 'completed' : 'failed';
}

export const CAD_POLL_INTERVAL_MS = 3000;
export const CAD_POLL_LIMIT_MS = 300_000;

export type CadPollStep = 'done' | 'failed' | 'wait' | 'timeout';

/** What the viewer does after one status check while a part converts. */
export function nextCadPollStep(status: ConversionStatus, convertedStorageKey: string | null, elapsedMs: number): CadPollStep {
  if (status === 'completed' && convertedStorageKey) return 'done';
  if (status === 'failed') return 'failed';
  if (elapsedMs >= CAD_POLL_LIMIT_MS) return 'timeout';
  return 'wait';
}
```

In `lib/storageKeys.ts`, after `drawingPdfKey`:
```ts
/**
 * Where a SolidWorks part's converted GLB lives: beside the original, the original's full name
 * plus '.glb'. Always derived from the original's key on the server, never accepted from a caller.
 */
export function cadGlbKey(originalStorageKey: string): string {
  return `${originalStorageKey}.glb`;
}
```

In `lib/measure/calibration.ts` `assumedMmPerUnit`, add to the millimetre cases:
```ts
    case 'step':
    case 'stp':
    case 'igs':
    case 'iges':
    // The CAD worker writes SolidWorks parts in millimetres whatever unit they were drawn in.
    case 'sldprt':
      return 1;
```

- [ ] **Step 4: Run all node tests**

Run: `npm test`
Expected: all pass. That's the 83 existing files plus the new one. Fix any other test that enumerated the old model list.

- [ ] **Step 5: Commit**

```bash
git add lib/fileFormats.ts lib/cadConversion.ts lib/storageKeys.ts lib/measure/calibration.ts scripts/tests/cadConversion.test.mjs scripts/tests/fileFormats.test.mjs scripts/tests/storageKeys.test.mjs scripts/tests/measureCalibration.test.mjs
git commit -m "feat(sldprt): format switch, conversion rules, GLB key and millimetre units"
```

---

### Task 5: Routes — start and callback

**Files:**
- Create: `lib/cadWorkerToken.ts`
- Create: `scripts/tests/cadWorkerToken.test.mjs`
- Create: `app/api/files/[id]/convert-cad/route.ts`
- Create: `app/api/conversions/cad-callback/route.ts`
- Modify: `lib/routeAccess.ts`
- Test: `scripts/tests/routeAccess.test.mjs`

**Interfaces:**
- Consumes: everything Task 4 produced, `converterEndpoint` from `lib/drawingConversion.ts`, `appBaseUrlOrNull` from `lib/appUrl.ts`, `getDownloadPresignedUrl(key, expiresIn)` and `getUploadPresignedUrl(key, type, expiresIn)` from `lib/s3.ts`, and `getFileAccess` from `lib/access.ts`.
- Produces:
  - **`POST /api/files/[id]/convert-cad`** answers `{conversionStatus, convertedStorageKey, deferredUntil?, reason?}`:
    - 200, normally.
    - 503 with `reason: 'disabled' | 'not-configured' | 'retry'`.
    - 400 when the file isn't a `.sldprt`; 401 or 404 for auth.
  - **`POST /api/conversions/cad-callback`** answers 200, 400, 401 or 503.

- [ ] **Step 1: Write the failing tests**

`scripts/tests/cadWorkerToken.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadCallbackToken, verifyCadCallbackToken } from '../../lib/cadWorkerToken.ts';

test('a token verifies only for its own secret, file and claim', () => {
  const t = cadCallbackToken('s', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z');
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(verifyCadCallbackToken('s', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z', t), true);
  assert.equal(verifyCadCallbackToken('other', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z', t), false);
  assert.equal(verifyCadCallbackToken('s', 'file-2', 'cad:1:2026-10-18T12:00:00.000Z', t), false);
  assert.equal(verifyCadCallbackToken('s', 'file-1', 'cad:2:2026-10-18T12:00:00.000Z', t), false);
  assert.equal(verifyCadCallbackToken('s', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z', 'short'), false);
  assert.equal(verifyCadCallbackToken('s', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z', t.toUpperCase()), false);
});
```

Append to `scripts/tests/routeAccess.test.mjs`:
```js
test('the CAD worker callback is public; its handler checks the token itself', () => {
  assert.equal(routeDecision('/api/conversions/cad-callback', false), 'pass');
  assert.equal(routeDecision('/api/conversions/other', false), 'login');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/tests/cadWorkerToken.test.mjs scripts/tests/routeAccess.test.mjs`
Expected: FAIL. The module isn't found, and the callback route doesn't pass yet: `'login' !== 'pass'`.

- [ ] **Step 3: Implement**

`lib/cadWorkerToken.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The token the CAD worker echoes back to /api/conversions/cad-callback. Bound to the file and the
 * claim, so a late callback from an earlier attempt, or one for another file, never verifies.
 * Server-only (node:crypto): never import this from a client component.
 */
export function cadCallbackToken(secret: string, fileId: string, claimId: string): string {
  return createHmac('sha256', secret).update(`${fileId}:${claimId}`).digest('hex');
}

export function verifyCadCallbackToken(secret: string, fileId: string, claimId: string, token: string): boolean {
  const expected = Buffer.from(cadCallbackToken(secret, fileId, claimId), 'utf8');
  const given = Buffer.from(token, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

`lib/routeAccess.ts`: in `PUBLIC_PATHS`, after `'/api/conversions/webhook',`, add:
```ts
  // The CAD worker's result (cad-worker/ on Modal). No session: the handler checks an HMAC
  // token bound to the file and its current claim (lib/cadWorkerToken.ts).
  '/api/conversions/cad-callback',
```

`app/api/files/[id]/convert-cad/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { getDownloadPresignedUrl, getUploadPresignedUrl } from '@/lib/s3';
import { cadGlbKey } from '@/lib/storageKeys';
import { converterEndpoint } from '@/lib/drawingConversion';
import { appBaseUrlOrNull } from '@/lib/appUrl';
import { sldprtConversionEnabled } from '@/lib/fileFormats';
import { cadCallbackToken } from '@/lib/cadWorkerToken';
import {
  cadClaimId,
  capLikePattern,
  claimDecision,
  firstOfNextMonth,
  isSldprtFilename,
  monthlyCap,
  workerStartOutcome,
  type ConversionStatus,
} from '@/lib/cadConversion';

export const maxDuration = 30;
/** The start endpoint only spawns a job; it answers in well under a second once warm. */
const WORKER_TIMEOUT_MS = 15_000;
/** Covers a queued job plus the worker's 10-minute limit. */
const URL_TTL_S = 3600;

type Row = {
  filename: string;
  storageKey: string;
  conversionStatus: ConversionStatus;
  convertedStorageKey: string | null;
  conversionJobId: string | null;
};

/**
 * Start converting one SolidWorks part to GLB, at most once at a time per file.
 *
 * Called fire-and-forget by the uploader after an upload, and by CadPreparer whenever a .sldprt
 * with no GLB is opened. /api/files is a public middleware prefix, so this checks the session and
 * the caller's access itself. The worker (cad-worker/ on Modal) gets presigned URLs and a callback
 * token, never credentials, and reports to /api/conversions/cad-callback, which finishes the row.
 *
 * Nothing here marks a file 'failed' except giving up after CAD_MAX_ATTEMPTS stale claims: the
 * start endpoint never reads the file, so its replies are never a verdict on it.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = (await sql`
    SELECT filename, storage_key AS "storageKey", conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey", conversion_job_id AS "conversionJobId"
    FROM files WHERE id = ${params.id}
  `) as Row[];
  const file = rows[0];
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!isSldprtFilename(file.filename)) {
    return NextResponse.json({ error: 'Not a SolidWorks part' }, { status: 400 });
  }

  const current = () =>
    NextResponse.json({ conversionStatus: file.conversionStatus, convertedStorageKey: file.convertedStorageKey });
  if (file.convertedStorageKey) return current();

  if (!sldprtConversionEnabled()) {
    return NextResponse.json(
      { conversionStatus: file.conversionStatus, convertedStorageKey: null, reason: 'disabled' },
      { status: 503 }
    );
  }

  // Not configured is not the part's fault: refuse before claiming, so the row stays as it was.
  const secret = process.env.CAD_WORKER_SECRET;
  const workerUrl = converterEndpoint(process.env.CAD_WORKER_URL);
  const base = appBaseUrlOrNull();
  if (!secret || !workerUrl || !base) {
    const problems = [
      !secret && 'CAD_WORKER_SECRET is unset',
      !workerUrl && 'CAD_WORKER_URL is unset or not https',
      !base && 'NEXTAUTH_URL / APP_URL is unset',
    ].filter(Boolean);
    console.error(`SolidWorks conversion is not configured: ${problems.join('; ')}`);
    return NextResponse.json(
      { conversionStatus: file.conversionStatus, convertedStorageKey: null, reason: 'not-configured' },
      { status: 503 }
    );
  }

  const now = new Date();
  const decision = claimDecision(file.conversionStatus, file.conversionJobId, now);
  if (decision.kind === 'final') return current();
  if (decision.kind === 'wait') {
    return NextResponse.json({ conversionStatus: 'processing', convertedStorageKey: null });
  }
  if (decision.kind === 'give-up') {
    console.error(`SolidWorks conversion gave up on file ${params.id} after repeated stale claims`);
    await sql`
      UPDATE files SET conversion_status = 'failed'
      WHERE id = ${params.id} AND conversion_job_id IS NOT DISTINCT FROM ${file.conversionJobId}
    `;
    return NextResponse.json({ conversionStatus: 'failed', convertedStorageKey: null });
  }

  const counted = (await sql`
    SELECT count(*)::int AS n FROM files WHERE conversion_job_id LIKE ${capLikePattern(now)}
  `) as { n: number }[];
  if ((counted[0]?.n ?? 0) >= monthlyCap(process.env.SLDPRT_MONTHLY_CAP)) {
    return NextResponse.json({
      conversionStatus: file.conversionStatus,
      convertedStorageKey: null,
      deferredUntil: firstOfNextMonth(now),
    });
  }

  // Compare-and-set on the values just read: if another request claimed first, no row updates
  // and this one stands down instead of starting a second conversion.
  const claimId = cadClaimId(decision.attempt, now);
  const claimed = await sql`
    UPDATE files SET conversion_status = 'processing', conversion_job_id = ${claimId}
    WHERE id = ${params.id}
      AND converted_storage_key IS NULL
      AND conversion_status IS NOT DISTINCT FROM ${file.conversionStatus}
      AND conversion_job_id IS NOT DISTINCT FROM ${file.conversionJobId}
    RETURNING id
  `;
  if (claimed.length === 0) {
    return NextResponse.json({ conversionStatus: 'processing', convertedStorageKey: null });
  }

  let status: number | null = null;
  let body: unknown = null;
  let reason = '';
  try {
    // redirect 'manual': a redirect would carry the secret elsewhere; it counts as a retry.
    const res = await fetch(workerUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': secret },
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      body: JSON.stringify({
        sourceUrl: await getDownloadPresignedUrl(file.storageKey, URL_TTL_S),
        targetUrl: await getUploadPresignedUrl(cadGlbKey(file.storageKey), 'model/gltf-binary', URL_TTL_S),
        callbackUrl: `${base}/api/conversions/cad-callback`,
        filename: file.filename,
        fileId: params.id,
        claimId,
        token: cadCallbackToken(secret, params.id, claimId),
      }),
    });
    status = res.status;
    const text = await res.text().catch(() => '');
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    reason = `worker answered ${res.status}: ${text.slice(0, 300)}`;
  } catch (err) {
    reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  if (workerStartOutcome(status, body) === 'started') {
    return NextResponse.json({ conversionStatus: 'processing', convertedStorageKey: null });
  }

  console.error(`SolidWorks conversion not started for file ${params.id}, will retry: ${reason}`);
  await sql`
    UPDATE files SET conversion_status = NULL, conversion_job_id = NULL
    WHERE id = ${params.id} AND conversion_job_id = ${claimId}
  `;
  return NextResponse.json(
    { conversionStatus: null, convertedStorageKey: null, reason: 'retry' },
    { status: 503 }
  );
}
```

`app/api/conversions/cad-callback/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { cadGlbKey } from '@/lib/storageKeys';
import { verifyCadCallbackToken } from '@/lib/cadWorkerToken';
import { callbackOutcome, parseCallbackBody } from '@/lib/cadConversion';

/**
 * The CAD worker's result for one claim. Public in middleware (lib/routeAccess.ts): the HMAC token,
 * bound to the file and the claim, is the only authentication. Every write is guarded by
 * conversion_job_id = claimId, so a callback for an earlier attempt changes nothing; it still
 * answers 200, so the worker does not retry it.
 */
export async function POST(request: NextRequest) {
  const body = parseCallbackBody(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const secret = process.env.CAD_WORKER_SECRET;
  if (!secret) {
    console.error('SolidWorks callback received but CAD_WORKER_SECRET is unset');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (!verifyCadCallbackToken(secret, body.fileId, body.claimId, body.token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = (await sql`
    SELECT storage_key AS "storageKey" FROM files
    WHERE id = ${body.fileId} AND conversion_job_id = ${body.claimId}
  `) as { storageKey: string }[];
  if (!rows[0]) {
    console.warn(`SolidWorks callback for a claim that is no longer current: file ${body.fileId}, ${body.claimId}`);
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (callbackOutcome(body) === 'failed') {
    console.error(`SolidWorks conversion failed for file ${body.fileId}: ${body.reason ?? 'no reason given'}`);
    await sql`
      UPDATE files SET conversion_status = 'failed'
      WHERE id = ${body.fileId} AND conversion_job_id = ${body.claimId}
    `;
    return NextResponse.json({ ok: true });
  }

  await sql`
    UPDATE files SET conversion_status = 'completed', converted_storage_key = ${cadGlbKey(rows[0].storageKey)}
    WHERE id = ${body.fileId} AND conversion_job_id = ${body.claimId}
  `;
  // Every place that assigns converted_storage_key must clear this file's calibrations (see
  // lib/schema.sql, file_calibrations). Its own statement, tolerant of its own failure, for the
  // reason given beside the same DELETE in app/api/conversions/webhook/route.ts.
  try {
    await sql`DELETE FROM file_calibrations WHERE file_id = ${body.fileId}`;
  } catch (calibrationErr) {
    console.error(
      `Failed to delete stale file_calibrations for file ${body.fileId} after SolidWorks conversion:`,
      calibrationErr instanceof Error ? calibrationErr.message : String(calibrationErr)
    );
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `node --test scripts/tests/cadWorkerToken.test.mjs scripts/tests/routeAccess.test.mjs && npx tsc --noEmit`
Expected: PASS, and `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add lib/cadWorkerToken.ts scripts/tests/cadWorkerToken.test.mjs lib/routeAccess.ts scripts/tests/routeAccess.test.mjs "app/api/files/[id]/convert-cad/route.ts" app/api/conversions/cad-callback/route.ts
git commit -m "feat(sldprt): start route with claim, cap and worker call; token-checked callback route"
```

---

### Task 6: Viewer, portal and upload wiring

**Files:**
- Create: `components/viewers/CadPreparer.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`
- Modify: `app/portal/[id]/page.tsx`
- Modify: `lib/useUpload.ts`

**Interfaces:**
- Consumes: `isPendingCad`, `opensAsModel`, `isSldprtFilename`, `nextCadPollStep`, `CAD_POLL_INTERVAL_MS`, `ConversionStatus` from `lib/cadConversion.ts`; `sldprtConversionEnabled` from `lib/fileFormats.ts`; the routes from Task 5.
- Produces: `<CadPreparer fileId onConverted(key) onReady />`.

- [ ] **Step 1: Create `components/viewers/CadPreparer.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  CAD_POLL_INTERVAL_MS,
  nextCadPollStep,
  type ConversionStatus,
} from '@/lib/cadConversion';

interface Props {
  fileId: string;
  /** Called once with the GLB's key; the parent swaps the file over to the 3D viewer. */
  onConverted: (convertedStorageKey: string) => void;
  /** Must be called when this ends without a model, to release the page's loading indicator. */
  onReady?: () => void;
}

interface StartBody {
  conversionStatus: ConversionStatus;
  convertedStorageKey: string | null;
  deferredUntil?: string;
  reason?: 'disabled' | 'not-configured' | 'retry';
}

type View =
  | { kind: 'converting' }
  | { kind: 'failed' }
  | { kind: 'deferred'; until: string }
  | { kind: 'disabled' }
  | { kind: 'unavailable' }
  | { kind: 'slow' };

function formatDay(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/**
 * Shown for a .sldprt that has no GLB yet. Asks the server to start a conversion (a no-op if one
 * is running) and polls until the GLB exists, the conversion fails, or CAD_POLL_LIMIT_MS passes.
 * Unlike DrawingPreparer the start call answers at once: the worker reports back on its own.
 */
export default function CadPreparer({ fileId, onConverted, onReady }: Props) {
  const [view, setView] = useState<View>({ kind: 'converting' });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const stop = (next: View) => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setView(next);
      onReady?.();
    };

    const settle = (status: ConversionStatus, key: string | null): boolean => {
      const step = nextCadPollStep(status, key, Date.now() - started);
      if (step === 'done' && key) {
        cancelled = true;
        if (timer) clearTimeout(timer);
        onConverted(key);
        return true;
      }
      if (step === 'failed') {
        stop({ kind: 'failed' });
        return true;
      }
      if (step === 'timeout') {
        stop({ kind: 'slow' });
        return true;
      }
      return false;
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/files/${fileId}/conversion-status`);
        const body = res.ok ? ((await res.json()) as StartBody) : null;
        if (cancelled) return;
        if (body && settle(body.conversionStatus, body.convertedStorageKey)) return;
      } catch {
        // A failed status check is not a verdict; keep polling until the limit.
      }
      if (!cancelled) timer = setTimeout(poll, CAD_POLL_INTERVAL_MS);
    };

    fetch(`/api/files/${fileId}/convert-cad`, { method: 'POST' })
      .then(async (res) => {
        if (cancelled) return;
        const body = (await res.json().catch(() => null)) as StartBody | null;
        if (cancelled) return;
        if (res.status === 503) {
          stop(body?.reason === 'disabled' ? { kind: 'disabled' } : { kind: 'unavailable' });
          return;
        }
        if (!res.ok || !body) {
          stop({ kind: 'unavailable' });
          return;
        }
        if (body.deferredUntil) {
          stop({ kind: 'deferred', until: body.deferredUntil });
          return;
        }
        if (settle(body.conversionStatus, body.convertedStorageKey)) return;
        timer = setTimeout(poll, CAD_POLL_INTERVAL_MS);
      })
      .catch(() => {
        if (!cancelled) stop({ kind: 'unavailable' });
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // onConverted/onReady are callbacks from the parent; restarting on their identity would
    // re-trigger the conversion on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const lines: Record<View['kind'], [string, string | null]> = {
    converting: ['Converting SolidWorks part…', 'The first one after a quiet spell can take a couple of minutes.'],
    failed: ["Couldn't convert this SolidWorks part.", 'Save As STEP in SolidWorks and upload that.'],
    deferred: ['', 'Save As STEP to view it now.'],
    disabled: ['SolidWorks preview is turned off.', 'Save As STEP to view it.'],
    unavailable: ["SolidWorks preview isn't available right now.", 'Try again in a few minutes, or Save As STEP to view it now.'],
    slow: ['Still converting.', 'Check back in a few minutes.'],
  };
  const [title, detail] = lines[view.kind];
  const heading = view.kind === 'deferred' ? `Preview available from ${formatDay(view.until)}.` : title;

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <p className={view.kind === 'converting' ? 'text-sm text-gray-500' : 'text-sm font-medium text-gray-700'}>{heading}</p>
        {detail && <p className="mt-1 text-sm text-gray-500">{detail}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `components/viewers/ViewerContainer.tsx`**

Add the imports:
```tsx
import CadPreparer from './CadPreparer';
import { isPendingCad, opensAsModel } from '@/lib/cadConversion';
```
After `const kind = viewerKindFor(file.filename, file.convertedStorageKey);` add:
```tsx
  // A .sldprt is shown through its GLB; until that exists it is a pending part.
  const pendingCad = isPendingCad(file.filename, file.convertedStorageKey);
```
In the presigned-URL effect:
- change `if (kind === 'drawing') return;` to `if (kind === 'drawing' || pendingCad) return;`
- change the deps to `[viewerKey, kind, pendingCad]`.

In `isViewable`, replace `MODEL_EXTENSIONS.includes(ext);` with `opensAsModel(file.filename, file.convertedStorageKey) || pendingCad;`.

After the `if (kind === 'drawing') { … }` block add:
```tsx
  if (pendingCad) {
    return (
      <CadPreparer
        key={file.id}
        fileId={file.id}
        onConverted={(convertedKey) => onDrawingConverted(file.id, convertedKey)}
        onReady={onReady}
      />
    );
  }
```
Change `if (MODEL_EXTENSIONS.includes(ext)) {` to `if (opensAsModel(file.filename, file.convertedStorageKey)) {`, then delete the now-unused `MODEL_EXTENSIONS` constant. If `tsc`/lint report `MODEL_FORMATS` unused, delete its import too.

Update the `onDrawingConverted` doc comment to:
```tsx
  /**
   * DWG/DXF and SolidWorks parts: the converted PDF or GLB now exists; the parent records it on
   * the file. Required: without it the viewer would keep showing the preparing state.
   */
```
The ModelViewer picks its loader from the URL path (`getExtFromUrl`), and the converted key ends `.sldprt.glb`, so it loads as GLB with no change.

- [ ] **Step 3: Wire `app/portal/[id]/page.tsx`**

Add the import: `import { isPendingCad, opensAsModel } from '@/lib/cadConversion';`

Replace the body of `is3DFile`'s `useMemo` (currently splitting the filename and checking `MODEL_FORMATS.includes(ext)`):
```tsx
  const is3DFile = useMemo(() => {
    if (!selectedFile) return false;
    // A .sldprt counts only once its GLB exists; until then there is no model to measure or pin.
    return opensAsModel(selectedFile.filename, selectedFile.convertedStorageKey);
  }, [selectedFile]);
```
If `MODEL_FORMATS` and `extensionOf` become unused, drop them from the `@/lib/fileFormats` import.

After `selectedIsPendingDrawing` add:
```tsx
  // A .sldprt whose GLB does not exist yet (converting, deferred, failed, or switched off).
  const selectedIsPendingCad =
    !!selectedFile && isPendingCad(selectedFile.filename, selectedFile.convertedStorageKey);
```
In the `LoadingCube` label chain, change `: selectedIsPendingDrawing ? 'Preparing drawing…'` to:
```tsx
                        : selectedIsPendingDrawing
                          ? 'Preparing drawing…'
                          : selectedIsPendingCad
                            ? 'Preparing SolidWorks part…'
                            : 'Opening file…'
```
In the `DrawingTools` condition, change `(!selectedIsPendingDrawing || annotatingFile !== null)` to `((!selectedIsPendingDrawing && !selectedIsPendingCad) || annotatingFile !== null)`.

- [ ] **Step 4: Wire `lib/useUpload.ts`**

Imports:
```ts
import { isSldprtFilename } from '@/lib/cadConversion';
import { sldprtConversionEnabled } from '@/lib/fileFormats';
```
(merge with an existing `@/lib/fileFormats` import if there is one).

After the DWG/DXF `if (isDrawingFilename(entry.file.name)) { … }` block:
```ts
        // SolidWorks: start the GLB conversion now; nothing waits on it, and the viewer starts it
        // again if this is lost.
        if (isSldprtFilename(entry.file.name) && sldprtConversionEnabled()) {
          fetch(`/api/files/${fileId}/convert-cad`, { method: 'POST', keepalive: true }).catch(() => {});
        }
```

- [ ] **Step 5: Type check, lint and tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/viewers/CadPreparer.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx" lib/useUpload.ts
git commit -m "feat(sldprt): CadPreparer and viewer, portal and upload wiring"
```

---

### Task 7: Verification — routes on real Postgres, the viewer in a browser, full gates

**Files:** none committed. Everything here lives in the session scratchpad, except a throwaway harness route that is deleted at the end.

- [ ] **Step 1: Run the routes on PGlite** (recipe: memory `stiko-pglite-sql-harness`)

Build the harness in the scratchpad:
- `npm i @electric-sql/pglite` and load `lib/schema.sql`.
- A loader hook that maps `@/` imports to the repo.
- Stubs:
  - `@/lib/db` → PGlite `sql`
  - `@/lib/auth` → `globalThis.__session`
  - `@/lib/access` → `getFileAccess` returns `{}`
  - `@/lib/s3` → returns `https://acct.r2.cloudflarestorage.com/<key>?sig`
- Replace `globalThis.fetch` with a fake worker that records requests and answers with a scripted status.

Set the env: `CAD_WORKER_SECRET=s`, `CAD_WORKER_URL=https://w.example/start`, `NEXTAUTH_URL=https://app.stiko.design`, `SLDPRT_MONTHLY_CAP=2`.

Seed `users`/`projects`/`portals`/`versions`/`files` with as few rows as `schema.sql` constraints need. Then assert:
1. **First POST** → 200 `processing`. The row is `processing` with `cad:1:…`. The fake worker got all 7 fields, `callbackUrl === 'https://app.stiko.design/api/conversions/cad-callback'`, and a token equal to `cadCallbackToken('s', id, claimId)`.
2. **Second POST while fresh** → `processing`, and the worker was not called again.
3. **Worker answers 500** on a fresh file → 503 `retry`, and the row is back to NULL/NULL.
4. **Stale claim** (set the job id to `cad:1:<20 min ago>`) → claims `cad:2:…`. With `cad:3:<20 min ago>` → `failed`.
5. **Cap:** with 2 other rows holding this month's `cad:` claims → 200 with `deferredUntil` = next month's 1st, and the row is unchanged.
6. **Switch off** (`NEXT_PUBLIC_SLDPRT_CONVERSION=off`, fresh module import) → 503 `disabled`. With `CAD_WORKER_URL` unset → 503 `not-configured`. The row is unchanged in both.
7. **Callback with a good token, `ok: true, glbBytes: 10`** → `completed`, `converted_storage_key = storageKey + '.glb'`, and `file_calibrations` rows for the file are deleted.
8. **Callback with a bad token** → 401. **Old claim id** (valid token for it) → 200 `ignored`, row unchanged. **`ok: false`** → `failed`.
9. **`.step` file** → 400.

- [ ] **Step 2: Check the viewer in a browser**

Copy `app/portal/harness-sldprt/` (already in the working tree, untracked) into a version that renders `ViewerContainer` for a fake `FileRecord` `{ filename: 'part.sldprt', convertedStorageKey: null, … }`.
- **Stubs:** stub `fetch` for `/api/files/*/convert-cad` and `/api/files/*/conversion-status` in Playwright's `page.route`.
- **Scenarios:**
  - converting → completed (serve `/uploads/sldprt-harness/watch.glb` through a stubbed `/api/files/url`)
  - failed
  - deferred
  - disabled
  - not-configured
- **For each:** screenshot it, check the copy matches the spec's state table, and check the watch shows 21 parts after `done`.

- [ ] **Step 3: Run the full gates**

```bash
npx tsc --noEmit && npm run lint && npm test
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
/tmp/cadworker-venv/bin/python -m pytest -q cad-worker/tests
```
Expected: everything passes.

- [ ] **Step 4: Remove the harness**

```bash
rm -rf app/portal/harness-sldprt public/uploads/sldprt-harness .next/types/app/portal/harness-sldprt
git status --short   # only the untracked handoff dirs remain
```

---

### Task 8: Release (production is the only environment)

- [ ] **Step 1: Set the Vercel env vars on stiko** (the user does this; the Vercel CLI is not signed in on this Mac)

Settings → Environment Variables, for **Production**:

| Name | Value |
|---|---|
| `CAD_WORKER_URL` | the `start` URL from Task 3 |
| `CAD_WORKER_SECRET` | the value in the scratchpad's `cad-worker-secret.txt` (paste it; never commit it) |
| `SLDPRT_MONTHLY_CAP` | `300` |
| `NEXT_PUBLIC_SLDPRT_CONVERSION` | `on` |

- [ ] **Step 2: Merge and push**

```bash
git push origin main
```
`main` auto-deploys, which also applies the new env. There's no migration. Check `schema_migrations` anyway, as the memory `stiko-migration-deploy-ordering` asks.

- [ ] **Step 3: Live test**

1. On https://app.stiko.design, upload `cube10mm_sw2022.sldprt` and `watch.sldprt` to a throwaway package.
2. Open each one. Within about 2 minutes it should show the 3D model.
3. The cube measures 10 mm with the measure tool, with no calibration.
4. The watch shows 21 parts.

If either fails, check:
- **stiko logs:** search for "SolidWorks".
- **Modal logs:** `modal app logs stiko-cad-worker`.

- [ ] **Step 4: Rollback, if needed**

Set `NEXT_PUBLIC_SLDPRT_CONVERSION=off` and redeploy.
