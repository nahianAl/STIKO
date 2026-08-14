'use client';

import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import { Suspense, useRef, useCallback, useEffect, useMemo, useState, useImperativeHandle, type Ref } from 'react';
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
import { DEFAULT_FOCAL_LENGTH, fovForFocalLength } from '@/lib/focalLength';
import { isPointerOverGizmo } from '@/lib/gizmoLayout';
import { IDENTITY_TRANSFORM, isValidTransform, modelToWorld, worldToModel, type ObjectTransform } from '@/lib/objectTransform';
import ViewGizmo from './ViewGizmo';
import TransformGizmo from './TransformGizmo';
import SceneGround from './SceneGround';
import SceneAxes from './SceneAxes';
import SceneLighting from './SceneLighting';
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

export interface ModelBounds {
  /** World-space centre of the model. <Center> keeps this at the world origin. */
  center: THREE.Vector3;
  /** Bounding-sphere radius — the single number all scene sizing derives from. */
  radius: number;
  /** Bounding-box Y extent, used for the Y axis length and the shadow's depth range. */
  height: number;
}

export interface ModelViewerHandle {
  /**
   * Re-renders the model scene alone for a snapshot: the navigation cube lives in a separate
   * HUD scene and is excluded automatically, and anything in the main scene marked
   * `userData.excludeFromSnapshot` — the transform handles — is hidden for the render.
   * Call immediately before reading pixels off the canvas; the next animation frame restores
   * the normal composite.
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
  /** Where the object has been placed. Identity when absent. */
  transform?: ObjectTransform;
  /** Set to a mode to show the move/rotate gizmo. Null or absent hides it entirely. */
  transformMode?: 'translate' | 'rotate' | null;
  onTransformCommit?: (transform: ObjectTransform) => void;
  /** Camera focal length in millimetres. Drives the field of view. */
  focalLength?: number;
}

const DEFAULT_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#8899aa',
  roughness: 0.6,
  metalness: 0,
  side: THREE.DoubleSide,
});

const VERTEX_COLOR_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.6,
  metalness: 0,
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
  modelRef,
  transform,
}: {
  commentToolActive: boolean;
  onSceneClick?: ModelViewerInnerProps['onSceneClick'];
  worldPins: WorldPin[];
  onPinPositionsUpdate?: ModelViewerInnerProps['onPinPositionsUpdate'];
  modelRef: React.RefObject<THREE.Object3D>;
  transform: ObjectTransform;
}) {
  const { camera, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const tempVec3 = useRef(new THREE.Vector3());

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (!commentToolActive || !onSceneClick) return;

      const model = modelRef.current;
      if (!model) return;

      const rect = gl.domElement.getBoundingClientRect();

      // The gizmo is a HUD layer, not scene geometry, and its React Three Fiber
      // stopPropagation does not reach this native listener — so exclude its rect by hand.
      if (isPointerOverGizmo(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)) return;

      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera(mouse.current, camera);
      // Scoped to the model alone, not the whole scene: the ground disc, contact shadow and
      // axis lines are all Mesh-derived and large enough to fill the viewport, so they would
      // otherwise catch clicks intended for empty background and drop pins in space.
      const intersects = raycaster.current.intersectObject(model, true);

      for (const hit of intersects) {
        if (hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh) {
          const point = hit.point;
          const projected = point.clone().project(camera);
          const screenPercent = {
            x: ((projected.x + 1) / 2) * 100,
            y: ((1 - projected.y) / 2) * 100,
          };
          // Stored relative to the model, so the pin travels with it when it is moved.
          const local = worldToModel([point.x, point.y, point.z], transform);
          onSceneClick({ x: local[0], y: local[1], z: local[2] }, screenPercent);
          break;
        }
      }
    },
    [commentToolActive, onSceneClick, camera, gl, modelRef, transform]
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
      const world = modelToWorld([pin.worldX, pin.worldY, pin.worldZ], transform);
      tempVec3.current.set(world[0], world[1], world[2]);
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
      renderCleanFrame: () => {
        // Viewer chrome that lives in the main scene rather than a HUD layer — currently the
        // transform handles — must not appear in the captured snapshot.
        const hidden: THREE.Object3D[] = [];
        scene.traverse((object) => {
          if (object.userData?.excludeFromSnapshot && object.visible) {
            object.visible = false;
            hidden.push(object);
          }
        });
        try {
          gl.render(scene, camera);
        } finally {
          for (const object of hidden) object.visible = true;
        }
      },
    }),
    [gl, scene, camera],
  );
  return null;
}

// Direction the camera is placed in, relative to the model's centre — the 3/4 view the
// viewer has always opened on, now expressed as a direction rather than a fixed position.
const VIEW_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();

/**
 * Measures the loaded model once and publishes its bounds.
 *
 * Mounted with `key={url}` inside <Suspense>, so it runs exactly once per loaded model:
 * React commits the whole boundary together, meaning the geometry is already in the scene
 * graph when this effect fires. Runs as an effect rather than a layout effect so that
 * <Center>'s own layout effect has already positioned the model.
 */
