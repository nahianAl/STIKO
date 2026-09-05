'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
 * import already merges draw calls, which keeps N low for the common case — but STEP, OBJ, DAE
 * and 3DS all load UNMERGED. lib/STEPLoader.ts in particular emits one mesh, with its own
 * material, per OCCT solid, so a several-hundred-mesh STEP assembly can mean thousands of
 * extra meshes and materials built synchronously in the effect below, and thousands of extra
 * draw calls per frame in the useFrame below that. See MESH_CAP_CEILING for the mitigation.
 */

/**
 * Ceiling on the model's mesh count above which this component builds no caps at all.
 *
 * The gate this feeds tests MESH COUNT ONLY, with no term for how many cutting planes are
 * active — see the `meshCount > MESH_CAP_CEILING` check below, which does not multiply by
 * `ids.length`. So this is a bound on meshes, not on the total proxy/draw-call cost derived in
 * the COST note above: a 151-mesh model with a single plane trips it (302 extra proxies) while a
 * 150-mesh model with all three planes active does not (900 extra proxies, well past that
 * derivation's own 900-at-three-planes figure). That is accepted as-is — a mesh-count ceiling is
 * the simpler thing to reason about and to explain in the console.warn below — but do not read
 * this constant as if it were sized against total proxy cost, because the check does not test
 * that. 150 is a GUESS standing in for a measurement nobody has taken yet (this viewer's frame
 * rate under a heavy STEP assembly with caps on has never been profiled), not a threshold
 * derived from one — treat it as a placeholder to revisit once someone does.
 */
