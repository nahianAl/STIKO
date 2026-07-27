'use client';

import { GizmoHelper, GizmoViewcube, GizmoViewport } from '@react-three/drei';
import { GIZMO_MARGIN_PX } from '@/lib/gizmoLayout';

// A canvas 2D font shorthand, not CSS: drei bakes face labels into a CanvasTexture.
// next/font hashes Manrope's family name, so it cannot be referenced here — the labels
// are short and uppercase, so a system stack is indistinguishable.
const GIZMO_FONT = '600 20px Inter, system-ui, -apple-system, sans-serif';

// drei's face order is +X, -X, +Y, -Y, +Z, -Z.
const FACES = ['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back'];

export default function ViewGizmo() {
  return (
    <GizmoHelper alignment="bottom-right" margin={[GIZMO_MARGIN_PX, GIZMO_MARGIN_PX]}>
      <GizmoViewcube
        font={GIZMO_FONT}
        faces={FACES}
        color="#FFFFFF"
        hoverColor="#5B60FF"
        textColor="#1C2030"
        strokeColor="#E4E5EC"
      />
      {/* Display-only: the cube's six faces already snap to the six axis views, so
          interactive axis heads would be a second hit target for the same action.

          position/scale go on GizmoViewport itself, never on a wrapping group: drei sets
          scale 40 on its own root group and then spreads props over it, so an outer scale
          multiplies rather than replaces. The origin sits just off the cube's front-lower-
          left corner (the cube spans ±30), pulled forward in z to avoid coplanar z-fighting
          with the front face. */}
      <GizmoViewport
        disabled
        hideNegativeAxes
        position={[-30, -30, 32]}
        scale={28}
        axisColors={['#E5484D', '#30A46C', '#3E63DD']}
        labelColor="#1C2030"
        font={GIZMO_FONT}
      />
    </GizmoHelper>
  );
}
