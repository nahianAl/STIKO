'use client';

import { GizmoHelper, GizmoViewcube, GizmoViewport } from '@react-three/drei';
import { GIZMO_MARGIN_PX, TRIAD_ORIGIN_PX, TRIAD_AXIS_PX } from '@/lib/gizmoLayout';

// A canvas 2D font shorthand, not CSS: drei bakes face labels into a CanvasTexture.
// next/font hashes Manrope's family name, so it cannot be referenced here — the labels
// are short and uppercase, so a system stack is indistinguishable.
const GIZMO_FONT = '600 20px Inter, system-ui, -apple-system, sans-serif';

export default function ViewGizmo() {
  return (
    <GizmoHelper alignment="top-right" margin={[GIZMO_MARGIN_PX, GIZMO_MARGIN_PX]}>
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