const MESH_CAP_CEILING = 150;

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
  // The proxy materials built below, captured as they are created rather than read back off
  // `stencil.children` at cleanup time. When the root <group> below unmounts (master toggle
  // off, plane count to zero, model change), R3F's `removeChild` runs `removeRecursive` over
  // its children in the MUTATION phase — which empties these imperatively-added stencil groups
  // — before this effect's own passive cleanup runs. By then `stencil.children` is already
  // empty, so enumerating it disposes nothing. This ref is the disposal list instead, so it
  // does not matter whether the groups still hold their children when cleanup runs.
  const proxyMaterials = useRef<THREE.Material[]>([]);
  // Identity of the `planesRef.current` array last bound onto the caps' `clippingPlanes`, so
  // the frame loop below can rebind only when that identity changes instead of every frame.
  const boundPlanes = useRef<THREE.Plane[] | null>(null);
  // Set by the build effect below once it has counted the model's meshes, so the render at the
  // bottom can bail out exactly like CAPS_ENABLED false — no group, no cap quads, nothing added
  // to the scene graph — rather than rendering inert cap meshes that a lingering CSS-like
  // "it's there but does nothing" state would leave behind.
  //
  // In practice this only ever gets set ONCE per mount, and the one-time console.warn below
  // rides on that: setting it true nulls `group.current` on the next render (see the returned
  // `null` at the bottom), and every later run of the build effect below bails out at its
  // `if (!model || !root) return` before it can count meshes again — so once tripped, this
  // never gets a chance to re-evaluate or reset for the rest of the mount's life, no matter how
  // many times `key` below changes. That is a side effect of the early-return guard, not
  // something this effect sets out to do, and it is only safe because this component is keyed
  // on the model url (`caps-${url}` at the mount site) and therefore remounts fresh — with a
  // new `group` ref and a new `exceedsCeiling` — for every new model. Drop that key, or render
  // the root <group> unconditionally instead of bailing to null, and this latch breaks: the
  // ceiling would go back to being evaluated on every plane-set change, and the warning below
  // would fire on every one of them for a model over the ceiling, not just the first.
  const [exceedsCeiling, setExceedsCeiling] = useState(false);

  // Rebuilt only when the set of cutting planes changes — the stencil groups mirror the
  // model's geometry and are expensive to assemble.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stencilGroups = useMemo(() => ids.map(() => new THREE.Group()), [key]);

  useEffect(() => {
    if (!CAPS_ENABLED) return;
    const model = modelRef.current;
    const root = group.current;
    if (!model || !root) return;

    // Counted once here, when the caps for this plane set are (re)built — never per frame.
    // Same filter as the proxy loop below: a SkinnedMesh, InstancedMesh or BatchedMesh
    // contributes no proxy there, so it costs nothing and should not count against the ceiling
    // either.
    let meshCount = 0;
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh || mesh instanceof THREE.BatchedMesh) return;
      meshCount++;
    });

    if (meshCount > MESH_CAP_CEILING) {
      // The only place this decision is made, so it is the only place it can be logged —
      // once per build, not per frame. Without this, a hollow section on a heavy STEP
      // assembly looks like a silent rendering bug rather than the ceiling doing its job.
      console.warn(
        `SectionCaps: skipping stencil caps — model has ${meshCount} meshes, over the ` +
          `${MESH_CAP_CEILING}-mesh ceiling (see the MESH_CAP_CEILING comment). Cuts will ` +
          'render hollow instead of solid-faced.'
      );
      setExceedsCeiling(true);
      // No partial set: nothing below runs, so no stencil group is populated and no material
      // is created for this build. This effect returns no cleanup on this path, but none is
      // owed — React already ran the PREVIOUS build's cleanup (which emptied
      // proxyMaterials.current and detached the stencil groups) before invoking this run, as
      // it does on every dependency change.
      return;
    }
    setExceedsCeiling(false);

    // Built up alongside the proxies below and swapped into the ref once `ids.forEach` finishes.
    // The `if (!plane) return` below is a `return` from the forEach CALLBACK, not from this
    // effect — it skips building proxies for that one plane and the loop moves on to the next
    // id; it is not a bail-out of the whole build. So `materials` can legitimately end up
    // short of `ids.length * 2 * meshCount` when a plane is skipped, and that is fine: the
    // invariant this relies on is only that the ref ends up holding exactly the proxies that
    // were actually created, matching what the cleanup below needs to dispose — not that
    // construction is all-or-nothing.
    const materials: THREE.Material[] = [];

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
        // SkinnedMesh, InstancedMesh and BatchedMesh all report isMesh === true, but the plain
        // THREE.Mesh proxy built below cannot stand in for any of them: it has no skeleton to
        // pose, so a SkinnedMesh posed away from bind pose would contribute its unskinned
        // geometry; it has no per-instance transforms, so an InstancedMesh would contribute one
        // instance at the base transform instead of N. Either way the stencil mask would land
        // somewhere the visible geometry isn't, and a cap would fill a region where there is
        // nothing. Skip them so the failure mode is "no cap contribution from this mesh", not "a
        // cap in the wrong place". This is not a live bug in the current pipeline for the first
        // two — optimizeGlb.ts refuses documents requiring EXT_mesh_gpu_instancing and its
        // fallback path uploads the original, so nothing produced today reaches here for
        // InstancedMesh — it defends against an upload the pipeline happens to let through.
        //
        // BatchedMesh is different: the viewer's own batched-rendering path (ModelViewerInner's
        // <Model>) produces one for every model with parts, so this exclusion is reached on
        // every such model, not a defensive edge case. `mesh.geometry` on a BatchedMesh is the
        // shared, merged buffer holding every part's vertices in that part's own LOCAL space —
        // placement lives only in an internal matrix texture, applied per instance in the vertex
        // shader via getMatrixAt, never baked into `.geometry`. A `new THREE.Mesh(mesh.geometry,
        // stencilMaterial)` proxy copying a single `matrixWorld` (as the loop below does) would
        // therefore draw every part's stencil contribution overlaid at its own raw local-space
        // position under one transform — garbled geometry, not a slightly-wrong cap. Excluding
        // it here keeps the graceful, already-documented "cuts render hollow" mode instead of
        // building a wrong solid fill. A real fix needs one stencil proxy PER INSTANCE, built
        // from getMatrixAt/getBoundingBoxAt the way BatchedMesh.raycast() does internally — a
        // proper follow-up, not attempted here.
        if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh || mesh instanceof THREE.BatchedMesh) return;

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
          materials.push(material);
        }
      });

      root.add(stencil);
    });

    proxyMaterials.current = materials;

    return () => {
      // Disposed from the captured list above, NOT from `stencil.children` — by the time this
      // runs, R3F may already have emptied it (see the ref's own doc comment for why). The
      // geometry on each proxy is the MODEL's and is not ours to dispose; only the material is.
      for (const material of proxyMaterials.current) material.dispose();
      proxyMaterials.current = [];
      for (const stencil of stencilGroups) {
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
    // exceedsCeiling: no proxies were built and no cap meshes are mounted (see the render
    // below), so there is nothing here to rebind or reposition. Cheap either way — the loops
    // below would just iterate over empty stencil groups and null refs — but skip it anyway
    // for the same reason CAPS_ENABLED does: state, not luck.
    if (!CAPS_ENABLED || exceedsCeiling) return;

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

  // exceedsCeiling bails out exactly like CAPS_ENABLED false: no <group>, no cap <mesh>
  // elements, nothing in the scene graph — not inert cap quads left mounted with nothing
  // behind them, which would be a second, subtler way to end up with a "partial" result.
  if (!CAPS_ENABLED || ids.length === 0 || exceedsCeiling) return null;

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
