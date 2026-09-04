'use client';

import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber';
import { CameraControls, Center } from '@react-three/drei';
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
import { repairExporterDefaults } from '@/lib/model/repairMaterials';
import { buildPartTree, hasAuthoredColors, type PartNode } from '@/lib/model/partTree';
import { autoColors } from '@/lib/model/autoColor';
import { buildBatches, applyPartColor, applyPartVisibility, partKeyAt, type PartBatches } from '@/lib/model/buildBatches';
import { framingForRadius } from '@/lib/cameraFraming';
import { DEFAULT_FOCAL_LENGTH, fovForFocalLength } from '@/lib/focalLength';
import { isPointerOverGizmo } from '@/lib/gizmoLayout';
import { IDENTITY_TRANSFORM, isValidTransform, modelToWorld, worldToModel, type ObjectTransform } from '@/lib/objectTransform';
import { cuttingPlaneIds, defaultPoseFor, emptySlots, isClipped, type ModelBox, type PlaneId, type SectionSlots } from '@/lib/crossSection';
import { boundsForUrl, type MeasuredModel } from '@/lib/modelMeasurement';
import ViewGizmo from './ViewGizmo';
import TransformGizmo from './TransformGizmo';
import SceneGround from './SceneGround';
import SceneAxes from './SceneAxes';
import SceneLighting from './SceneLighting';
import ViewerNavigation from './ViewerNavigation';
import ApplyCrossSection from './section/ApplyCrossSection';
import SectionPlaneWidget from './section/SectionPlaneWidget';
import SectionCaps from './section/SectionCaps';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Collada } from 'three/examples/jsm/loaders/ColladaLoader.js';
import type CameraControlsImpl from 'camera-controls';

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
  /**
   * Axis-aligned bounds in the model's own frame, before the placement transform.
   *
   * `defaultPoseFor` needs this rather than `radius` to place each cutting plane at the
   * model's centre: it averages `box.min`/`box.max` per axis to find that point. A bounding
   * SPHERE only carries a single centre and radius, and that centre happens to equal the
   * box's only because `getBoundingSphere` derives it from the same box internally — an
   * implementation detail of a type meant for framing and sizing, not a guarantee to place
   * geometry against. Deriving the plane's centre from the box directly keeps it exact
   * regardless of that detail.
   */
  box: ModelBox;
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
  /** Per-slot cross-section flags. Every slot idle means the model is not sectioned. */
  sectionSlots?: SectionSlots;
  /** Which plane the Move/Rotate gizmo targets, or null for none. */
  selectedPlane?: PlaneId | null;
  onSelectPlane?: (id: PlaneId | null) => void;
  /**
   * Fired when the model has loaded and been measured — the first moment there
   * is something real on screen. The viewport's loading indicator waits on it.
   * Measurement is the right signal rather than the loader resolving: it runs
   * inside Suspense, after the geometry exists, and it is what every other
   * "the model is here now" gate in this file keys off.
   */
  onReady?: () => void;
  /** Explicit per-part overrides, keyed by `PartNode.key`. Outranked only by the hovered part. */
  partColors: Record<string, string>;
  /** Keys of parts the eye has switched off. */
  hiddenParts: string[];
  /** The part under the cursor, if any — outranks both overrides and auto-colour. */
  highlightedPart: string | null;
  /**
   * Fired whenever the loaded model's part tree changes. Computed here, where the loaded
   * materials live, and reported upward — the panel's swatches must resolve colours the same
   * way the viewport does, and it cannot see the materials itself.
   */
  onPartsLoaded?: (parts: PartNode[], authored: boolean) => void;
  /** Fired when a part is clicked in the viewport (comment tool must be off). */
  onPartPick?: (key: string) => void;
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

