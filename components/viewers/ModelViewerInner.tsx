'use client';

import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Center } from '@react-three/drei';
import { Suspense, useRef, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STEPLoader } from '@/lib/STEPLoader';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Collada } from 'three/examples/jsm/loaders/ColladaLoader.js';

export interface WorldPin {
  id: string;
  worldX: number;
  worldY: number;
  worldZ: number;
}

export interface PinScreenPosition {
  x: number;
  y: number;
  visible: boolean;
}

export interface ModelViewerInnerProps {
  url: string;
  commentToolActive?: boolean;
  onSceneClick?: (worldPoint: { x: number; y: number; z: number }, screenPercent: { x: number; y: number }) => void;
  worldPins?: WorldPin[];
  onPinPositionsUpdate?: (positions: Map<string, PinScreenPosition>) => void;
}

const DEFAULT_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#8899aa',
  roughness: 0.6,
  metalness: 0.3,
});

const VERTEX_COLOR_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.6,
  metalness: 0.3,
});

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const idx = pathname.lastIndexOf('.');
    return idx !== -1 ? pathname.slice(idx).toLowerCase() : '';
  } catch {
    const clean = url.split('?')[0];
    const idx = clean.lastIndexOf('.');
    return idx !== -1 ? clean.slice(idx).toLowerCase() : '';
  }
}

function getLoaderForExt(ext: string) {
  switch (ext) {
    case '.obj': return OBJLoader;
    case '.stl': return STLLoader;
    case '.3ds': return TDSLoader;
    case '.ply': return PLYLoader;
    case '.dae': return ColladaLoader;
    case '.step':
    case '.stp': return STEPLoader;
    default: return GLTFLoader;
  }
}

function Model({ url }: { url: string }) {
  const ext = getExtFromUrl(url);
  const LoaderClass = getLoaderForExt(ext);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = useLoader(LoaderClass as any, url);

  // For PLY, compute vertex normals once
  useMemo(() => {
    if (ext === '.ply' && data instanceof THREE.BufferGeometry) {
      data.computeVertexNormals();
    }
  }, [ext, data]);

  if (ext === '.obj') {
    return <primitive object={data} />;
  }

  if (ext === '.stl' || ext === '.ply') {
    const geometry = data as THREE.BufferGeometry;
    const material = geometry.hasAttribute('color')
      ? VERTEX_COLOR_MATERIAL
      : DEFAULT_MATERIAL;
    return <mesh geometry={geometry} material={material} />;
  }

  if (ext === '.3ds') {
    return <primitive object={data} />;
  }

  if (ext === '.dae') {
    return <primitive object={(data as Collada).scene} />;
  }

  if (ext === '.step' || ext === '.stp') {
    return <primitive object={data as THREE.Group} />;
  }

  // Default: GLTF/GLB
  return <primitive object={(data as GLTF).scene} />;
}

function SceneInteraction({
  commentToolActive,
  onSceneClick,
  worldPins,
  onPinPositionsUpdate,
}: {
  commentToolActive: boolean;
  onSceneClick?: ModelViewerInnerProps['onSceneClick'];
  worldPins: WorldPin[];
  onPinPositionsUpdate?: ModelViewerInnerProps['onPinPositionsUpdate'];
}) {
  const { camera, gl, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const tempVec3 = useRef(new THREE.Vector3());

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (!commentToolActive || !onSceneClick) return;

      const rect = gl.domElement.getBoundingClientRect();
      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera(mouse.current, camera);
      const intersects = raycaster.current.intersectObjects(scene.children, true);

      for (const hit of intersects) {
        if (hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh) {
          const point = hit.point;
          const projected = point.clone().project(camera);
          const screenPercent = {
            x: ((projected.x + 1) / 2) * 100,
            y: ((1 - projected.y) / 2) * 100,
          };
          onSceneClick(
            { x: point.x, y: point.y, z: point.z },
            screenPercent
          );
          break;
        }
      }
    },
    [commentToolActive, onSceneClick, camera, gl, scene]
  );

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    return () => canvas.removeEventListener('pointerdown', handlePointerDown);
  }, [gl, handlePointerDown]);

  // Project world pins to screen space every frame
  useFrame(() => {
    if (!onPinPositionsUpdate || worldPins.length === 0) return;

    const positions = new Map<string, PinScreenPosition>();

    for (const pin of worldPins) {
      tempVec3.current.set(pin.worldX, pin.worldY, pin.worldZ);
      tempVec3.current.project(camera);

      const x = ((tempVec3.current.x + 1) / 2) * 100;
      const y = ((1 - tempVec3.current.y) / 2) * 100;
      const visible = tempVec3.current.z < 1 && x >= -10 && x <= 110 && y >= -10 && y <= 110;

      positions.set(pin.id, { x, y, visible });
    }

    onPinPositionsUpdate(positions);
  });

  return null;
}

export default function ModelViewerInner({
  url,
  commentToolActive = false,
  onSceneClick,
  worldPins = [],
  onPinPositionsUpdate,
}: ModelViewerInnerProps) {
  return (
    <div className="h-full w-full" style={{ minHeight: 400, cursor: commentToolActive ? 'crosshair' : undefined }}>
      <Canvas
        camera={{ position: [3, 3, 3], fov: 50 }}
        style={{ background: '#f0f0f0' }}
        gl={{ preserveDrawingBuffer: true }}
      >
        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[0.5, 0.5, 0.5]} />
              <meshStandardMaterial color="gray" wireframe />
            </mesh>
          }
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 10, 5]} intensity={1} />
          <Center>
            <Model url={url} />
          </Center>
          <Grid
            args={[10, 10]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor="#aaa"
            sectionSize={2}
            sectionThickness={1}
            sectionColor="#888"
            fadeDistance={10}
            position={[0, -0.01, 0]}
          />
          <Environment preset="studio" />
          <SceneInteraction
            commentToolActive={commentToolActive}
            onSceneClick={onSceneClick}
            worldPins={worldPins}
            onPinPositionsUpdate={onPinPositionsUpdate}
          />
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}
