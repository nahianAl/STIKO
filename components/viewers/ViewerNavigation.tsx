'use client';

import { useThree, useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type CameraControlsImpl from 'camera-controls';
import { isPointerOverGizmo } from '@/lib/gizmoLayout';
import { pivotForPointer, clampAnchorDistance, isZoomingIn, type Vec3 } from '@/lib/viewerNavigation';

interface ViewerNavigationProps {
  modelRef: React.RefObject<THREE.Object3D>;
  /** Where a rotate drag pivots when it starts over empty background. */
  center: THREE.Vector3;
}

/**
 * Anchors the camera's orbit pivot to whatever the cursor is over.
 *
 * Dolly and truck steps are a percentage of the pivot distance, so the pivot decides how fast
 * every gesture feels. Pinned to the model's centre — as it was — that percentage is measured
 * against an abstract point the user is not looking at, and collapses to nothing as they move
 * in. Measured against the surface under the cursor instead, it is scale-free: a 1-unit part
 * and a 5,000-unit building behave identically, at every zoom level.
 *
 * Listeners are in the CAPTURE phase because camera-controls listens in the bubble phase. That
 * ordering is the point: the pivot is already re-anchored by the time the library handles the
 * same event, so the very first notch of a scroll uses the new pivot rather than the old one.
 */
export default function ViewerNavigation({ modelRef, center }: ViewerNavigationProps) {
  const { camera, gl, controls } = useThree();

  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  const scratch = useRef(new THREE.Vector3());
  // Raycasts are capped at one per rendered frame; cleared below in useFrame. A trackpad
  // emits wheel events far faster than frames, and an unthrottled raycast against a
  // several-hundred-thousand-triangle model would reintroduce the stutter this work removes.
  const anchoredThisFrame = useRef(false);

  const hitUnderPointer = useCallback(
    (clientX: number, clientY: number): Vec3 | null => {
      const model = modelRef.current;
      if (!model) return null;

      const rect = gl.domElement.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      // The view gizmo is a HUD layer, not scene geometry, and its React Three Fiber
      // stopPropagation does not reach these native listeners — so exclude its rect by hand,
      // as SceneInteraction does.
      if (isPointerOverGizmo(x, y, rect.width)) return null;

      ndc.current.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      raycaster.current.setFromCamera(ndc.current, camera);

      // Scoped to the model alone, not the scene: the ground disc, contact shadow and axis
      // lines are all Mesh-derived and large enough to fill the viewport, so an unscoped
      // raycast would report a hit for empty background and defeat the centre fallback.
      const hits = raycaster.current.intersectObject(model, true);
      for (const hit of hits) {
        if (hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh) {
          return [hit.point.x, hit.point.y, hit.point.z];
        }
      }
      return null;
    },
    [camera, gl, modelRef],
  );

  const anchorPivot = useCallback(
    (clientX: number, clientY: number, fallback: Vec3 | null) => {
      const cc = controls as unknown as CameraControlsImpl | null;
      if (!cc?.setOrbitPoint) return;

      const pivot = pivotForPointer(hitUnderPointer(clientX, clientY), fallback);
      if (!pivot) return;

      const offset = scratch.current.set(pivot[0], pivot[1], pivot[2]).sub(camera.position);
      const distance = offset.length();
      if (distance === 0) return;

      // Limits live on the controls, assigned by FitCameraToModel from the model's framing.
      const clamped = clampAnchorDistance(distance, cc.minDistance, cc.maxDistance);
      offset.multiplyScalar(clamped / distance).add(camera.position);

      cc.setOrbitPoint(offset.x, offset.y, offset.z);
    },
    [camera, controls, hitUnderPointer],
  );

  useEffect(() => {
    const canvas = gl.domElement;
    const cc = controls as unknown as CameraControlsImpl | null;

    const onPointerDown = (event: PointerEvent) => {
      // Left button only — that is the rotate action in camera-controls' default mapping.
      if (event.button !== 0) return;
      // Background drags fall back to the model's centre, which is what makes a drag started
      // over empty space orbit the whole object and keep it in frame.
      anchorPivot(event.clientX, event.clientY, [center.x, center.y, center.z]);
    };

    const onWheel = (event: WheelEvent) => {
      // infinityDolly holds the distance and pushes the pivot instead of stopping at a limit.
      // That is wanted zooming IN — it is what lets the camera approach a wall and keep going
      // rather than freezing asymptotically. It is NOT wanted zooming out: the same branch
      // fires on maxDistance and would push the pivot away without limit, shrinking the model
      // to nothing and eventually clipping it through the far plane, with no reset control to
      // recover. So it is enabled per event, by direction.
      if (cc) cc.infinityDolly = isZoomingIn(event.deltaY);

      if (anchoredThisFrame.current) return;
      anchoredThisFrame.current = true;
      // No fallback: scrolling over background leaves the pivot where the user put it.
      anchorPivot(event.clientX, event.clientY, null);
    };

    canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
      canvas.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [gl, controls, anchorPivot, center]);

  useFrame(() => {
    anchoredThisFrame.current = false;
  });

  return null;
}