function Model({
  url,
  partColors,
  hiddenParts,
  highlightedPart,
  onPartsLoaded,
  onBatchesReady,
}: {
  url: string;
  partColors: Record<string, string>;
  hiddenParts: string[];
  highlightedPart: string | null;
  onPartsLoaded?: (parts: PartNode[], authored: boolean) => void;
  /** Hands the batches to SceneInteraction so a click can be mapped back to a part. */
  onBatchesReady?: (batches: PartBatches | null) => void;
}) {
  const ext = getExtFromUrl(url);
  const LoaderClass = getLoaderForExt(ext);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = useLoader(LoaderClass as any, url);

  // For PLY, compute vertex normals once
  useMemo(() => {
    if (ext === '.ply' && data instanceof THREE.BufferGeometry) data.computeVertexNormals();
  }, [ext, data]);

  const root = useMemo<THREE.Object3D | null>(() => {
    if (data instanceof THREE.BufferGeometry) return null;
    return data instanceof THREE.Object3D ? data : ((data as GLTF | Collada)?.scene ?? null);
  }, [data]);

  // Materials that ship inside the file (OBJ / 3DS / DAE / STEP / glTF) are single-sided
  // by default, which hides the far inner wall of thin or perforated parts when you look
  // through an opening. STL and PLY use the shared materials above, already double-sided.
  //
  // Repair runs first and on the LOADED tree, before batching: it only ever touches materials
  // the exporter left at glTF's metal=1/rough=1 defaults, and buildBatches reads those same
  // materials to decide appearance groups and baked colours. Batching a pitch-black material
  // would bake pitch black.
  useMemo(() => {
    if (!root) return;
    repairExporterDefaults(root);
    makeDoubleSided(root);
  }, [root]);

  const parts = useMemo(() => (root ? buildPartTree(root) : []), [root]);
  const batches = useMemo<PartBatches | null>(() => (parts.length ? buildBatches(parts) : null), [parts]);
  // Computed here, where the loaded materials are, and reported upward — the panel's swatches
  // must resolve colours the same way the viewport does, and it cannot see the materials.
  const authored = useMemo(() => (root ? hasAuthoredColors(root) : false), [root]);
  const automatic = useMemo(() => autoColors(parts, authored), [parts, authored]);

  useEffect(() => () => batches?.dispose(), [batches]);

  useEffect(() => {
    onPartsLoaded?.(parts, authored);
  }, [parts, authored, onPartsLoaded]);

  useEffect(() => {
    onBatchesReady?.(batches);
  }, [batches, onBatchesReady]);

  // Overrides win over auto-colours, auto-colours win over the model's own material, and a
  // hovered part outranks all three. Every part is written every time rather than diffed:
  // setColorAt is a texel write, and tracking which changed would cost more than redoing all.
  //
  // Highlight is a lightened version of what the part would otherwise be, not a fixed colour —
  // a fixed highlight over an already-similar part is invisible, which is the one case the
  // highlight exists for.
  useEffect(() => {
    if (!batches) return;
    const color = new THREE.Color();
    // .forEach, not for...of: this repo's tsconfig has no `target`, so a for...of over a
    // Map/Set passes `npm test` (ts-node) but fails `next build` with TS2802.
    batches.instances.forEach((instanceList, key) => {
      const hex = partColors[key] ?? automatic.get(key);
      const base = hex ? color.clone().set(hex) : null;
      if (key !== highlightedPart) {
        applyPartColor(batches, key, base);
        return;
      }
      const source = base ?? instanceList[0].baseColor;
      applyPartColor(batches, key, source.clone().lerp(new THREE.Color(0xffffff), 0.45));
    });
  }, [batches, partColors, automatic, highlightedPart]);

  useEffect(() => {
    if (!batches) return;
    const hidden = new Set(hiddenParts);
    batches.instances.forEach((_instances, key) => {
      applyPartVisibility(batches, key, !hidden.has(key));
    });
  }, [batches, hiddenParts]);

  if (ext === '.stl' || ext === '.ply') {
    const geometry = data as THREE.BufferGeometry;
    const material = geometry.hasAttribute('color')
      ? VERTEX_COLOR_MATERIAL
      : DEFAULT_MATERIAL;
    return <mesh geometry={geometry} material={material} />;
  }

  // No parts found — a legacy upload whose hierarchy was flattened at import, or a format
  // that never carried one. Render the tree as-is rather than pretending to segment it.
  if (!batches || !root) return <primitive object={root ?? data} />;

  return (
    <>
      {batches.meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </>
  );
}

function SceneInteraction({
  commentToolActive,
  onSceneClick,
  worldPins,
  onPinPositionsUpdate,
  modelRef,
  transform,
  clipPlanesRef,
  batches,
  onPartPick,
}: {
  commentToolActive: boolean;
  onSceneClick?: ModelViewerInnerProps['onSceneClick'];
  worldPins: WorldPin[];
  onPinPositionsUpdate?: ModelViewerInnerProps['onPinPositionsUpdate'];
  modelRef: React.RefObject<THREE.Object3D>;
  transform: ObjectTransform;
  clipPlanesRef: React.MutableRefObject<THREE.Plane[]>;
  batches: PartBatches | null;
  onPartPick?: ModelViewerInnerProps['onPartPick'];
}) {
  const { camera, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const tempVec3 = useRef(new THREE.Vector3());
  // A drag that orbits the camera must not also pick a part: pointerdown records where the
  // gesture started, and the pick raycast on pointerup only runs if it stayed within 4px of it.
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      pointerDownPos.current = { x: e.clientX, y: e.clientY };

      if (!commentToolActive || !onSceneClick) return;

      const model = modelRef.current;
      if (!model) return;

      const rect = gl.domElement.getBoundingClientRect();

      // The gizmo is a HUD layer, not scene geometry, and its React Three Fiber
      // stopPropagation does not reach this native listener — so exclude its rect by hand.
      if (isPointerOverGizmo(e.clientX - rect.left, e.clientY - rect.top, rect.width)) return;

      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera(mouse.current, camera);
      // Scoped to the model alone, not the whole scene: the ground disc, contact shadow and
      // axis lines are all Mesh-derived and large enough to fill the viewport, so they would
      // otherwise catch clicks intended for empty background and drop pins in space.
      const intersects = raycaster.current.intersectObject(model, true);

      for (const hit of intersects) {
        if (!(hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh)) continue;

        // three's raycaster ignores clipping planes entirely, so the halves a cross-section
        // hides stay fully hittable. Without this, clicking into an opened cavity drops the pin
        // on invisible geometry — and it then appears to float in space once the section is
        // cleared. Several planes clip by intersection, so a hit survives only if it is on the
        // kept side of all of them. Same guard, same reason, as ViewerNavigation's orbit-anchor
        // raycast.
        if (isClipped(clipPlanesRef.current, hit.point)) continue;

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
    },
    [commentToolActive, onSceneClick, camera, gl, modelRef, transform, clipPlanesRef]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      // A part pick is not a pin drop: it runs when the comment tool is OFF, so the two can
      // never both fire from one click.
      if (commentToolActive || !onPartPick || !batches) return;

      const down = pointerDownPos.current;
      if (!down) return;
      // A drag that orbits the camera must not also select — only a pointer that stayed put
      // reads as a click; past this threshold the user was orbiting.
      if (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4) return;

      const model = modelRef.current;
      if (!model) return;

      const rect = gl.domElement.getBoundingClientRect();
      if (isPointerOverGizmo(e.clientX - rect.left, e.clientY - rect.top, rect.width)) return;

      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(mouse.current, camera);

      for (const hit of raycaster.current.intersectObject(model, true)) {
        // Same clipping guard, same reason, as the pin raycast above: three's raycaster
        // ignores clipping planes, so a cross-sectioned-away half stays hittable and would
        // select a part the viewer cannot see.
        if (isClipped(clipPlanesRef.current, hit.point)) continue;
        if (hit.batchId === undefined) continue;
        const key = partKeyAt(batches, hit.object, hit.batchId);
        if (key) onPartPick(key);
        break;
      }
    },
    [commentToolActive, onPartPick, batches, modelRef, gl, camera, clipPlanesRef]
  );

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
    };
  }, [gl, handlePointerDown, handlePointerUp]);

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
 * Mounted inside <Suspense> under a url-derived key, so it runs exactly once per loaded
 * model: React commits the whole boundary together, meaning the geometry is already in the
 * scene graph when this effect fires. Runs as an effect rather than a layout effect so that
 * <Center>'s own layout effect has already positioned the model.
 *
 * `onMeasured` is read once, on mount, and never again — so the caller's callback has to
 * already know which model it is reporting for. The url-derived key is what makes that safe:
 * a url change remounts this component, and the callback it captures was created in the same
 * parent render as the <Model> whose geometry it is about to measure. See the note on
 * `handleMeasured` in ModelViewerInner for why the pairing matters.
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
      box: {
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
      },
    });
    // One-shot per model; the component is remounted by key when the url changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/**
 * Drives the camera's field of view from a focal length in millimetres.
 *
 * The fov depends on the lens alone (see lib/focalLength.ts), so this does NOT need to
 * re-run on resize — that is deliberate, and it is why collapsing a side panel reveals more
 * scene rather than zooming the model.
 *
 * FitCameraToModel reads cam.fov when it works out how far back to sit, so it must never run
 * before this has set it. What guarantees that is not the sibling order below but the fact
 * that FitCameraToModel is gated on `bounds`, which is null until MeasureModel has published
 * a measurement for the url now on screen. This mounts with the Canvas and never remounts, so
 * that publication can only land in a commit after this one has already set the fov, for the
 * first model and every model after it. Keep that gate.
 */
