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
          left=False, invisible=False, normals=True, rotate=None):
    path = str(tmp_path / 'in.usda')
    s = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageMetersPerUnit(s, mpu)
    UsdGeom.SetStageUpAxis(s, UsdGeom.Tokens.y if up == 'Y' else UsdGeom.Tokens.z)
    for i in range(meshes):
        UsdGeom.Xform.Define(s, f'/Part/Body{i}')
        if rotate is not None:
            axis, deg = rotate
            add = {'X': 'AddRotateXOp', 'Y': 'AddRotateYOp', 'Z': 'AddRotateZOp'}[axis]
            getattr(UsdGeom.Xformable(s.GetPrimAtPath(f'/Part/Body{i}')), add)().Set(deg)
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
    with open(path, 'rb') as f:
        data = f.read()
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


def _accessor(gltf, binary, index):
    acc = gltf['accessors'][index]
    return acc, gltf['bufferViews'][acc['bufferView']]['byteOffset'] + acc.get('byteOffset', 0)


def _vec3s(gltf, binary, index):
    acc, off = _accessor(gltf, binary, index)
    return [struct.unpack_from('<fff', binary, off + k * 12) for k in range(acc['count'])]


def _indices(gltf, binary, index):
    acc, off = _accessor(gltf, binary, index)
    fmt, step = ('<I', 4) if acc['componentType'] == 5125 else ('<H', 2)
    return [struct.unpack_from(fmt, binary, off + k * step)[0] for k in range(acc['count'])]


def _triangles(gltf, binary):
    """Yield (positions, normals) per triangle, each a list of three vertex tuples, in index order."""
    for mesh in gltf['meshes']:
        for p in mesh['primitives']:
            pos = _vec3s(gltf, binary, p['attributes']['POSITION'])
            nor = _vec3s(gltf, binary, p['attributes']['NORMAL'])
            idx = _indices(gltf, binary, p['indices'])
            for k in range(0, len(idx), 3):
                yield [pos[i] for i in idx[k:k + 3]], [nor[i] for i in idx[k:k + 3]]


@pytest.mark.parametrize('rotate', [('Z', 90), ('X', 90), ('Y', 45)])
def test_normals_follow_a_rotated_part(tmp_path, rotate):
    out = str(tmp_path / 'o.glb')
    usd_to_glb.convert(stage(tmp_path, rotate=rotate), out)
    gltf, binary = read_glb(out)
    checked = 0
    for tri, nrm in _triangles(gltf, binary):
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
        ux, uy, uz = (bx - ax, by - ay, bz - az)
        vx, vy, vz = (cx - ax, cy - ay, cz - az)
        g = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
        n = [sum(v[i] for v in nrm) / 3 for i in range(3)]
        assert g[0] * n[0] + g[1] * n[1] + g[2] * n[2] > 0
        checked += 1
    assert checked == 12


def test_unreadable_usd_is_a_verdict(tmp_path):
    script = os.path.join(os.path.dirname(HERE), 'usd_to_glb.py')
    bad = tmp_path / 'bad.usdc'
    bad.write_bytes(b'not usd')
    r = subprocess.run([sys.executable, script, str(bad), str(tmp_path / 'o.glb')], capture_output=True, text=True)
    assert r.returncode == 3 and 'unreadable USD' in r.stderr


def test_out_of_range_face_index_is_malformed(tmp_path):
    path = stage(tmp_path)
    s = Usd.Stage.Open(path)
    UsdGeom.Mesh.Get(s, '/Part/Body0/Mesh').GetFaceVertexIndicesAttr().Set(CUBE_INDICES[:-1] + [99])
    s.GetRootLayer().Save()
    with pytest.raises(usd_to_glb.ConversionError, match='malformed mesh'):
        usd_to_glb.convert(path, str(tmp_path / 'o.glb'))


def test_singular_transform_has_no_normals(tmp_path):
    path = stage(tmp_path)
    s = Usd.Stage.Open(path)
    UsdGeom.Xformable(s.GetPrimAtPath('/Part/Body0')).AddScaleOp().Set(Gf.Vec3f(0, 0, 0))
    s.GetRootLayer().Save()
    out = str(tmp_path / 'o.glb')
    usd_to_glb.convert(path, out)
    assert all('NORMAL' not in p['attributes'] for p in read_glb(out)[0]['meshes'][0]['primitives'])
