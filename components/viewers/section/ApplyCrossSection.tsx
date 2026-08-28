'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { setClippingPlanes } from '@/lib/threeMaterials';
import { cuttingPlaneIds, writePlaneFromMatrix, type PlaneId, type SectionSlots } from '@/lib/crossSection';

/**
 * Clips the model to every cutting plane.
 *
 * The planes are rewritten from the widgets' world matrices every FRAME rather than on prop
 * change: TransformControls mutates a widget directly while dragging without going through
 * React, so a change-driven sync would leave the cut lagging behind the plane mid-drag. Same
 * reason the single-plane version did it, for the same reason.
 *
 * The array handed to the materials keeps its identity for as long as the SET of cutting
 * planes is unchanged. Changing the number of clipping planes on a material recompiles its
 * shader; changing a plane's values does not. Unlike the single-plane tool the count really
 * does vary here, so the array is rebuilt — but only when a slot starts or stops cutting,
 * never per frame.
 */
export default function ApplyCrossSection({
  slots,
  modelRef,
  planeObjects,
  planesRef,
}: {
  slots: SectionSlots;
  modelRef: React.RefObject<THREE.Object3D>;
  /** Widget groups, registered by SectionPlaneWidget as they mount. */
  planeObjects: React.MutableRefObject<Map<PlaneId, THREE.Group>>;
  /** Written here, read by the two raycast guards. */
  planesRef: React.MutableRefObject<THREE.Plane[]>;
}) {
  const ids = cuttingPlaneIds(slots);
  // A primitive key, so the memo below survives a slots object rebuilt by an unrelated flag
  // change — flipping a plane must not recompile every material's shader.
  const key = ids.join(',');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const planes = useMemo(() => ids.map(() => new THREE.Plane()), [key]);
  const normalMatrix = useRef(new THREE.Matrix3());

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    setClippingPlanes(model, planes.length > 0 ? planes : null);
    planesRef.current = planes;

    // useLoader caches loader results, so glTF/OBJ materials are shared and outlive this
    // viewer. STL and PLY are worse: they render with module-level singleton materials shared
    // by every STL/PLY opened in the session and never disposed — so a missed cleanup here
    // does not just linger in this file, it clips every STL/PLY opened afterwards too, with
    // no control on screen to explain it and no way back short of a reload.
    return () => {
      setClippingPlanes(model, null);
      planesRef.current = [];
    };
  }, [planes, modelRef, planesRef]);

  useFrame(() => {
    for (let i = 0; i < ids.length; i++) {
      const object = planeObjects.current.get(ids[i]);
      if (!object) continue;
      writePlaneFromMatrix(planes[i], object.matrixWorld, slots[ids[i]].flipped, normalMatrix.current);
    }
  });

  return null;
}
