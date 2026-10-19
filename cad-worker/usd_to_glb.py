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
