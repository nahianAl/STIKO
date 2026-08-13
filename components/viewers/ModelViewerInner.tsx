'use client';

import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Center } from '@react-three/drei';
import { Suspense, useRef, useCallback, useEffect, useMemo, useImperativeHandle, type Ref } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STEPLoader } from '@/lib/STEPLoader';
import { makeDoubleSided } from '@/lib/threeMaterials';
import { framingForRadius } from '@/lib/cameraFraming';
import { isPointerOverGizmo } from '@/lib/gizmoLayout';
import ViewGizmo from './ViewGizmo';
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

export interface ModelViewerHandle {
  /**
   * Re-renders the model scene alone, without the gizmo HUD drei layers on top.
   * Call immediately before reading pixels off the canvas — the next animation frame
   * restores the normal composite.
   */
  renderCleanFrame: () => void;
}

export interface ModelViewerInnerProps {
  url: string;
  commentToolActive?: boolean;
  onSceneClick?: (worldPoint: { x: number; y: number; z: number }, screenPercent: { x: number; y: number }) => void;
  worldPins?: WorldPin[];
  onPinPositionsUpdate?: (positions: Map<string, PinScreenPosition>) => void;
  handleRef?: Ref<ModelViewerHandle>;
}

const DEFAULT_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#8899aa',
  roughness: 0.6,
  metalness: 0.3,
  side: THREE.DoubleSide,
});

const VERTEX_COLOR_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.6,
  metalness: 0.3,
  side: THREE.DoubleSide,
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

  // Materials that ship inside the file (OBJ / 3DS / DAE / STEP / glTF) are single-sided
  // by default, which hides the far inner wall of thin or perforated parts when you look
  // through an opening. STL and PLY use the shared materials above, already double-sided.
  useMemo(() => {
    const root: THREE.Object3D | undefined =
      data instanceof THREE.Object3D ? data : (data as GLTF | Collada | undefined)?.scene;
    if (root) makeDoubleSided(root);
  }, [data]);

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

      // The gizmo is a HUD layer, not scene geometry, and its React Three Fiber
      // stopPropagation does not reach this native listener — so exclude its rect by hand.
      if (isPointerOverGizmo(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)) return;

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

function CleanFrameRenderer({ handleRef }: { handleRef?: Ref<ModelViewerHandle> }) {
  const { gl, scene, camera } = useThree();
  useImperativeHandle(
    handleRef,
    () => ({
      renderCleanFrame: () => gl.render(scene, camera),
    }),
    [gl, scene, camera],
  );
  return null;
}

// Direction the camera is placed in, relative to the model's centre — the 3/4 view the
// viewer has always opened on, now expressed as a direction rather than a fixed position.
const VIEW_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();

/**
 * Frames the camera on the loaded model and sizes the clipping planes to it.
 *
 * Mounted with `key={url}` inside <Suspense>, so it runs exactly once per loaded model:
 * React commits the whole boundary together, meaning the geometry is already in the scene
 * graph when this effect fires. Deliberately does NOT re-run on viewport resize — refitting
 * there would throw away the user's zoom and pan every time a side panel is toggled.
 */
function FitCameraToModel({ targetRef }: { targetRef: React.RefObject<THREE.Object3D> }) {
  const { camera, controls, size } = useThree();

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    target.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    const cam = camera as THREE.PerspectiveCamera;
    const framing = framingForRadius(sphere.radius, cam.fov, size.width / size.height);

    cam.position.copy(sphere.center).addScaledVector(VIEW_DIRECTION, framing.distance);
    cam.near = framing.near;
    cam.far = framing.far;
    cam.updateProjectionMatrix();

    // OrbitControls orbits its target, so it has to move to the model's centre too —
    // otherwise a model centred away from the origin swings around empty space.
    const orbit = controls as unknown as {
      target: THREE.Vector3;
      minDistance: number;
      maxDistance: number;
      update: () => void;
    } | null;
    if (orbit?.target) {
      orbit.target.copy(sphere.center);
      orbit.minDistance = framing.minDistance;
      orbit.maxDistance = framing.maxDistance;
      orbit.update();
    }
    // One-shot per model: see the note above about resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls]);

  return null;
}

export default function ModelViewerInner({
  url,
  commentToolActive = false,
  onSceneClick,
  worldPins = [],
  onPinPositionsUpdate,
  handleRef,
}: ModelViewerInnerProps) {
  const modelRef = useRef<THREE.Group>(null);

  return (
    <div className="h-full w-full" style={{ minHeight: 400, cursor: commentToolActive ? 'crosshair' : undefined }}>
      <Canvas
        // Position and clipping planes are placeholders only — FitCameraToModel overwrites
        // all three from the model's bounding sphere as soon as it loads.
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
            <group ref={modelRef}>
              <Model url={url} />
            </group>
          </Center>
          {/* Keyed by url so it refits whenever a different model loads. Inside <Suspense>
              so the geometry is present in the scene graph by the time its effect runs. */}
          <FitCameraToModel key={url} targetRef={modelRef} />
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
        <ViewGizmo />
        <CleanFrameRenderer handleRef={handleRef} />
      </Canvas>
    </div>
  );
}
