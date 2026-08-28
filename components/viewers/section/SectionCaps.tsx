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
  // Nullable so the callback ref below can clear a slot on unmount instead of leaving a
  // detached THREE.Mesh pinned in the array for the component's remaining lifetime.
  const caps = useRef<(THREE.Mesh | null)[]>([]);
  // Identity of the `planesRef.current` array last bound onto the caps' `clippingPlanes`, so
  // the frame loop below can rebind only when that identity changes instead of every frame.
  const boundPlanes = useRef<THREE.Plane[] | null>(null);

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
      // `planesRef.current[i]` is only populated once ApplyCrossSection's own passive effect
      // has run — it, not this component, owns the write. That effect commits before this one
      // solely because ApplyCrossSection is mounted as the earlier sibling in
      // ModelViewerInner.tsx (`section-${url}` above `caps-${url}`) and React flushes passive
      // effects in tree order. Reorder those two, or interpose anything that defers that write,
      // and every iteration below bails: no stencil proxies get built, the caps test against an
      // all-zero stencil, and they render invisible — permanently, since this effect's deps
      // give it no reason to retry. Nothing logs and nothing throws. See the `section-`/
      // `measure-` key comment at the ApplyCrossSection mount site for the sibling case this
      // mirrors.
      const plane = planesRef.current[i];
      if (!plane) return;

      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        // SkinnedMesh and InstancedMesh both report isMesh === true, but the plain THREE.Mesh
        // proxy built below cannot stand in for either: it has no skeleton to pose, so a
        // SkinnedMesh posed away from bind pose would contribute its unskinned geometry, and it
        // has no per-instance transforms, so an InstancedMesh would contribute one instance at
        // the base transform instead of N. Either way the stencil mask would land somewhere the
        // visible geometry isn't, and a cap would fill a region where there is nothing. Skip
        // them so the failure mode is "no cap contribution from this mesh", not "a cap in the
        // wrong place". This is not a live bug in the current pipeline — optimizeGlb.ts refuses
        // documents requiring EXT_mesh_gpu_instancing and its fallback path uploads the
        // original, so nothing produced today reaches here — it defends against an upload the
        // pipeline happens to let through.
        if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) return;

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
          // Deliberately NOT excludeFromSnapshot: cut faces are part of the design being
          // reviewed, unlike the plane widgets and gizmo handles, so the annotation-snapshot
          // path (which tests `excludeFromSnapshot && visible`) should keep them in frame.
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

    // lib/threeMaterials.ts's setClippingPlanes doc states the rule: pass the SAME array
    // instance across frames and mutate the planes it holds, because changing the NUMBER of
    // clipping planes on a material recompiles its shader. ApplyCrossSection honours that —
    // it allocates a new THREE.Plane[] only when the SET of cutting planes changes and mutates
    // the same instances in place otherwise — so that array's identity is the reliable signal
    // for "the plane set changed" here too. Comparing lengths is not enough: {1,2} -> {1,3}
    // keeps the length but replaces the Plane instances, and every cap would stay clipped by a
    // stale object. Rebind only when the identity differs, not every frame.
    const planes = planesRef.current;
    if (planes !== boundPlanes.current) {
      boundPlanes.current = planes;
      for (let i = 0; i < ids.length; i++) {
        const cap = caps.current[i];
        if (cap) {
          // Every plane except this one, so a cap stops at a neighbouring cut.
          (cap.material as THREE.Material).clippingPlanes = planes.filter((_, j) => j !== i);
        }
      }
    }

    // Keep each stencil proxy on its source mesh, and each cap quad on its plane. Done per
    // frame for the same reason the clipping planes are tracked live: a gizmo drag does not go
    // through React.
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
      }
    }
  });

  if (!CAPS_ENABLED || ids.length === 0) return null;

  return (
    <group ref={group}>
      {ids.map((id, i) => (
        <mesh
          key={`cap-${id}`}
          ref={(mesh) => { caps.current[i] = mesh; }}
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
