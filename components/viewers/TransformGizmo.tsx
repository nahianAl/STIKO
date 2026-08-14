'use client';

import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
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
  if (!targetRef.current) return null;

  return (
    <TransformControls
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
