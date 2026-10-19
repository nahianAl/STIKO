'use client';

import { ContactShadows } from '@react-three/drei';
import { sceneScaleForRadius } from '@/lib/sceneScale';

// drei's ContactShadows hard-codes its own material with no toneMapped escape hatch, so this
// colour still goes through ACES filmic tone mapping and will not match this hex exactly.
const SHADOW_COLOR = '#1C2030';

/**
 * What the model stands on: a soft contact shadow, and nothing else.
 *
 * There used to be a ground disc as well, a shade darker than the canvas and fading out at its
 * rim. It read as a grey patch around the origin rather than as a floor, so it is gone and the
 * background runs seamlessly under the model. The shadow alone still grounds it.
 */
export default function SceneGround({ radius, height }: { radius: number; height: number }) {
  const scale = sceneScaleForRadius(radius);

  // A perfectly flat model (a plane, a 2D DXF-style export) has zero height, which would
  // give the shadow camera a zero depth range and render nothing. groundRadius / 4 is the
  // guarded radius from sceneScaleForRadius, so this is never zero. height > 0 also rejects
  // NaN (an undefined or degenerate bounding box), matching the guard in SceneAxes.
  const safeHeight = height > 0 ? height : scale.groundRadius / 4;
  const shadowFar = Math.max(safeHeight, scale.groundRadius / 4) * 1.1;

  return (
    <>
      {/* frames={1} renders the shadow map once. The model never moves and the shadow is
          camera independent, so a per-frame depth pass would be pure waste. */}
      <ContactShadows
        position={[0, scale.shadowY, 0]}
        scale={scale.shadowScale * 2}
        far={shadowFar}
        blur={2.5}
        opacity={0.45}
        color={SHADOW_COLOR}
        resolution={1024}
        frames={1}
      />
    </>
  );
}
