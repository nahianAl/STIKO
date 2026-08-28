'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PlaneId, PlanePose } from '@/lib/crossSection';

// stiko-primary and stiko-muted, hard-coded because three takes colours as numbers and
// cannot read Tailwind tokens. Keep in step with tailwind.config.ts.
const SELECTED_COLOUR = '#5B60FF';
const IDLE_COLOUR = '#8A90A6';

// three.js's raycaster never checks `object.visible`: `Raycaster.intersect()` only tests
// `object.layers`, and `Mesh.raycast` has no visibility guard of its own — @react-three/fiber's
// event pipeline adds no filter on top of that either. So a mesh left with its default
// `raycast` implementation keeps catching pointer hits even while its whole group is set
// `visible={false}`. Swapping this no-op in while hidden is what actually removes the mesh
// from hit-testing; do not "simplify" it away as redundant with the handler gate below — it is
// the guarantee, the handler gate is only the behaviour.
const DISABLE_RAYCAST = () => {};

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
  selectable,
  gizmoDraggingRef,
  objectRef,
  onSelect,
}: {
  id: PlaneId;
  pose: PlanePose;
  /** Edge length of the quad. Sized to span the model whatever angle it is turned to. */
  size: number;
  visible: boolean;
  selected: boolean;
  /**
   * Whether a click on this widget may select it. False while the comment tool is armed, so
   * that a click over a visible plane only drops a pin instead of also selecting the plane and
   * arming Move underneath the comment being placed. Mirrors the `visible` gate below: same
   * shape, same reason — a plane that cannot currently be selected must not run the selection
   * side of `onClick` at all, not just skip acting on it.
   */
  selectable: boolean;
  /**
   * Set for the duration of a gizmo drag, on either target. drei's `TransformControls` renders
   * as a bare `<primitive object={controls}/>` with no R3F handlers of its own, so its handles
   * never enter R3F's interaction set — a click on a handle raycasts straight through to
   * whatever plane quad sits behind that screen pixel, and the gizmo sits at the selected
   * plane's origin, exactly where the quads intersect. Without this guard, clicking (not
   * dragging) a handle while this plane is selected re-fires `onSelect` mid-interaction — Move
   * silently replaces Rotate — and if the nearest quad under the handle belongs to a DIFFERENT
   * plane, selection jumps there and the gizmo teleports. `e.delta` alone does not catch this:
   * a stationary click has delta 0. See TransformGizmo's `onMouseDown` for where this is set,
   * and the two deselect sites in ModelViewerInner for the same guard on the other two clicks
   * that could otherwise be mistaken for the end of a drag.
   */
  gizmoDraggingRef: React.MutableRefObject<boolean>;
  /** Registers this widget's group with the parent, which reads its world matrix per frame. */
  objectRef: (id: PlaneId, object: THREE.Group | null) => void;
  onSelect: (id: PlaneId) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

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

  // A hidden plane or an unselectable plane (when the comment tool is armed) cannot be hovered
  // — same gate as the click handler and the raycast override above. If either condition makes
  // the widget non-interactive, hover handlers are detached before onPointerOut fires, stranding
  // any hover state that was already set. This effect clears it for both cases, so re-showing
  // or re-selecting the widget never starts it looking hovered from a stale state.
  useEffect(() => {
    if (!visible || !selectable) setHovered(false);
  }, [visible, selectable]);

  const isHovered = visible && selectable && hovered;

  const colour = selected ? SELECTED_COLOUR : IDLE_COLOUR;
  const quadOpacity = selected ? 0.16 : isHovered ? 0.12 : 0.09;
  const borderOpacity = selected ? 0.9 : isHovered ? 0.7 : 0.5;

  // The border is an edgesGeometry built from a plain PlaneGeometry of the same size. Hoist
  // that source geometry behind a memo keyed on `size` so it is rebuilt only when the quad's
  // size actually changes, not on every selected/hover/visible re-render.
  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(size, size), [size]);

  // R3F disposes the DERIVED edgesGeometry below on its own (it owns that JSX element), but
  // this source geometry is only ever reached via `new THREE.PlaneGeometry(...)` above and
  // React never sees it as a scene object to clean up. Without this, every `size` change (and
  // the final unmount) orphans one. CPU-side only — it is never rendered, so never uploaded —
  // but still worth not leaking.
  useEffect(() => {
    return () => borderGeometry.dispose();
  }, [borderGeometry]);

  return (
    <group
      ref={group}
      visible={visible}
      // Interaction furniture, not part of the design being reviewed: renderCleanFrame hides
      // everything carrying this flag before capturing an annotation snapshot. Same marker
      // TransformGizmo sets on its handles.
      userData={{ excludeFromSnapshot: true }}
      // Attached only while visible AND selectable: a hidden plane must stay completely inert
      // to pointer input so a click near the model reaches the model, not this invisible quad
      // (see DISABLE_RAYCAST above for why the mesh also needs its own guard, not just this
      // gate); an unselectable-but-visible plane — the comment tool armed — still shows and
      // still blocks clicks from reaching what is behind it, it just does not act on them.
      onClick={
        visible && selectable
          ? (e) => {
              // R3F's own delta<=2 drag-vs-click check (see events-*.esm.js) is applied ONLY on
              // the onPointerMissed path; an object's onClick, this one, gets no such check and
              // fires on every genuine DOM 'click' — including one a left-drag orbit produces,
              // since camera-controls deliberately never calls preventDefault() on pointerdown.
              // Without this guard, any orbit starting and ending over the plane's quad fires
              // onSelect and switches the gizmo mid-gesture. `e.delta` is R3F's accumulated
              // pointer-move distance for the click; 2 is the same threshold R3F applies itself.
              if (e.delta > 2) return;
              // A gizmo drag reaches this quad as a click on whatever is behind the handle —
              // see the gizmoDraggingRef prop doc above for why. Without this, a stationary
              // click on a handle re-arms Move mid-Rotate, or teleports the gizmo onto
              // whichever plane happens to sit behind that handle.
              if (gizmoDraggingRef.current) return;
              // Without this, the click continues to the model's own deselect handler underneath
              // and the plane is selected and deselected in the same event.
              e.stopPropagation();
              onSelect(id);
            }
          : undefined
      }
      // onPointerOver/onPointerOut are R3F's hover events; gated on the same `visible &&
      // selectable` condition as onClick, not on `visible` alone. Otherwise, with the comment
      // tool armed, a visible-but-unselectable plane would still highlight under the cursor and
      // still sit in R3F's interaction set — an affordance for a click that onClick's own gate
      // has already decided will never select anything.
      onPointerOver={
        visible && selectable
          ? (e) => {
              e.stopPropagation();
              setHovered(true);
            }
          : undefined
      }
      onPointerOut={
        visible && selectable
          ? (e) => {
              e.stopPropagation();
              setHovered(false);
            }
          : undefined
      }
    >
      <mesh raycast={visible ? THREE.Mesh.prototype.raycast : DISABLE_RAYCAST}>
        <planeGeometry args={[size, size]} />
        {/* DoubleSide because you will orbit past it; depthWrite off so the translucent
            quad does not punch a hole in the model behind it. */}
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={quadOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* A border, so an edge-on plane is still findable and clickable. */}
      <lineSegments>
        <edgesGeometry args={[borderGeometry]} />
        <lineBasicMaterial color={colour} transparent opacity={borderOpacity} />
      </lineSegments>
    </group>
  );
}
