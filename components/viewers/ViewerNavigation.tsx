'use client';

import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type CameraControlsImpl from 'camera-controls';
import { isPointerOverGizmo } from '@/lib/gizmoLayout';
import { pivotForPointer, clampAnchorDistance, isZoomingIn, type Vec3 } from '@/lib/viewerNavigation';

interface ViewerNavigationProps {
  modelRef: React.RefObject<THREE.Object3D>;
  /** Where a rotate drag pivots when it starts over empty background. */
  center: THREE.Vector3;
  /** The live cross-section plane, or null when none is open. Written by ApplyCrossSection. */
  clipPlaneRef: React.MutableRefObject<THREE.Plane | null>;
}

/**
 * Anchors the camera's ORBIT pivot to whatever the cursor is over, and keeps the limitless
 * fly-through dolly confined to the wheel.
 *
 * Dolly and truck steps are a percentage of the distance from the camera to its pivot, so the
 * pivot decides how fast every gesture feels. Pinned to the model's centre — as it was — that
 * percentage is measured against an abstract point the user is not looking at, and collapses to
 * nothing as they move in. Anchoring it to the surface under the cursor when a rotate drag
 * starts makes the rotation happen about the part being inspected rather than swinging it out
 * of frame, and leaves the pivot on that part for the pan steps that follow.
 *
 * The WHEEL deliberately does NOT re-anchor, and must not be made to. camera-controls'
 * dollyToCursor already migrates the target toward the cursor as the radius shrinks — measured,
 * it holds the world point under the cursor at a fixed 0.500 NDC across a 40-frame gesture while
 * the radius keeps falling, which is exactly the mechanism that stops zoom crawling near a large
 * model. Calling setOrbitPoint on the wheel destroys it: setOrbitPoint rewrites the private
 * _spherical.radius but not the _lastDistance it is diffed against, and update() only refreshes
 * _lastDistance at the very end of its own pass. The next frame's dollyToCursor correction
 * therefore reads the anchor snap as though the dolly had produced it, and drags _targetEnd —
 * and the camera with it — toward the cursor plane by that whole amount. Measured with the
 * re-anchoring in place, the same point slid from 0.500 to -0.282 NDC over those 40 frames: what
 * you point at pops through screen centre and out the far side, the exact inverse of the feature.
 *
 * Listeners are in the CAPTURE phase because camera-controls binds its own in the BUBBLE phase
 * on an ANCESTOR of the canvas, not on the canvas itself — drei hands it events.connected, which
 * R3F v8 sets to the Canvas wrapper div. Capture on a descendant still runs before bubble on an
 * ancestor, so the pivot and the infinityDolly flag are settled before the library acts on the
 * same event.
 */
export default function ViewerNavigation({ modelRef, center, clipPlaneRef }: ViewerNavigationProps) {
  const { camera, gl, controls } = useThree();

  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  const scratch = useRef(new THREE.Vector3());

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
      const clip = clipPlaneRef.current;
      for (const hit of hits) {
        if (!(hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh)) continue;

        // three's raycaster ignores clipping planes entirely, so the half a cross-section
        // hides stays fully hittable. Without this, orbiting into an opened cavity pivots
        // about invisible geometry sitting in front of everything the user can actually see.
        // distanceToPoint is negative on the side three clips away — same guard, same reason,
        // as SceneInteraction's pin-drop raycast.
        if (clip && clip.distanceToPoint(hit.point) < 0) continue;

        return [hit.point.x, hit.point.y, hit.point.z];
      }
      return null;
    },
    [camera, gl, modelRef, clipPlaneRef],
  );

  const anchorPivot = useCallback(
    (clientX: number, clientY: number, fallback: Vec3) => {
      const cc = controls as unknown as CameraControlsImpl | null;
      if (!cc?.setOrbitPoint) return;

      const pivot = pivotForPointer(hitUnderPointer(clientX, clientY), fallback);

      const toPivot = scratch.current.set(pivot[0], pivot[1], pivot[2]).sub(camera.position);
      const distance = toPivot.length();
      if (distance === 0) return;

      // Limits live on the controls, assigned by FitCameraToModel from the model's framing.
      const clamped = clampAnchorDistance(distance, cc.minDistance, cc.maxDistance);
      // Same scratch vector, re-based onto the eye: past this line it is a world point rather
      // than an offset, which is what setOrbitPoint takes.
      const anchor = toPivot.multiplyScalar(clamped / distance).add(camera.position);

      cc.setOrbitPoint(anchor.x, anchor.y, anchor.z);
    },
    [camera, controls, hitUnderPointer],
  );

  useEffect(() => {
    const canvas = gl.domElement;
    const cc = controls as unknown as CameraControlsImpl | null;

    const onPointerDown = (event: PointerEvent) => {
      // infinityDolly is a persistent property, and all three dolly paths read it — wheel,
      // middle-button drag and two-finger pinch — but only the wheel is meant to have it. Left
      // latched from an earlier scroll it also removes the stop at maxDistance, so a subsequent
      // middle-drag outwards runs the target to ~1e10 units, and there is no reset control to
      // recover from that. A pointerdown precedes both the drag and the pinch (touch input
      // raises pointer events too), so clearing it here restores the hard stop for both without
      // reaching into any private field. Above the button check on purpose: the middle button
      // is button 1, which returns below.
      if (cc) cc.infinityDolly = false;

      // Left button only — that is the rotate action in camera-controls' default mapping.
      if (event.button !== 0) return;
      // Background drags fall back to the model's centre, which is what makes a drag started
      // over empty space orbit the whole object and keep it in frame.
      anchorPivot(event.clientX, event.clientY, [center.x, center.y, center.z]);
    };

    const onWheel = (event: WheelEvent) => {
      // infinityDolly holds the distance and pushes the target instead of stopping at a limit.
      // That is wanted zooming IN — it is what lets the camera approach a wall and keep going
      // rather than freezing asymptotically. It is NOT wanted zooming out: the same branch
      // fires on maxDistance and would push the target away without limit, shrinking the model
      // to nothing and eventually clipping it through the far plane, with no reset control to
      // recover. So it is enabled per event, by direction.
      //
      // This flag is the whole of the wheel's job. Re-anchoring the pivot here is what broke
      // the feature — read the note at the top of this file before putting it back.
      if (cc) cc.infinityDolly = isZoomingIn(event.deltaY);
    };

    canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
      canvas.removeEventListener('wheel', onWheel, { capture: true });
      // The controls outlive this component — ModelViewerInner remounts it on every model
      // change — so unmounting mid-zoom would otherwise leave the limitless dolly latched on
      // for whatever loads next.
      if (cc) cc.infinityDolly = false;
    };
  }, [gl, controls, anchorPivot, center]);

  return null;
}
