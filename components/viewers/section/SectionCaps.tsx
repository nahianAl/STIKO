'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cuttingPlaneIds, type PlaneId, type SectionSlots } from '@/lib/crossSection';

/**
 * Solid faces where the cross-section planes cut the model.
 *
 * The single switch for the whole feature. Caps are a rendering nicety layered on top of the
 * clipping, never a part of it: set this false and the cuts still work exactly as before.
 *
 * Annotated `boolean` rather than left to infer the literal type `true`, so flipping it is a
 * one-character edit rather than one that makes TypeScript call every guard below unreachable.
 */
const CAPS_ENABLED: boolean = true;

const CAP_COLOUR = '#C6CDE8'; // stiko-dashed — a light neutral that reads as cut material.

/**
 * three's stencil capping, once per cutting plane.
 *
 * For each plane: draw the model's back faces incrementing the stencil buffer and its front
 * faces decrementing it, both clipped by that plane. Wherever the count is nonzero the plane
 * is inside solid material, so a quad drawn there — clipped by the OTHER planes, so it does
 * not spill past their cuts — fills the section. The stencil is cleared after each cap so the
 * three planes cannot contaminate each other.
 *
 * KNOWN LIMITATION, accepted deliberately. The count only balances on closed manifold
 * geometry, and this viewer renders everything DoubleSide because uploaded models are
 * routinely thin-walled or open — mesh seats, perforated shells, lofted surfaces, unclosed
 * CAD solids. Those cap wrong: stray filled regions rather than a clean face. Solid CAD, STEP
 * especially, is where this looks right. If it misbehaves on real models, set CAPS_ENABLED
 * false above and nothing else changes.
 *
 * COST. Two extra draw calls per mesh per plane, so 6N for three planes over N meshes. GLB
 * import already merges draw calls, which keeps N low for the common case.
 */
export default function SectionCaps({
  slots,
  modelRef,
  planeObjects,
  planesRef,
  size,
}: {
  slots: SectionSlots;
  modelRef: React.RefObject<THREE.Object3D>;
  planeObjects: React.MutableRefObject<Map<PlaneId, THREE.Group>>;
  planesRef: React.MutableRefObject<THREE.Plane[]>;
  /** Edge length of the cap quad. Must cover the model's whole cross-section. */
  size: number;
}) {
  const { gl } = useThree();
  const ids = cuttingPlaneIds(slots);
  const key = ids.join(',');

  const group = useRef<THREE.Group>(null);
  const caps = useRef<THREE.Mesh[]>([]);

  // Rebuilt only when the set of cutting planes changes — the stencil groups mirror the
  // model's geometry and are expensive to assemble.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stencilGroups = useMemo(() => ids.map(() => new THREE.Group()), [key]);

  useEffect(() => {
    if (!CAPS_ENABLED) return;
    const model = modelRef.current;
    const root = group.current;
    if (!model || !root) return;

    // One stencil group per plane, each a copy of every mesh in the model rendered with no
    // colour output — front faces and back faces separately, so their stencil ops cancel
    // wherever the plane is outside the solid.
    ids.forEach((id, i) => {
      const stencil = stencilGroups[i];
      const plane = planesRef.current[i];
      if (!plane) return;

      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;

        for (const side of [THREE.BackSide, THREE.FrontSide] as const) {
          const material = new THREE.MeshBasicMaterial();
          material.depthWrite = false;
          material.depthTest = false;
          material.colorWrite = false;
          material.stencilWrite = true;
          material.stencilFunc = THREE.AlwaysStencilFunc;
          material.side = side;
          material.clippingPlanes = [plane];
          material.stencilFail = side === THREE.BackSide ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp;
          material.stencilZFail = material.stencilFail;
          material.stencilZPass = material.stencilFail;

          const proxy = new THREE.Mesh(mesh.geometry, material);
          proxy.matrixAutoUpdate = false;
          proxy.userData.sourceMesh = mesh;
          proxy.userData.excludeFromSnapshot = false;
          proxy.renderOrder = i * 2 + 1;
          stencil.add(proxy);
        }
      });

      root.add(stencil);
    });

    return () => {
      for (const stencil of stencilGroups) {
        for (const child of [...stencil.children]) {
          const proxy = child as THREE.Mesh;
          // The geometry is the MODEL's and is not ours to dispose; the material is.
          (proxy.material as THREE.Material).dispose();
        }
        stencil.clear();
        stencil.removeFromParent();
      }
    };
    // Keyed on the SET of cutting planes, never on `ids` itself: cuttingPlaneIds returns a
    // fresh array every render, so listing it here would tear down and rebuild every stencil
    // group — a copy of the whole model — on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stencilGroups, modelRef, planesRef]);

  // The cap quads themselves: drawn only where the stencil count is nonzero, clipped by every
  // OTHER plane so a cap cannot spill past a neighbouring cut.
  const capMaterials = useMemo(
    () =>
      ids.map((_, i) => {
        const material = new THREE.MeshBasicMaterial({ color: CAP_COLOUR, side: THREE.DoubleSide });
        material.stencilWrite = true;
        material.stencilRef = 0;
        material.stencilFunc = THREE.NotEqualStencilFunc;
        material.stencilFail = THREE.ReplaceStencilOp;
        material.stencilZFail = THREE.ReplaceStencilOp;
        material.stencilZPass = THREE.ReplaceStencilOp;
        material.userData.capIndex = i;
        return material;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => () => { for (const m of capMaterials) m.dispose(); }, [capMaterials]);

  useFrame(() => {
    if (!CAPS_ENABLED) return;
    // Keep each stencil proxy on its source mesh, and each cap quad on its plane. Done per
    // frame for the same reason the clipping planes are: a gizmo drag does not go through
    // React.
    for (let i = 0; i < ids.length; i++) {
      const stencil = stencilGroups[i];
      for (const child of stencil.children) {
        const proxy = child as THREE.Mesh;
        const source = proxy.userData.sourceMesh as THREE.Mesh | undefined;
        if (source) proxy.matrix.copy(source.matrixWorld);
      }

      const cap = caps.current[i];
      const object = planeObjects.current.get(ids[i]);
      if (cap && object) {
        cap.position.setFromMatrixPosition(object.matrixWorld);
        cap.quaternion.setFromRotationMatrix(object.matrixWorld);
        // Every plane except this one, so a cap stops at a neighbouring cut.
        (cap.material as THREE.Material).clippingPlanes = planesRef.current.filter((_, j) => j !== i);
      }
    }
  });

  if (!CAPS_ENABLED || ids.length === 0) return null;

  return (
    <group ref={group}>
      {ids.map((id, i) => (
        <mesh
          key={`cap-${id}`}
          ref={(mesh) => { if (mesh) caps.current[i] = mesh; }}
          renderOrder={i * 2 + 2}
          material={capMaterials[i]}
          // The stencil buffer is per-frame shared state: leave it dirty and the next cap
          // draws through this one's mask.
          onAfterRender={() => gl.clearStencil()}
        >
          <planeGeometry args={[size, size]} />
        </mesh>
      ))}
    </group>
  );
}
