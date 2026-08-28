'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { ObjectTransform } from '@/lib/objectTransform';

/**
 * Move/rotate handles for whatever object is handed in — the loaded model, or one
 * cross-section plane.
 *
 * `onCommit` is optional because the two targets differ in exactly one way: the model's
 * placement is persisted on release, while a plane's pose is session-only and read straight
 * off the scene graph by the frame loop, so there is nothing to write anywhere.
 *
 * Only ever mounted for a role that may transform. That is presentation, not enforcement:
 * the PATCH route is the actual boundary.
 */
export default function TransformGizmo({
  target,
  mode,
  onCommit,
  draggingRef,
}: {
  target: THREE.Object3D;
  mode: 'translate' | 'rotate';
  onCommit?: (transform: ObjectTransform) => void;
  /**
   * Set true for the duration of a drag. drei's TransformControls does not stop pointer-event
   * propagation, so without this a drag on a gizmo handle reaches R3F as a click that hit
   * nothing — and the caller's "clicked empty space" handler deselects the very plane being
   * dragged.
   */
  draggingRef?: React.MutableRefObject<boolean>;
}) {
  const defaultControls = useThree((state) => state.controls);
  const controlsRef = useRef<TransformControlsImpl>(null);

  useEffect(() => {
    return () => {
      // drei disables the orbit controls for the duration of a drag and re-enables them from
      // a 'dragging-changed' listener it removes on unmount — without ever firing a final
      // false. Unmounting mid-drag would otherwise leave orbiting disabled for the session.
      const orbit = defaultControls as unknown as { enabled?: boolean } | null;
      if (orbit && typeof orbit.enabled === 'boolean') orbit.enabled = true;
      // Same hazard for the drag flag: unmount mid-drag and it would stay stuck true, and
      // clicks would stop deselecting for the rest of the session.
      if (draggingRef) draggingRef.current = false;
    };
  }, [defaultControls, draggingRef]);

  useEffect(() => {
    // Marked rather than special-cased by name so renderCleanFrame stays generic: these are
    // interaction handles, not part of the design being reviewed, and must never be baked
    // into an annotation snapshot.
    const controls = controlsRef.current;
    if (controls) controls.userData.excludeFromSnapshot = true;
    return () => {
      // R3F never auto-disposes a <primitive>, and drei only detaches — so without this every
      // toggle of the tool leaks an instance with its own geometries, materials and canvas
      // pointer listeners.
      controls?.dispose?.();
    };
  }, []);

  return (
    <TransformControls
      ref={controlsRef}
      object={target}
      mode={mode}
      onObjectChange={() => {
        if (draggingRef) draggingRef.current = true;
      }}
      // Auto-save on release. drei suspends the default OrbitControls for the duration
      // of a drag, so orbiting and dragging cannot fight each other.
      onMouseUp={() => {
        if (onCommit) {
          // Euler XYZ to match how the columns are read and written.
          const euler = new THREE.Euler().setFromQuaternion(target.quaternion, 'XYZ');
          onCommit({
            position: [target.position.x, target.position.y, target.position.z],
            rotation: [euler.x, euler.y, euler.z],
          });
        }
        // Cleared a tick late, so the click event that follows this pointerup — which is what
        // would otherwise deselect — still sees the drag.
        if (draggingRef) setTimeout(() => { draggingRef.current = false; }, 0);
      }}
    />
  );
}
