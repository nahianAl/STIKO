'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';

/**
 * How the viewer is lit: a headlight that always points where the camera points, the way
 * SketchUp lights a model.
 *
 * A headlight deliberately flattens form — there are no raking shadows to define curvature,
 * so a cylinder reads as an even band rather than a rounded surface. That is the point: it
 * keeps edges and geometry legible from every angle, which matters more in a review tool
 * than a photographic look.
 */

const HEADLIGHT_INTENSITY = 1.6;

/** Enough that faces angled away from the camera stay readable instead of going pure black. */
const AMBIENT_INTENSITY = 0.35;

/**
 * Reflections only — the headlight does the lighting. This exists so that uploaded glTF
 * models carrying metallic materials have something to reflect; a metallic surface with no
 * environment renders black, and there is no way for it to recover.
 */
const ENVIRONMENT_INTENSITY = 0.15;

function Headlight() {
  const light = useRef<THREE.DirectionalLight>(null);
  const { camera, controls } = useThree();

  useFrame(() => {
    const headlight = light.current;
    if (!headlight) return;

    // A directional light only cares about direction, not distance, so copying the camera's
    // position and aiming at whatever it orbits points the light exactly where the user is
    // looking. It also means this needs no scale derivation, unlike everything else in the
    // scene — it behaves identically at model radius 1 and 10,000.
    headlight.position.copy(camera.position);

    const orbitTarget = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    if (orbitTarget) headlight.target.position.copy(orbitTarget);

    // The target is a bare Object3D that is not part of the scene graph, so nothing else
    // will refresh its world matrix — and the light reads its direction from that matrix.
    headlight.target.updateMatrixWorld();
  });

  return <directionalLight ref={light} intensity={HEADLIGHT_INTENSITY} />;
}

export default function SceneLighting() {
  return (
    <>
      <Headlight />
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <Environment preset="studio" environmentIntensity={ENVIRONMENT_INTENSITY} />
    </>
  );
}
