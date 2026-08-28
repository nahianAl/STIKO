'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PlaneId, PlanePose } from '@/lib/crossSection';

// stiko-primary and stiko-muted, hard-coded because three takes colours as numbers and
// cannot read Tailwind tokens. Keep in step with tailwind.config.ts.
const SELECTED_COLOUR = '#5B60FF';
const IDLE_COLOUR = '#8A90A6';

/**
 * One cross-section plane, as an object in the scene.
 *
 * The pose is applied ONCE, on mount, and the scene owns it from then on: `TransformControls`
 * drags this group directly, and re-applying `position`/`rotation` as R3F props on every
 * render would fight the drag. That is why they are set in an effect with an empty dependency
 * list rather than passed to <group>.
 *
 * Consequently this component must NOT be unmounted when the plane is hidden — hiding sets
 * `visible` on the group instead. Unmounting would throw the pose away, and switching the
 * button back on would silently move the cut back to the centre of the model.
 */
export default function SectionPlaneWidget({
  id,
  pose,
  size,
  visible,
  selected,
  objectRef,
  onSelect,
}: {
  id: PlaneId;
  pose: PlanePose;
  /** Edge length of the quad. Sized to span the model whatever angle it is turned to. */
  size: number;
  visible: boolean;
  selected: boolean;
  /** Registers this widget's group with the parent, which reads its world matrix per frame. */
  objectRef: (id: PlaneId, object: THREE.Group | null) => void;
  onSelect: (id: PlaneId) => void;
}) {
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    const object = group.current;
    if (!object) return;
    object.position.set(pose.position[0], pose.position[1], pose.position[2]);
    object.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
    objectRef(id, object);
    return () => objectRef(id, null);
    // Mount only. `pose` is a starting placement, not a live binding — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colour = selected ? SELECTED_COLOUR : IDLE_COLOUR;

  return (
    <group
      ref={group}
      visible={visible}
      // Interaction furniture, not part of the design being reviewed: renderCleanFrame hides
      // everything carrying this flag before capturing an annotation snapshot. Same marker
      // TransformGizmo sets on its handles.
      userData={{ excludeFromSnapshot: true }}
      onClick={(e) => {
        // Without this, the click continues to the model's own deselect handler underneath
        // and the plane is selected and deselected in the same event.
        e.stopPropagation();
        onSelect(id);
      }}
    >
      <mesh>
        <planeGeometry args={[size, size]} />
        {/* DoubleSide because you will orbit past it; depthWrite off so the translucent
            quad does not punch a hole in the model behind it. */}
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={selected ? 0.16 : 0.09}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* A border, so an edge-on plane is still findable and clickable. */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(size, size)]} />
        <lineBasicMaterial color={colour} transparent opacity={selected ? 0.9 : 0.5} />
      </lineSegments>
    </group>
  );
}
