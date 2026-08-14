'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { ObjectTransform } from '@/lib/objectTransform';

/**
 * Move/rotate handles for the loaded object.
 *
 * Only ever mounted for a role that may transform — a viewer or commenter never has
 * this in their scene graph at all. That is presentation, not enforcement: the PATCH
 * route is the actual boundary.
 */
export default function TransformGizmo({
  targetRef,
  mode,
  onCommit,
}: {
  targetRef: React.RefObject<THREE.Object3D>;
  mode: 'translate' | 'rotate';
  onCommit: (transform: ObjectTransform) => void;
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
    };
  }, [defaultControls]);

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

  if (!targetRef.current) return null;

  return (
    <TransformControls
      ref={controlsRef}
      object={targetRef.current}
      mode={mode}
      // Auto-save on release. drei suspends the default OrbitControls for the duration
      // of a drag, so orbiting and dragging cannot fight each other.
      onMouseUp={() => {
        const target = targetRef.current;
        if (!target) return;
        // Euler XYZ to match how the columns are read and written.
        const euler = new THREE.Euler().setFromQuaternion(target.quaternion, 'XYZ');
        onCommit({
          position: [target.position.x, target.position.y, target.position.z],
          rotation: [euler.x, euler.y, euler.z],
        });
      }}
    />
  );
}
