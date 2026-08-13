'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { ContactShadows } from '@react-three/drei';
import { sceneScaleForRadius } from '@/lib/sceneScale';

// Slightly darker than the #f0f0f0 canvas background, and cool enough to sit under the
// #8899aa model without muddying it.
const GROUND_COLOR = '#E4E5EC';
const SHADOW_COLOR = '#1C2030';

/**
 * A radial white-to-black gradient used as the ground's alphaMap, so the plane fades out
 * instead of ending at a visible edge.
 *
 * White to BLACK, not white to transparent: three samples alphaMap from the green channel,
 * so a gradient that only varies in alpha leaves green at 255 and produces no fade.
 */
function useFadeAlphaMap(): THREE.CanvasTexture {
  return useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      const half = size / 2;
      const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.55, '#ffffff'); // opaque under and around the model
      gradient.addColorStop(1, '#000000'); // fully faded at the rim
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }

    return new THREE.CanvasTexture(canvas);
  }, []);
}

export default function SceneGround({ radius, height }: { radius: number; height: number }) {
  const scale = sceneScaleForRadius(radius);
  const alphaMap = useFadeAlphaMap();

  // A perfectly flat model (a plane, a 2D DXF-style export) has zero height, which would
  // give the shadow camera a zero depth range and render nothing. groundRadius / 4 is the
  // guarded radius from sceneScaleForRadius, so this is never zero.
  const shadowFar = Math.max(height, scale.groundRadius / 4) * 1.1;

  return (
    <>
      {/* circleGeometry is authored in the XY plane; rotate it flat. depthWrite is off so
          the transparent rim composites over the background instead of punching a hole. */}
      <mesh position={[0, scale.groundY, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <circleGeometry args={[scale.groundRadius, 64]} />
        {/* toneMapped={false}: R3F applies ACES filmic tone mapping by default, which lifts
            light colours toward white and washed this plane out until it was indistinguishable
            from the background. The ground is flat UI-ish colour, not lit material, so it
            should render exactly as authored — drei's own gizmo materials do the same. */}
        <meshBasicMaterial
          color={GROUND_COLOR}
          alphaMap={alphaMap}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

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