function MeasureModel({
  targetRef,
  transformRef,
  onMeasured,
}: {
  targetRef: React.RefObject<THREE.Object3D>;
  transformRef: React.RefObject<THREE.Object3D>;
  onMeasured: (bounds: ModelBounds) => void;
}) {
  useEffect(() => {
    const target = targetRef.current;
    const frame = transformRef.current;
    if (!target || !frame) return;

    // Measure in frame S — the model as loaded and centred, before the user's placement.
    // Applying the inverse afterwards would not do: inverting the world-space AABB of a
    // rotated box inflates it. Zeroing the transform and restoring it is exact.
    const position = frame.position.clone();
    const quaternion = frame.quaternion.clone();
    frame.position.set(0, 0, 0);
    frame.quaternion.identity();
    frame.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(target);

    frame.position.copy(position);
    frame.quaternion.copy(quaternion);
    frame.updateWorldMatrix(true, true);

    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    onMeasured({
      center: sphere.center.clone(),
      radius: sphere.radius,
      height: box.max.y - box.min.y,
    });
    // One-shot per model; the component is remounted by key when the url changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/**
 * Drives the camera's field of view from a focal length in millimetres.
 *
 * Re-applied on resize as well as on change: three derives fov from the focal length AND the
 * aspect ratio, so a fixed fov would make the number on the control stop describing what is
 * on screen the moment the window changes shape.
 *
 * Rendered BEFORE FitCameraToModel on purpose. The fit reads `cam.fov` when its effect runs
 * to work out how far back to sit, and React fires sibling effects in mount order — flip the
 * two and every model gets framed with the wrong lens on first paint.
 */
function ApplyFocalLength({ focalLength }: { focalLength: number }) {
  const { camera, size } = useThree();

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = fovForFocalLength(focalLength, size.width / size.height);
    cam.updateProjectionMatrix();
  }, [camera, focalLength, size.width, size.height]);

  return null;
}

/**
 * Frames the camera on the measured model and sizes the clipping planes to it.
 *
 * Deliberately does NOT re-run on viewport resize — refitting there would throw away the
 * user's zoom and pan every time a side panel is toggled.
 */
function FitCameraToModel({ bounds }: { bounds: ModelBounds }) {
  const { camera, controls, size } = useThree();

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const framing = framingForRadius(bounds.radius, cam.fov, size.width / size.height);

    cam.position.copy(bounds.center).addScaledVector(VIEW_DIRECTION, framing.distance);
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
      orbit.target.copy(bounds.center);
      orbit.minDistance = framing.minDistance;
      orbit.maxDistance = framing.maxDistance;
      orbit.update();
    }
    // One-shot per model: see the note above about resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, camera, controls]);

  return null;
}

export default function ModelViewerInner({
  url,
  commentToolActive = false,
  onSceneClick,
  worldPins = [],
  onPinPositionsUpdate,
  handleRef,
  transform = IDENTITY_TRANSFORM,
  transformMode,
  onTransformCommit,
  focalLength = DEFAULT_FOCAL_LENGTH,
}: ModelViewerInnerProps) {
  // The write path validates, but a row could still carry something unusable. A NaN here would
  // make the object vanish with no error anywhere, so fall back rather than propagate it.
  const safeTransform = isValidTransform(transform) ? transform : IDENTITY_TRANSFORM;

  const modelRef = useRef<THREE.Group>(null);
  const transformRef = useRef<THREE.Group>(null);
  const [bounds, setBounds] = useState<ModelBounds | null>(null);

  // Drop stale sizing the moment a different model is selected, so the ground and axes are
  // never drawn at the previous model's scale.
  useEffect(() => setBounds(null), [url]);

  // TransformControls mutates this group directly while dragging, and R3F will not put it back
  // — its prop diffing compares against the previous prop, not the object's real state. So when
  // the page hands us a transform again (notably after a failed save, where it re-sends the
  // persisted value), re-apply it by hand. Without this the object stays at a pose that was
  // never saved, while the pin maths still uses the persisted one.
  useEffect(() => {
    const group = transformRef.current;
    if (!group) return;
    group.position.set(safeTransform.position[0], safeTransform.position[1], safeTransform.position[2]);
    group.rotation.set(safeTransform.rotation[0], safeTransform.rotation[1], safeTransform.rotation[2]);
  }, [safeTransform]);

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
          <SceneLighting />
          {/* The transform group wraps <Center>, never the reverse. <Center> re-centres its
              contents and measures them with its own world matrix forced to identity, so it
              cannot see an ancestor — but a transform placed INSIDE it would be measured and
              cancelled out. Not visibly, either: Center's effect does not re-run as the object
              is dragged, so the failure is a stored placement silently discarded at first
              paint, permanently, rather than anything you would notice while dragging. */}
          <group
            ref={transformRef}
            position={safeTransform.position}
            rotation={safeTransform.rotation}
          >
            {/* Deliberately NOT <Center top>: comment pins are stored relative to the
                model, so moving the model would displace every pin saved before this
                change. The ground stack is offset down to the model's base instead. */}
            <Center>
              <group ref={modelRef}>
                <Model url={url} />
              </group>
            </Center>
          </group>
          <ApplyFocalLength focalLength={focalLength} />
          <MeasureModel key={url} targetRef={modelRef} transformRef={transformRef} onMeasured={setBounds} />
          {bounds && <FitCameraToModel bounds={bounds} />}
          {bounds && (
            // The ground stack is authored relative to the model's base; this puts that base
            // wherever the model actually sits, without moving the model itself.
            <group position={[0, bounds.center.y - bounds.height / 2, 0]}>
              <SceneGround radius={bounds.radius} height={bounds.height} />
              <SceneAxes radius={bounds.radius} height={bounds.height} />
            </group>
          )}
          <SceneInteraction
            commentToolActive={commentToolActive}
            onSceneClick={onSceneClick}
            worldPins={worldPins}
            onPinPositionsUpdate={onPinPositionsUpdate}
            modelRef={modelRef}
            transform={safeTransform}
          />
        </Suspense>
        <OrbitControls makeDefault />
        {transformMode && onTransformCommit && bounds && (
          <TransformGizmo
            targetRef={transformRef}
            mode={transformMode}
            onCommit={onTransformCommit}
          />
        )}
        <ViewGizmo />
        <CleanFrameRenderer handleRef={handleRef} />
      </Canvas>
    </div>
  );
}
