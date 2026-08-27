'use client';

import { GizmoHelper, GizmoViewcube, GizmoViewport } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import type CameraControlsImpl from 'camera-controls';
import { GIZMO_MARGIN_PX, TRIAD_ORIGIN_PX, TRIAD_AXIS_PX } from '@/lib/gizmoLayout';

// A canvas 2D font shorthand, not CSS: drei bakes face labels into a CanvasTexture.
// next/font hashes Manrope's family name, so it cannot be referenced here — the labels
// are short and uppercase, so a system stack is indistinguishable.
const GIZMO_FONT = '600 20px Inter, system-ui, -apple-system, sans-serif';

export default function ViewGizmo() {
  const { controls } = useThree();
  const focus = useRef(new THREE.Vector3());

  /**
   * Resolves the point a face click tweens around, and clears the focal offset left behind
   * by the last orbit on the way.
   *
   * ViewerNavigation anchors the orbit pivot with setOrbitPoint, which holds the camera
   * still by moving the target AND adding a compensating focal offset that then persists on
   * the controls. drei drives the tween with defaultControls.setPosition — setLookAt
   * underneath — which does not clear that offset, so every frame of the tween re-applies
   * the last orbit anchor's displacement on top of the position the cube asked for and the
   * cube stops re-centring on the model. Measured on a 100-radius model, the camera settled
   * 106.8 units away from the requested position: about one model diameter. This is the only
   * re-orientation aid in the viewer, so it has to land where it says it will.
   *
   * onTarget rather than onUpdate, because onTarget is called once per click from inside
   * GizmoHelper's tweenCamera, whereas onUpdate is called every tween frame INSTEAD of
   * controls.update(delta) and is handed no delta — passing it would mean taking the tween's
   * update call over as well, to fix something that only needs doing once.
   *
   * No transition on the offset: while a tween runs, controls.update is called twice per
   * frame (drei's <CameraControls> at render priority -1, then GizmoHelper again), so an
   * eased offset would decay at roughly twice its nominal rate and its end state would
   * depend on the loop still turning after the tween stops. Clearing it outright costs one
   * frame's jump at the start of a movement the user has just asked for.
   *
   * The vector returned is the same one GizmoHelper would have resolved for itself. It is
   * returned rather than left implicit because a falsy return sends GizmoHelper down a
   * branch that dereferences the controls unguarded, which throws before they mount.
   */
  const resolveFocus = useCallback(() => {
    const cc = controls as unknown as CameraControlsImpl | null;
    if (cc?.setFocalOffset) {
      cc.setFocalOffset(0, 0, 0, false);
      cc.getTarget(focus.current);
    }
    // Controls not mounted yet: the model is centred at the world origin by <Center>, which
    // is what this starts as and what GizmoHelper's own fallback would have produced.
    return focus.current;
  }, [controls]);

  return (
    <GizmoHelper
      alignment="top-right"
      margin={[GIZMO_MARGIN_PX, GIZMO_MARGIN_PX]}
      onTarget={resolveFocus}
    >
      <GizmoViewcube
        font={GIZMO_FONT}
        color="#FFFFFF"
        hoverColor="#5B60FF"
        textColor="#1C2030"
        strokeColor="#E4E5EC"
      />
      {/* Display-only: the cube's six faces already snap to the six axis views, so
          interactive axis heads would be a second hit target for the same action.

          position/scale go on GizmoViewport itself, never on a wrapping group: drei sets
          scale 40 on its own root group and then spreads props over it, so an outer scale
          multiplies rather than replaces. Origin and axis length live in lib/gizmoLayout.ts,
          shared with the click-guard math so the two can never drift apart — the origin puts
          the axes along the cube's edges, so the triad stays inside the cube's silhouette. */}
      <GizmoViewport
        disabled
        hideNegativeAxes
        position={[...TRIAD_ORIGIN_PX]}
        scale={TRIAD_AXIS_PX}
        axisColors={['#E5484D', '#30A46C', '#3E63DD']}
        labelColor="#1C2030"
        font={GIZMO_FONT}
      />
    </GizmoHelper>
  );
}