function ApplyFocalLength({ focalLength }: { focalLength: number }) {
  const { camera } = useThree();

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = fovForFocalLength(focalLength);
    cam.updateProjectionMatrix();
  }, [camera, focalLength]);

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

    cam.near = framing.near;
    cam.far = framing.far;
    cam.updateProjectionMatrix();

    const position = bounds.center.clone().addScaledVector(VIEW_DIRECTION, framing.distance);

    const cc = controls as unknown as CameraControlsImpl | null;
    if (!cc?.setLookAt) {
      // Controls have not mounted yet. Frame the model directly rather than leaving the
      // camera at the placeholder position, which sits inside anything bigger than a few units.
      cam.position.copy(position);
      cam.lookAt(bounds.center);
      return;
    }

    // Assigned before setLookAt: these are the single source of truth for the dolly range,
    // and ViewerNavigation reads them straight off the controls when it clamps an anchor.
    // camera-controls defaults are Number.EPSILON and Infinity, which clamp nothing.
    cc.minDistance = framing.minDistance;
    cc.maxDistance = framing.maxDistance;

    // setOrbitPoint — how ViewerNavigation anchors the pivot under the cursor — does not
    // merely move the target: it holds the camera still by adding a compensating focal
    // offset, and that offset persists on the controls afterwards. setLookAt below does not
    // clear it (only fitToBox, fitToSphere, reset and fromJSON do). This effect does not own
    // the controls: they belong to the <Canvas> and outlive every run of it, and it re-runs on
    // each change of `bounds`, `camera` or `controls` — so it has no basis for assuming the
    // offset is still zero, whichever way the viewer is hosted. Both ways exist here, and the
    // difference is only in how much is at stake. ViewerContainer drops <ModelViewer> for a
    // loading state while it fetches the next presigned url, so a file switch THERE builds a
    // fresh Canvas and fresh controls; a host that swaps the `url` prop on a mounted viewer
    // keeps one Canvas, and with it one controls instance carrying whatever the last orbit
    // left on it, across every model. That second case is where the cost shows: measured at
    // the default 35mm lens, one ordinary orbit of a 5,000-radius model then leaves a
    // 1-radius model framed 5,339 units away behind a far plane of 42 — a blank viewport,
    // with no control on screen that can recover it. Zeroing is idempotent, which is what
    // makes it safe to do unconditionally on every run. It is NOT redundant with the
    // setLookAt that follows; do not delete it.
    cc.setFocalOffset(0, 0, 0, false);

    // false: no transition. This is the opening view of a freshly loaded model, so there is
    // nothing to animate from.
    cc.setLookAt(
      position.x, position.y, position.z,
      bounds.center.x, bounds.center.y, bounds.center.z,
      false,
    );
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
  sectionSlots,
  selectedPlane = null,
  onSelectPlane,
  onReady,
  partColors,
  hiddenParts,
  highlightedPart,
  onPartsLoaded,
  onPartPick,
}: ModelViewerInnerProps) {
  // The write path validates, but a row could still carry something unusable. A NaN here would
  // make the object vanish with no error anywhere, so fall back rather than propagate it.
  const safeTransform = isValidTransform(transform) ? transform : IDENTITY_TRANSFORM;
  // A stable idle default, so a caller that omits the prop does not hand a fresh object to
  // ApplyCrossSection on every render.
  const idleSlots = useMemo(() => emptySlots(), []);
  const slots = sectionSlots ?? idleSlots;

  const modelRef = useRef<THREE.Group>(null);
  const transformRef = useRef<THREE.Group>(null);
  // Held beside the model ref: SceneInteraction needs it to map a click's batchId back to a
  // part key, and it can only come from inside <Model>, where the batches are actually built.
  const [batches, setBatches] = useState<PartBatches | null>(null);
  // Written by ApplyCrossSection, read by the raycast guards in SceneInteraction (pin drops)
  // and ViewerNavigation (orbit anchoring). three's raycaster ignores clipping planes, so both
  // have to reject hits on the hidden halves by hand. Empty when nothing is cutting.
  const clipPlanesRef = useRef<THREE.Plane[]>([]);
  // Widget groups, keyed by slot. ApplyCrossSection reads their world matrices each frame and
  // TransformGizmo targets whichever one is selected.
  const planeObjects = useRef<Map<PlaneId, THREE.Group>>(new Map());
  const registerPlaneObject = useCallback((id: PlaneId, object: THREE.Group | null) => {
    if (object) planeObjects.current.set(id, object);
    else planeObjects.current.delete(id);
  }, []);
  // Set for the duration of a gizmo drag, on either target. See TransformGizmo's doc comment
  // for why this exists.
  const gizmoDraggingRef = useRef(false);
  // The measurement is stored WITH the url it was taken from, and `bounds` is derived by
  // matching that url against the current one. Nothing clears it. Everything below that sizes
  // itself off `bounds` — the framing, the dolly range, the ground and axes, the cross-section
  // box — therefore falls back to null the moment a different model is selected, by
  // derivation, in the same render rather than in a later commit.
  //
  // Do NOT "tidy this up" back into a `useEffect(() => setBounds(null), [url])` reset. That
  // is what it used to be, and it was a bug. It made `bounds` a piece of state with two
  // writers in two DIFFERENT React roots: the reset lived out here in the DOM tree, while
  // MeasureModel — which lives inside <Canvas>, i.e. inside React Three Fiber's own separate
  // reconciler — wrote the new measurement from its mount effect. React orders passive
  // effects within a root, not between two roots that schedule independently. The loading
  // model normally suspends, which pushes the measurement into a commit after the reset and
  // hides the problem; a url already in useLoader's cache does not suspend, so MeasureModel
  // remounts in the very first commit the new url produces and the two writes race. When the
  // measurement lands first the reset wipes it and nothing measures again — MeasureModel's
  // effect has [] deps and is only remounted by a url change that has already happened.
  // Observed on 4 of 668 scripted model switches and still stuck 400 frames later: every
  // `bounds &&` gate below stays closed, so the ground, axes and contact shadow never mount,
  // ViewerNavigation never mounts, and the controls keep the PREVIOUS model's
  // minDistance/maxDistance and near/far. Deriving removes the race rather than shortening
  // it: one writer, and the question "does this measurement belong to the model on screen?"
  // becomes a comparison instead of an ordering.
  const [measured, setMeasured] = useState<MeasuredModel<ModelBounds> | null>(null);
  const bounds = boundsForUrl(measured, url);

  // Stamps the measurement with the url of the render that produced it. MeasureModel captures
  // this once, in its mount effect, and is remounted by key on every url change — so the
  // callback it holds and the <Model> it measures were created in the same render and can
  // never disagree about which model this is. A measurement that arrives late, after the url
  // has moved on again, is then simply ignored by the line above instead of being adopted as
  // the current model's size.
  const handleMeasured = useCallback(
    (next: ModelBounds) => {
      setMeasured({ url, bounds: next });
      onReady?.();
    },
    [url, onReady],
  );

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
        // all three from the model's bounding sphere as soon as it loads. fov is derived from
        // the default focal length rather than a literal, since focal length is the source of
        // truth and ApplyFocalLength overwrites it anyway once mounted.
        camera={{ position: [3, 3, 3], fov: fovForFocalLength(DEFAULT_FOCAL_LENGTH) }}
        style={{ background: '#f0f0f0' }}
        // A 3x display renders 9x the fragments of a 1x one for no reviewable detail.
        dpr={[1, 2]}
        // localClippingEnabled is what makes per-material clippingPlanes take effect at all;
        // without it the cross-section silently does nothing. `stencil` is what makes the cut
        // faces in SectionCaps work — WebGL2 contexts do not allocate a stencil buffer unless
        // asked, and without one every cap quad draws unmasked over the whole model.
        gl={{ preserveDrawingBuffer: true, localClippingEnabled: true, stencil: true }}
        onPointerMissed={(e) => {
          if (gizmoDraggingRef.current) return;
          // Nothing selected, nothing to deselect — avoid disarming an unrelated
          // object-gizmo session (see onSelectPlane in page.tsx).
          if (selectedPlane === null) return;
          // R3F fires this for a stationary 'contextmenu' as well as 'click' (both are
          // click-type DOM events it applies the same delta<=2 check to). Right-click is the
          // pan gesture, not a deselect gesture, so only a primary-button click should count.
          if (e.button !== 0) return;
          onSelectPlane?.(null);
        }}
      >
        {/* fallback={null} on purpose. This used to be a grey wireframe box,
            which read as a SECOND loading state: the viewport's own indicator
            stopped when the file list arrived, and then a wireframe cube sat in
            the scene while the model actually downloaded. The viewport now
            holds one indicator up until onReady, which fires from the
            measurement below — after the geometry is really in the scene — so
            there is nothing for a placeholder to cover. */}
        <Suspense fallback={null}>
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
              <group
                ref={modelRef}
                onClick={(e) => {
                  // A gizmo drag reaches R3F as a click on nothing in particular — drei's
                  // TransformControls does not stop propagation — so a drag that happens to
                  // finish over the model would otherwise deselect the plane being dragged.
                  if (gizmoDraggingRef.current) return;
                  // R3F's own delta<=2 drag-vs-click check (see events-*.esm.js) is applied
                  // ONLY on the onPointerMissed path below; an object's onClick, this one, gets
                  // no such check and fires on every genuine DOM 'click' — including one a
                  // left-drag orbit produces, since camera-controls deliberately never calls
                  // preventDefault() on pointerdown. Without this guard, any orbit that starts
                  // and ends over the model deselects the plane, which is the primary viewer
                  // gesture misfiring constantly. `e.delta` is R3F's accumulated pointer-move
                  // distance for the click; 2 is the same threshold R3F applies itself.
                  if (e.delta > 2) return;
                  // Nothing selected, nothing to deselect — avoid disarming an unrelated
                  // object-gizmo session (see onSelectPlane in page.tsx).
                  if (selectedPlane === null) return;
                  onSelectPlane?.(null);
                }}
              >
                <Model
                  url={url}
                  partColors={partColors}
                  hiddenParts={hiddenParts}
                  highlightedPart={highlightedPart}
                  onPartsLoaded={onPartsLoaded}
                  onBatchesReady={setBatches}
                />
              </group>
            </Center>
            {bounds &&
              cuttingPlaneIds(slots).map((id) => (
                <SectionPlaneWidget
                  // Keyed by url as well as slot: a new model must get a fresh pose from the
                  // new bounding box, and the pose is applied on mount only.
                  key={`plane-${url}-${id}`}
                  id={id}
                  pose={defaultPoseFor(id, bounds.box)}
                  // Big enough to span the model at any angle, with room to grab past the edge.
                  size={bounds.radius * 2.6}
                  visible={slots[id].visible}
                  selected={selectedPlane === id}
                  // The comment tool and the plane gizmo are mutually exclusive (see the page's
                  // [transformMode] effect and SceneInteraction's raw pointerdown listener
                  // above); without this, one click on a visible plane both drops a pin AND
                  // selects the plane, arming Move over the very model being commented on.
                  selectable={!commentToolActive}
                  gizmoDraggingRef={gizmoDraggingRef}
                  objectRef={registerPlaneObject}
                  onSelect={(next) => onSelectPlane?.(next)}
                />
              ))}
          </group>
          <ApplyFocalLength focalLength={focalLength} />
          <MeasureModel key={`measure-${url}`} targetRef={modelRef} transformRef={transformRef} onMeasured={handleMeasured} />
          {bounds && <FitCameraToModel bounds={bounds} />}
          {bounds && (
            <ViewerNavigation
              modelRef={modelRef}
              center={bounds.center}
              clipPlanesRef={clipPlanesRef}
            />
          )}
          {bounds && (
            // A url-derived key, so a model change forces a remount: the cleanup clears
            // clippingPlanes from the materials under modelRef, but nothing in the effect
            // tracks which model modelRef points at, and remounting guarantees the cleanup
            // runs against the model it applied to before modelRef can be pointing at a
            // different one. The `section-` prefix is not decoration — MeasureModel is a
            // sibling in this same children array and keyed off the same url, so a bare
            // `key={url}` gave the two the same key. React then treats them as one slot: it
            // warns, and it was seen once in eight model switches to commit the new model's
            // geometry while leaving minDistance/maxDistance/near/far on the previous model's
            // values, which ViewerNavigation reads live as its clamp and step size.
            <ApplyCrossSection
              key={`section-${url}`}
              slots={slots}
              modelRef={modelRef}
              planeObjects={planeObjects}
              planesRef={clipPlanesRef}
            />
          )}
          {bounds && (
            <SectionCaps
              key={`caps-${url}`}
              slots={slots}
              modelRef={modelRef}
              planeObjects={planeObjects}
              planesRef={clipPlanesRef}
              size={bounds.radius * 2.6}
            />
          )}
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
            clipPlanesRef={clipPlanesRef}
            batches={batches}
            onPartPick={onPartPick}
          />
        </Suspense>
        {/* Replaces OrbitControls, which cannot express an off-centre orbit pivot: it calls
            lookAt(target) on every update, pinning the pivot to the centre of the screen.
            ViewerNavigation re-anchors this one to whatever is under the cursor when a rotate
            drag starts. Zoom is left to dollyToCursor below, which migrates the target itself.

            The default input mapping already matches what the viewer has always had —
            left rotate, middle dolly, right pan, wheel dolly — so it is left alone.

            infinityDolly is deliberately NOT set here. ViewerNavigation enables it per wheel
            event by direction and clears it again on pointerdown and on unmount, so that the
            limitless dolly never leaks into the drag or pinch paths; a prop would fight that
            on re-render. */}
        <CameraControls
          makeDefault
          dollyToCursor
          smoothTime={0.15}
          draggingSmoothTime={0.08}
        />
        {/* Two mutually exclusive targets. With a plane selected the gizmo drives that plane
            and commits nothing — a plane's pose is session-only. Otherwise it drives the
            model's placement, which is persisted. The page guarantees a plane can only be
            selected while the cross-section tool is open, which is when object placement is
            deliberately unavailable. */}
        {/* This `.get(selectedPlane)` read happens at RENDER time, off a ref that
            SectionPlaneWidget only populates from its own MOUNT effect (`objectRef` above).
            Effects run after the render that triggered them, so a commit where `selectedPlane`
            is already non-null in the very render a widget first mounts would find nothing
            here — the gizmo would stay unmounted, and nothing in this component's deps would
            ever retry the lookup, since nothing here depends on the map's contents changing.
            Not reachable today: `bounds` only goes null on a `url` change, ViewerContainer
            sets `url` to null first (which unmounts this whole viewer before a new one mounts),
            and the page resets `selectedPlane` to null on a file change — so a widget never
            mounts fresh with a stale non-null `selectedPlane` already in hand. If a future
            change ever keeps this Canvas alive across a file switch (e.g. swapping `url` on a
            mounted viewer instead of remounting it), that guarantee breaks and this gizmo can
            go permanently missing for the newly selected plane. Do not restructure this away
            pre-emptively; note it here so the invariant travels with the code that depends on
            it. */}
        {transformMode && bounds && selectedPlane !== null && planeObjects.current.get(selectedPlane) && (
          <TransformGizmo
            key={`plane-gizmo-${selectedPlane}`}
            target={planeObjects.current.get(selectedPlane)!}
            mode={transformMode}
            draggingRef={gizmoDraggingRef}
          />
        )}
        {transformMode && onTransformCommit && bounds && selectedPlane === null && transformRef.current && (
          <TransformGizmo
            target={transformRef.current}
            mode={transformMode}
            onCommit={onTransformCommit}
            draggingRef={gizmoDraggingRef}
          />
        )}
        <ViewGizmo />
        <CleanFrameRenderer handleRef={handleRef} />
      </Canvas>
    </div>
  );
}
