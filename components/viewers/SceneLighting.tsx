'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import {
  ENVIRONMENT_INTENSITY,
  FILL_INTENSITY,
  FILL_OFFSET,
  HEMISPHERE_GROUND,
  HEMISPHERE_INTENSITY,
  HEMISPHERE_SKY,
  KEY_INTENSITY,
  KEY_OFFSET,
  placeCameraRelativeLight,
} from '@/lib/sceneLights';

/**
 * How the viewer is lit: a key light from above-left, a softer fill from the other side, a
 * sky/ground tint, and studio reflections. The two directional lights follow the camera, so no
 * side of the model ever goes dark; see lib/sceneLights.ts for why this replaced the
 * SketchUp-style headlight (2026-11-20, docs/superpowers/specs/2026-11-20-model-shading-edges-design.md).
 */

const ORIGIN = new THREE.Vector3();

function CameraRig() {
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const scratch = useRef(new THREE.Vector3());
  const { camera, controls } = useThree();

  useFrame(() => {
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? ORIGIN;
    if (key.current) placeCameraRelativeLight(key.current, KEY_OFFSET, camera, target, scratch.current);
    if (fill.current) placeCameraRelativeLight(fill.current, FILL_OFFSET, camera, target, scratch.current);
  });

  return (
    <>
      <directionalLight ref={key} intensity={KEY_INTENSITY} />
      <directionalLight ref={fill} intensity={FILL_INTENSITY} />
    </>
  );
}

export default function SceneLighting() {
  return (
    <>
      <CameraRig />
      <hemisphereLight args={[HEMISPHERE_SKY, HEMISPHERE_GROUND, HEMISPHERE_INTENSITY]} />
      <Environment preset="studio" environmentIntensity={ENVIRONMENT_INTENSITY} />
    </>
  );
}
