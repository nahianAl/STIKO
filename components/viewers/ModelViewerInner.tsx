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
import { buildPartTree, cascadeToDescendants, collectDrawables, hasAuthoredColors, hasMarkers, type PartNode } from '@/lib/model/partTree';
import { autoColors } from '@/lib/model/autoColor';
import { buildBatches, applyPartColor, applyPartVisibility, partKeyAt, type PartBatches } from '@/lib/model/buildBatches';
import { framingForRadius } from '@/lib/cameraFraming';
import { DEFAULT_FOCAL_LENGTH, fovForFocalLength } from '@/lib/focalLength';
import { isPointerOverGizmo } from '@/lib/gizmoLayout';
import { IDENTITY_TRANSFORM, isValidTransform, modelToWorld, worldToModel, type ObjectTransform } from '@/lib/objectTransform';
import { cuttingPlaneIds, defaultPoseFor, emptySlots, isClipped, type ModelBox, type PlaneId, type SectionSlots } from '@/lib/crossSection';
import { boundsForUrl, type MeasuredModel } from '@/lib/modelMeasurement';
import { registerModel } from '@/lib/model/modelCache';
import ViewGizmo from './ViewGizmo';
import TransformGizmo from './TransformGizmo';
import SceneGround from './SceneGround';
import SceneAxes from './SceneAxes';
import SceneLighting from './SceneLighting';
import ViewerNavigation from './ViewerNavigation';
import ApplyCrossSection from './section/ApplyCrossSection';
import SectionPlaneWidget from './section/SectionPlaneWidget';
import SectionCaps from './section/SectionCaps';
import MeasureLayer, { MEASURE_LINE_PICK_FRACTION } from './MeasureLayer';
import { ERASER_CURSOR } from '@/lib/cursors';
import { sweepPoints } from '@/lib/markup/eraseSweep';
import { DEFAULT_LENGTH_UNIT, type LengthUnit } from '@/lib/measure/units';
import type { Measurement } from '@/components/markup/useMeasurements';
import type { PendingGesture } from '@/lib/measure/gesture';
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
  /**
   * Source size of the file being displayed, for the model cache's eviction budget.
   *
   * This is the ORIGINAL's size while the viewer may be loading a smaller optimized
   * variant, so it overestimates. That is the safe direction — the budget evicts
   * sooner than strictly necessary — and it avoids both a schema change and threading
   * a byte count back out of the loader.
   */
  bytes: number;
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
   * way the viewport does, and it cannot see the materials itself. `baseColors` is each part's
   * own baked colour (first instance's, for a multi-instance part) — the panel's last-resort
   * fallback, replacing a fixed grey that disagreed with whatever the viewport actually showed.
   */
  onPartsLoaded?: (parts: PartNode[], authored: boolean, baseColors: Map<string, string>) => void;
  /** Fired when a part is clicked in the viewport (comment tool must be off). */
  onPartPick?: (key: string) => void;
  /** True while any measure tool is armed. Arms the pick path below; nothing else changes. */
  measureActive?: boolean;
  /**
   * A measurement click, in the MODEL's own frame — the same frame comment pins are stored in.
   *
   * The signature every measure surface shares, so lib/measure/gesture.ts never has to know
   * which one called it. `minSeparation` is in that surface's own units and is computed HERE
   * rather than by the caller; see MIN_SEPARATION_FRACTION.
   */
  onMeasurePoint?: (point: number[], minSeparation: number) => void;
  /** Committed measurements for this session. Drawn in the WebGL scene, never as DOM. */
  measurements?: Measurement[];
  /** The half-placed gesture, drawn as dots and a dashed line. */
  pendingMeasurement?: PendingGesture | null;
  /**
   * Where the cursor resolves to, in the MODEL's own frame, while a gesture is pending. Drawn as
   * a provisional last point so the leg and its running value follow the pointer between clicks.
   */
  measureHoverPoint?: number[] | null;
  /**
   * Reports the cursor's resolved position on every pointermove while a gesture is pending, and
   * null when it resolves to nothing. Resolved through the very same `pickModel` +
   * `nearestVertexSnap` + `worldToModel` chain the committing pointerup uses — see
   * SceneInteraction's `handlePointerMove`.
   */
  onMeasureHover?: (point: number[] | null) => void;
  /**
   * The toolbar's live colour, for the in-progress gesture. See MeasureLayer's `previewColor`.
   *
   * Required, not defaulted: ViewerContainer is this component's only caller and always has a
   * colour to hand over (the portal's `drawingColor`, the same value its `handleMeasurePoint`
   * stamps on the commit), so a default here would be unreachable dead code — worse, one that
   * could silently disagree with the toolbar's real default and break the one property this
   * preview exists to guarantee: that the preview ink matches the committed ink.
   */
  measurePreviewColor: string;
  /** Millimetres per model unit, or null when the file has no usable scale yet. */
  mmPerUnit?: number | null;
  /** The unit readings are displayed in. */
  measureUnit?: LengthUnit;
  selectedMeasurementId?: string | null;
  onSelectMeasurement?: (id: string | null) => void;
  /**
   * True while the eraser is the armed tool. A VIEWPORT MODE, not a markup session.
   *
   * Everywhere else the eraser is a Konva tool running over a frozen snapshot; here the
   * measurements it deletes are live scene objects, so the mode has to take the left-drag away
   * from the camera for as long as it is armed (see `eraserOwnsPointer` below). It deliberately
   * does NOT start an annotation session — freezing the viewport would turn the very
   * measurements it exists to remove into pixels in a snapshot — which is why 'eraser' is
   * absent from the portal page's DRAW_TOOLS and is not a measure tool either.
   */
  eraserActive?: boolean;
  /**
   * Erase one measurement, by id. The eraser's only route into the measure store.
   *
   * Required in practice whenever `eraserActive` can be true: `eraserOwnsPointer` below folds
   * the two into ONE condition, so a caller that arms the mode without wiring this gets a
   * viewer that behaves exactly as if the eraser were not armed — camera live, cursor
   * unchanged — rather than a dead mode that silently swallows drags.
   */
  onEraseMeasurement?: (id: string) => void;
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
  bytes,
  partColors,
  hiddenParts,
  highlightedPart,
  onPartsLoaded,
  onBatchesReady,
}: {
  url: string;
  bytes: number;
  partColors: Record<string, string>;
  hiddenParts: string[];
  highlightedPart: string | null;
  onPartsLoaded?: (parts: PartNode[], authored: boolean, baseColors: Map<string, string>) => void;
  /** Hands the batches to SceneInteraction so a click can be mapped back to a part. */
  onBatchesReady?: (batches: PartBatches | null) => void;
}) {
  const ext = getExtFromUrl(url);
  const LoaderClass = getLoaderForExt(ext);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = useLoader(LoaderClass as any, url);

  // Register with the bounded cache the moment the parse resolves. useLoader keeps
  // this tree alive forever on its own — no lifespan, and nothing in this repo used
  // to clear it — so without this every model opened stays resident for the life of
  // the tab. Re-running on the same url merely refreshes recency.
  useEffect(() => {
    registerModel({
      url,
      loader: LoaderClass,
      root: data,
      bytes,
      clearLoaderCache: (loader, cachedUrl) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useLoader.clear(loader as any, cachedUrl),
    });
  }, [url, LoaderClass, data, bytes]);

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

  // Whether the file's own import pipeline genuinely declared parts (a `stikoPart` marker
  // somewhere in the tree), as opposed to `buildPartTree`'s unmarked fallback, which treats the
  // scene root's direct children as one part each — true of almost every legacy upload, OBJ,
  // DAE and 3DS file, and never a sign that the file was actually segmented. Batching, the Parts
  // pill, and auto-colour must all key off THIS, not off `parts.length`: an unmarked file's
  // fallback output is >=1 for essentially any file, so `parts.length` alone would wrongly
  // route every legacy/OBJ/DAE/3DS upload through the batched-rendering path below, corrupting
  // <Center precise> centring (and every comment pin measured against it), silently
  // auto-colouring legacy models, and surfacing a Parts pill of meaningless `mesh_0`/`mesh_1`
  // rows that persist colour writes against keys with no lasting meaning.
  const marked = useMemo(() => (root ? hasMarkers(root) : false), [root]);
  const parts = useMemo(() => (root && marked ? buildPartTree(root) : []), [root, marked]);
  // HAZARD, currently latent, not live: buildBatches allocates real GPU resources (BatchedMesh
  // buffers, materials) inside this render-phase useMemo, while disposal only happens in the
  // commit-phase cleanup below (`useEffect(() => () => batches?.dispose(), [batches])`). React
  // is free to call a useMemo during a render it never commits — dev-only StrictMode double
  // invocation, or a concurrent render an update interrupts — and an abandoned render's
  // `batches` would then never reach that cleanup, leaking a full batch set silently. Safe today
  // NOT because `useLoader` suspends first — suspending only delays when this runs, it does not
  // stop a later render of the resolved tree from being invoked twice — but because R3F mounts
  // everything inside <Canvas> on its own reconciler root, created with `isStrictMode` hardcoded
  // to `false` (see `reconciler.createContainer(store, ConcurrentRoot, null, false, ...)` in
  // `@react-three/fiber/dist/events-*.esm.js`). That root never double-invokes render for
  // StrictMode's sake, regardless of whether Next's app router has StrictMode on for the DOM
  // tree outside the canvas — this component's renders are on the other side of that boundary.
  // A future change to how loading is orchestrated (concurrent rendering genuinely interrupting
  // a render, or a Suspense-less path) could still remove the guarantee that this only runs once
  // per committed model — if that happens, this is where the leak would start.
  const batches = useMemo<PartBatches | null>(() => (parts.length ? buildBatches(parts) : null), [parts]);
  // Line/point primitives — GLTFLoader's Line/LineSegments/LineLoop/Points for glTF's
  // LINES/LINE_STRIP/LINE_LOOP/POINTS modes — are not mesh geometry, so buildPartTree/
  // buildBatches never see them (BatchedMesh only ever holds triangle geometry). Collected
  // separately here and rendered as plain extra primitives below, alongside the batches: see
  // collectDrawables' doc comment for why they cannot carry a part key.
  //
  // collectDrawables returns a fresh, already-placed wrapper per drawable — never a node still
  // sitting inside `root` — specifically so this memo has nothing to mutate and nothing to
  // reparent. `root` is `useLoader`'s cached tree: a version of this that baked placement into
  // the drawable's OWN position/quaternion/scale while it was still nested inside `root` would
  // double every ancestor transform the moment the legacy `<primitive object={root ?? data} />`
  // branch below rendered that same (now-corrupted) `root`, and would corrupt it again on every
  // re-run of this memo, since nothing distinguishes "not yet baked" from "already baked" on the
  // mutated node. See collectDrawables' own doc comment in partTree.ts for the full reasoning —
  // this call is intentionally this thin.
  //
  // Gated on `marked`, the same signal batching itself gates on, not merely on `root` being
  // present. An unmarked (legacy/OBJ/DAE/3DS) model always takes the `<primitive object={root ??
  // data} />` branch below, which renders `root` itself — lines and points included — so this
  // memo's output is unconditionally discarded for every such file. Before this gate, a
  // 551-LINE_STRIP reference file paid for 551 wasted `Group` + clone allocations on every load
  // even though nothing downstream ever read them.
  const drawables = useMemo(() => (root && marked ? collectDrawables(root) : []), [root, marked]);
  // No dispose effect alongside this one, unlike `batches` below — and deliberately so, not an
  // oversight. `batches.dispose()` frees GPU buffers `buildBatches` allocated (BatchedMesh
  // geometry/material owned outright by the batch). Every wrapper here shares its geometry and
  // material with the drawable still sitting in `root` (see collectDrawables' doc comment), so
  // there is nothing this memo owns to free: the wrapper Group and its clone are plain JS
  // objects with no GPU resources of their own, R3F detaches them from the scene graph on
  // unmount/re-render like any other `<primitive>`, and disposing the SHARED geometry/material
  // here would free them out from under `root` — corrupting the useLoader cache exactly the way
  // mutating or reparenting the original drawable did before this fix.
  // Computed here, where the loaded materials are, and reported upward — the panel's swatches
  // must resolve colours the same way the viewport does, and it cannot see the materials.
  const authored = useMemo(() => (root ? hasAuthoredColors(root) : false), [root]);
  const automatic = useMemo(() => autoColors(parts, authored), [parts, authored]);

  // What each part's own baked colour is — the same fallback the viewport itself reaches for
  // (see the colour effect below: no override, no auto-colour -> the part keeps whatever colour
  // the model gave it) — reported upward so the panel's swatch can fall back to it too instead
  // of a fixed grey. Without this the panel had no way to agree with the viewport at all: a
  // `PartNode` carries no colour, so `effectivePartColor` in page.tsx could only ever resolve to
  // an override, an auto-colour, or BASE_GREY — never the part's real colour. A part with more
  // than one instance (a rim with a steel body and a chrome lip, say) picks its FIRST instance's
  // colour: the swatch is a single button and cannot show two colours at once, the same
  // simplification the hover-highlight path below already makes for the override/auto-colour
  // case.
  const partBaseColors = useMemo(() => {
    const map = new Map<string, string>();
    if (!batches) return map;
    // .forEach, not for...of: this tsconfig has no `target`, so a for...of over a Map fails
    // `next build` with TS2802 even though `npm test` passes.
    batches.instances.forEach((instanceList, key) => {
      const [first] = instanceList;
      if (first) map.set(key, `#${first.baseColor.getHexString()}`);
    });
    return map;
  }, [batches]);

  // Latched in refs rather than depended on directly. An inline arrow prop — which Task 9's
  // panel is expected to pass for onPartsLoaded — gets a new identity every parent render; if
  // that identity sat in an effect's deps, the loop would be parent re-render -> new arrow ->
  // effect re-runs -> callback fires -> parent re-renders again, unbounded. A ref always holds
  // the latest callback without the effect needing to depend on its identity.
  const onPartsLoadedRef = useRef(onPartsLoaded);
  useEffect(() => {
    onPartsLoadedRef.current = onPartsLoaded;
  }, [onPartsLoaded]);

  // onBatchesReady is a stable useState setter today (see ModelViewerInner's `setBatches`), so
  // this isn't a live bug — but it is one inline-arrow prop away from becoming the identical
  // infinite loop as onPartsLoaded above. Same treatment now, rather than waiting for that.
  const onBatchesReadyRef = useRef(onBatchesReady);
  useEffect(() => {
    onBatchesReadyRef.current = onBatchesReady;
  }, [onBatchesReady]);

  useEffect(() => () => batches?.dispose(), [batches]);

  useEffect(() => {
    onPartsLoadedRef.current?.(parts, authored, partBaseColors);
  }, [parts, authored, partBaseColors]);

  useEffect(() => {
    onBatchesReadyRef.current?.(batches);
    // Reported null on cleanup too — covering both Model unmounting and `batches` changing to a
    // new value. Without this, ModelViewerInner's `batches` state keeps whatever was last
    // reported, including a value the sibling dispose effect above is about to (or just did)
    // free, and the pick handler in SceneInteraction reads that state live. Both cleanups run
    // synchronously in the same passive-effect flush, before the next render or any new DOM
    // event can observe the state, so it does not matter which of the two cleanups runs first —
    // what matters is that the parent is told at all.
    return () => onBatchesReadyRef.current?.(null);
  }, [batches]);

  // Overrides win over auto-colours, auto-colours win over the model's own material, and a
  // hovered part outranks all three. Every part is written every time rather than diffed:
  // setColorAt is a texel write, and tracking which changed would cost more than redoing all.
  //
  // Highlight is a lightened version of what the part would otherwise be, not a fixed colour —
  // a fixed highlight over an already-similar part is invisible, which is the one case the
  // highlight exists for.
  //
  // Both `partColors` and `automatic` are keyed by whatever part the user or the auto-colour
  // ranking actually named — which, for a STEP assembly or any named-group GLB, is very often
  // an ASSEMBLY node whose own `meshes` is empty (`makePart` gives it none when every one of its
  // triangles lives under a nested boundary; see partTree.ts). `batches.instances` only ever
  // holds keys for parts that own geometry directly, so an assembly's key never appears there at
  // all — reading `partColors[key] ?? automatic.get(key)` per INSTANCE key, as this used to,
  // silently did nothing for exactly the rows the spec requires to work ("colour pill on an
  // assembly row applies to its whole subtree"). `cascadeToDescendants` resolves this once,
  // outside the per-instance loop: a leaf that has no colour of its own inherits its nearest
  // coloured ancestor's, while a leaf that DOES have its own override or auto-colour keeps it
  // regardless of any ancestor. Folding `automatic` into the same cascade as `partColors` is
  // deliberate, not incidental — an auto-coloured top-level assembly has exactly the same
  // "applies to the whole subtree" shape as a user override, and the two must resolve through
  // one precedence chain or a leaf could inherit an auto-colour past an override sitting between
  // it and the ranked ancestor.
  useEffect(() => {
    if (!batches) return;
    const cascadedColors = cascadeToDescendants(parts, (key) => partColors[key] ?? automatic.get(key));
    // .forEach, not for...of: this repo's tsconfig has no `target`, so a for...of over a
    // Map/Set passes `npm test` (ts-node) but fails `next build` with TS2802.
    batches.instances.forEach((instanceList, key) => {
      const hex = cascadedColors.get(key);
      const base = hex ? new THREE.Color(hex) : null;
      if (key !== highlightedPart) {
        applyPartColor(batches, key, base);
        return;
      }
      if (base) {
        // An explicit override or an auto-colour is one colour for the whole part regardless of
        // how many materials it has, so lightening it once and applying it uniformly is correct.
        applyPartColor(batches, key, base.lerp(new THREE.Color(0xffffff), 0.45));
        return;
      }
      // No override and no auto-colour: each instance keeps whatever colour the model itself
      // gave it, and those can genuinely differ within one part — e.g. a rim with a steel body
      // and a chrome lip, which the optimizer deliberately groups into a single part with two
      // instances. Lightening instanceList[0].baseColor and applying it to every instance would
      // collapse a genuinely two-material part to one colour while hovered; lighten each
      // instance's own baseColor instead.
      instanceList.forEach((instance) => {
        instance.mesh.setColorAt(instance.instanceId, instance.baseColor.clone().lerp(new THREE.Color(0xffffff), 0.45));
      });
    });
  }, [batches, parts, partColors, automatic, highlightedPart]);

  // Same cascade problem as colour, and the same fix: `hiddenParts` names whatever row the eye
  // was clicked on, which for an assembly row is a key `batches.instances` never holds (no
  // meshes of its own). Without cascading, hiding an assembly did nothing at all — the exact
  // failure described in the spec. A part inherits its nearest hidden ancestor's hidden-ness
  // only when it carries no explicit entry of its own; toggling a specific descendant's OWN eye
  // still adds/removes exactly that descendant's key (see `togglePartVisibility` in
  // app/portal/[id]/page.tsx, unchanged), so an explicitly-hidden descendant stays hidden even
  // after its ancestor is later shown again, and an explicitly-hidden descendant is what "a
  // descendant's own explicit setting must win over its ancestor's" means here: there is no
  // separate "explicitly shown" state to invent, since a key's mere ABSENCE from `hiddenParts`
  // already means "visible unless an ancestor says otherwise", which is exactly the fallback
  // this cascade produces for it.
  useEffect(() => {
    if (!batches) return;
    const hidden = new Set(hiddenParts);
    const cascadedHidden = cascadeToDescendants(parts, (key) => (hidden.has(key) ? true : undefined));
    batches.instances.forEach((_instances, key) => {
      applyPartVisibility(batches, key, !cascadedHidden.get(key));
    });
  }, [batches, parts, hiddenParts]);

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
        <primitive key={`batch-${i}`} object={mesh} />
      ))}
      {/* Carried unbatched: no part key, so no colour/hide/pick — see the drawables memo's
          comment above and collectDrawables' own doc comment in partTree.ts. */}
      {drawables.map((drawable, i) => (
        <primitive key={`drawable-${i}`} object={drawable} />
      ))}
    </>
  );
}

/** Snap radius in screen pixels. Beyond this the free surface point is the honest answer. */
const VERTEX_SNAP_PX = 12;

/**
 * How close two measurement clicks may land before the gesture reads as a misclick, as a
 * fraction of the model's bounding radius.
 *
 * Scene-scaled rather than fixed, and computed in the viewer rather than by the caller, for the
 * reason lib/sceneScale.ts documents: geometry here arrives with no unit convention and bounding
 * radii span 1 to 10,000. A constant floor would reject every click on a small model and accept
 * every misclick on a large one.
 */
const MIN_SEPARATION_FRACTION = 1e-4;

/**
 * Erase-drag sample spacing for the 3D viewport, in screen pixels — deliberately NOT
 * `ERASE_SAMPLE_SPACING` from `lib/markup/eraseSweep.ts`. That default (6px) is tuned for the
 * two Konva surfaces, whose hit areas are full annotation shapes. Here the pick radius is
 * `radius * MEASURE_LINE_PICK_FRACTION` in WORLD units (see `eraseMeasurementsAt`), which at
 * default framing projects to roughly 2 screen pixels — smaller than a Konva target, and
 * smaller again once the user zooms in past "default". A 6px sample spacing can step clean over
 * a target that narrow on a fast diagonal drag, and that is exactly the case an uncalibrated
 * file (OBJ/STL/PLY/3DS/DAE) hits hardest: no label sprite there (see `eraseMeasurementsAt`), so
 * a dimension's leg is the only target there is. Set below the ~2px pick radius, not merely
 * equal to it, so consecutive sample points still overlap the target after a zoom-in shrinks the
 * projected radius further.
 */
const ERASE_SAMPLE_SPACING_3D = 2;

/** The pin and measurement paths both want real surface geometry, not a wireframe polyline. */
function isSurfaceHit(hit: THREE.Intersection): boolean {
  return hit.object instanceof THREE.Mesh || hit.object instanceof THREE.SkinnedMesh;
}

function hasBatchId(hit: THREE.Intersection): boolean {
  return hit.batchId !== undefined;
}

/**
 * The nearest vertex of the hit triangle, in WORLD space, when one is within VERTEX_SNAP_PX of
 * the cursor on screen. Null otherwise — in which case the caller falls back to the free surface
 * point, which is the honest answer rather than a guess.
 *
 * Reads face indices straight off the intersection rather than precomputing anything: the model
 * is drawn as merged BatchedMesh batches, so there is no per-part vertex structure to consult.
 * three's BatchedMesh.raycast borrows the batch geometry's index and attributes for the hit test
 * and then reassigns `intersect.object` to the BatchedMesh, so `face.a/b/c` are valid indices
 * into `hit.object.geometry`'s position attribute.
 *
 * THE TRANSFORM IS THE TRAP. BatchedMesh.raycast places each instance with
 * `getMatrixAt(i).premultiply(matrixWorld)` (three 0.169.0, BatchedMesh.js:937), and
 * buildBatches.ts:271 deliberately puts every part's placement on its instance matrix —
 * "geometry stays in its own local space". Using `matrixWorld` alone drops the placement and
 * lands the snapped vertex on the wrong part of the assembly, plausibly enough that nothing
 * looks broken. A single-part model has an identity instance matrix and passes either way, so
 * only a multi-part assembly can tell the two apart.
 */
function nearestVertexSnap(
  hit: THREE.Intersection,
  camera: THREE.Camera,
  gl: THREE.WebGLRenderer,
): THREE.Vector3 | null {
  const face = hit.face;
  const mesh = hit.object as THREE.Mesh;
  const position = mesh.geometry?.getAttribute('position');
  if (!face || !position) return null;

  const toWorld = mesh.matrixWorld.clone();
  const batchId = hit.batchId;
  if (typeof batchId === 'number' && (mesh as THREE.BatchedMesh).isBatchedMesh) {
    const instance = new THREE.Matrix4();
    (mesh as THREE.BatchedMesh).getMatrixAt(batchId, instance);
    toWorld.multiply(instance);
  }

  const size = new THREE.Vector2();
  gl.getSize(size);
  // The hit point IS under the cursor by construction, so projecting it back is the cursor's
  // own NDC without having to thread the pointer event down here.
  const cursor = hit.point.clone().project(camera);

  let best: { point: THREE.Vector3; px: number } | null = null;
  for (const index of [face.a, face.b, face.c]) {
    const world = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(toWorld);
    const projected = world.clone().project(camera);
    const px = Math.hypot(
      ((projected.x - cursor.x) * size.x) / 2,
      ((projected.y - cursor.y) * size.y) / 2,
    );
    if (!best || px < best.px) best = { point: world, px };
  }

  return best && best.px <= VERTEX_SNAP_PX ? best.point : null;
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
  gizmoDraggingRef,
  measureActive,
  onMeasurePoint,
  pendingMeasurement,
  onMeasureHover,
  radius,
  eraserOwnsPointer,
  onEraseMeasurement,
  measureGroupRef,
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
  /** Set for the duration of a gizmo drag (TransformControls or a SectionPlaneWidget handle) —
   * a pick must not fire through it, the same reason the onClick deselect handler checks it. */
  gizmoDraggingRef: React.MutableRefObject<boolean>;
  measureActive: boolean;
  onMeasurePoint?: ModelViewerInnerProps['onMeasurePoint'];
  /**
   * The half-placed gesture. Read ONLY to gate the hover raycast below — this is the same prop
   * MeasureLayer draws from, not a second name for the same thing.
   */
  pendingMeasurement: PendingGesture | null;
  onMeasureHover?: ModelViewerInnerProps['onMeasureHover'];
  /** The model's bounding radius, or 0 until it has been measured. Scales the click floor. */
  radius: number;
  /**
   * The ONE condition under which the eraser owns the viewport's left-drag. Computed by the
   * caller and handed down whole rather than re-derived here, so the state that DISABLES the
   * camera, the state that shows the eraser cursor and the state these handlers can actually
   * erase in cannot drift apart. See `eraserOwnsPointer` in ModelViewerInner.
   */
  eraserOwnsPointer: boolean;
  onEraseMeasurement?: ModelViewerInnerProps['onEraseMeasurement'];
  /** MeasureLayer's root group — the eraser's raycast scope. Null until the layer mounts. */
  measureGroupRef: React.MutableRefObject<THREE.Group | null>;
}) {
  // `controls` is drei's CameraControls instance once <CameraControls makeDefault> has published
  // it — the same handle ViewerNavigation anchors the orbit pivot through.
  const { camera, gl, controls } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const tempVec3 = useRef(new THREE.Vector3());
  // A drag that orbits the camera must not also pick a part: pointerdown records where the
  // gesture started, and the pick raycast on pointerup only runs if it stayed within 4px of it.
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  // True between an erase pointerdown and the pointerup/leave that ends it, with the last
  // sampled screen point the sweep interpolates from. Both mirror the Konva surfaces' refs of
  // the same names; this is the third eraser, not a second kind of one.
  const erasingRef = useRef(false);
  const lastErasePointRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * A raycaster of the eraser's OWN, kept apart from `raycaster` above.
   *
   * Erasing needs raised Line and Points thresholds (see `eraseMeasurementsAt`) and the model
   * pick does not — a STEP file's wireframe polylines are THREE.Lines inside `modelRef`, so
   * widening the shared raycaster's line tolerance would silently change what every pin drop
   * and part pick considers a hit. Two raycasters, two answers, no coupling.
   */
  const eraseRaycaster = useRef(new THREE.Raycaster());

  /**
   * The frontmost model intersection under the pointer that survives both guards, or null.
   *
   * ONE raycast shared by all three pick paths — pin drop, measurement point and part select —
   * rather than a copy per tool. The gizmo-rect exclusion and the clipping test are the halves
   * that must never drift apart between them, and writing a second raycast beside this one is
   * exactly how they would.
   */
  const pickModel = useCallback(
    (
      e: PointerEvent,
      accept: (hit: THREE.Intersection) => boolean,
    ): THREE.Intersection | null => {
      const model = modelRef.current;
      if (!model) return null;

      const rect = gl.domElement.getBoundingClientRect();

      // The gizmo is a HUD layer, not scene geometry, and its React Three Fiber
      // stopPropagation does not reach this native listener — so exclude its rect by hand.
      if (isPointerOverGizmo(e.clientX - rect.left, e.clientY - rect.top, rect.width)) return null;

      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(mouse.current, camera);

      // Scoped to the model alone, not the whole scene: the ground disc, contact shadow and
      // axis lines are all Mesh-derived and large enough to fill the viewport, so they would
      // otherwise catch clicks intended for empty background and drop pins in space.
      for (const hit of raycaster.current.intersectObject(model, true)) {
        // three's raycaster ignores clipping planes entirely, so the halves a cross-section
        // hides stay fully hittable. Without this, clicking into an opened cavity drops the pin
        // (or a measurement point) on invisible geometry — and it then appears to float in
        // space once the section is cleared. Several planes clip by intersection, so a hit
        // survives only if it is on the kept side of all of them. Same guard, same reason, as
        // ViewerNavigation's orbit-anchor raycast.
        if (isClipped(clipPlanesRef.current, hit.point)) continue;
        if (accept(hit)) return hit;
      }
      return null;
    },
    [camera, gl, modelRef, clipPlanesRef]
  );

  /**
   * Deletes the frontmost measurement under a screen point, if there is one.
   *
   * Scoped to MeasureLayer's own group and NOTHING else — deliberately not `scene`, and
   * deliberately not a filter applied after the fact. The model must never be an erase target,
   * and the way to guarantee that is for it never to enter the candidate list: an "erase" that
   * could reach geometry would be a destructive action on the file being reviewed, not a markup
   * undo. The half-placed gesture's preview dots live in the same group and are skipped by
   * construction too, since only a COMMITTED entry's group carries `measurementId`.
   *
   * Cross-section clipping is NOT tested here, unlike `pickModel` above, and that asymmetry is
   * on purpose: a measurement's label sprite is drawn unclipped (see MeasureLayer's
   * spriteMaterial comments), so a dimension inside a cut-away region is still visible and
   * still worth erasing. Adding the test would produce a reading you can see and cannot delete.
   * Click-to-select applies no clip test either, for the same reason — though it and this sweep
   * otherwise diverge on the label sprite itself; see the `THREE.Sprite` skip below.
   */
  const eraseMeasurementsAt = useCallback(
    (clientX: number, clientY: number) => {
      const group = measureGroupRef.current;
      if (!group) return;

      const rect = gl.domElement.getBoundingClientRect();
      mouse.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      eraseRaycaster.current.setFromCamera(mouse.current, camera);

      // three's line/point thresholds are WORLD distances defaulting to 1 (Raycaster.js), which
      // is only ever right by accident: bounding radii in this app span 1 to 10,000 (see
      // lib/sceneScale.ts). Left alone, a dimension's leg is a sub-pixel target on a large model
      // — and on an uncalibrated file (OBJ/STL/PLY/3DS/DAE) the label sprite is not rendered at
      // all, so the leg and its endpoint dots are the ONLY things the eraser could hit. The line
      // half uses the very fraction the click-to-select path raises the SHARED raycaster by,
      // imported from MeasureLayer rather than re-typed, so the two cannot independently drift;
      // the endpoint dots get the same figure for consistency, since nothing else raycasts Points
      // in this scene.
      //
      // `radius` is 0 until the model has been measured, which would leave both thresholds at 0
      // — and that is exactly the window in which MeasureLayer is not mounted either, so the
      // `group` guard above has already returned.
      //
      // Math.max against the CURRENT value below, not a plain assignment — mirroring
      // MeasureLayer's own `threshold = Math.max(previous, radius * MEASURE_LINE_PICK_FRACTION)`
      // effect on the shared raycaster. A plain assignment here would NOT actually match that
      // path: three.js defaults Line.threshold (and Points.threshold) to 1 world unit, so on a
      // radius-1 model the click-to-select path sits at max(1, 0.005) = 1 while an unguarded
      // assignment would leave this raycaster at 0.005 — strictly harder to land than a click,
      // despite the fraction being shared. Applied to Points too, even though MeasureLayer's
      // effect never touches Points.threshold (R3F's shared raycaster never picks Points): this
      // raycaster does, via the endpoint dots, so its own default (also 1) is the "previous" that
      // needs the same floor.
      const threshold = radius * MEASURE_LINE_PICK_FRACTION;
      eraseRaycaster.current.params.Line.threshold = Math.max(
        eraseRaycaster.current.params.Line.threshold,
        threshold
      );
      eraseRaycaster.current.params.Points.threshold = Math.max(
        eraseRaycaster.current.params.Points.threshold,
        threshold
      );

      for (const hit of eraseRaycaster.current.intersectObject(group, true)) {
        // The label sprite is excluded on purpose, unlike click-to-select (MeasureLayer.tsx's
        // own onClick, a separate path this loop never touches): the sprite is sized at a
        // fraction of camera distance, which makes it the LARGEST target a dimension has, so a
        // sweep meant to clip only the number would erase the whole reading. The 2D surface
        // never had this hazard — MeasureObjects.tsx's pill is `listening={false}` — so this
        // keeps the two surfaces agreeing on what an erase sweep may hit, at the cost of a
        // sprite-only sweep not erasing at all. Clicking the number to SELECT it is left alone.
        if (hit.object instanceof THREE.Sprite) continue;
        // The ray lands on a leg or an endpoint dot — never on the group that carries the id —
        // so walk up to the entry. Bounded at the layer's own root: above it is the rest of the
        // scene, which can never carry one.
        let node: THREE.Object3D | null = hit.object;
        while (node && node !== group && node.userData?.measurementId === undefined) {
          node = node.parent;
        }
        const id = node?.userData?.measurementId as string | undefined;
        // Optional call for the type checker only: `eraserOwnsPointer` already folds in
        // `!!onEraseMeasurement`, so this is never reached without a handler.
        if (id) {
          onEraseMeasurement?.(id);
          return;
        }
      }
    },
    [camera, gl, measureGroupRef, onEraseMeasurement, radius]
  );

  /** Ends an erase gesture. Idempotent, and safe to call when none was running. */
  const stopErasing = useCallback(() => {
    erasingRef.current = false;
    lastErasePointRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (eraserOwnsPointer) {
        // Left button only — right-drag is the pan gesture, and middle is dolly.
        if (e.button !== 0) return;
        // No drag origin is RECORDED — nothing on the pointerup path can fire while the eraser
        // is armed (see its first branch), and an origin written but never consumed is exactly
        // the stale value that handler documents as unsafe to leave sitting in the ref. Any
        // origin already there is cleared for the same reason: a press on this canvas starts a
        // new gesture, so whatever a previous unmatched press left behind is dead.
        pointerDownPos.current = null;
        erasingRef.current = true;
        lastErasePointRef.current = { x: e.clientX, y: e.clientY };
        // Erase on the press itself, so a single click with no movement erases; the sweep in
        // the move handler then continues from here until pointerup.
        eraseMeasurementsAt(e.clientX, e.clientY);
        return;
      }

      pointerDownPos.current = { x: e.clientX, y: e.clientY };

      if (!commentToolActive || !onSceneClick) return;

      const hit = pickModel(e, isSurfaceHit);
      if (!hit) return;

      const point = hit.point;
      const projected = point.clone().project(camera);
      const screenPercent = {
        x: ((projected.x + 1) / 2) * 100,
        y: ((1 - projected.y) / 2) * 100,
      };
      // Stored relative to the model, so the pin travels with it when it is moved.
      const local = worldToModel([point.x, point.y, point.z], transform);
      onSceneClick({ x: local[0], y: local[1], z: local[2] }, screenPercent);
    },
    [commentToolActive, onSceneClick, camera, pickModel, eraseMeasurementsAt, eraserOwnsPointer, transform]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      // The eraser ends its gesture here and consumes the event, so no pin, measurement point
      // or part pick can fire from the same press. Tested on `erasingRef` as WELL as on the
      // mode: a gesture that started while the eraser was armed must be closed out even if the
      // mode was disarmed mid-press, or the ref stays armed and ordinary mouse movement turns
      // into silent deletion.
      if (erasingRef.current || eraserOwnsPointer) {
        stopErasing();
        return;
      }

      // A pin drop is deliberately NOT one of the branches below: it already happened on
      // pointerdown, so the comment tool consumes the whole gesture and no two of the three
      // can ever fire from one click.
      if (commentToolActive) return;

      // Which tool wants this pointerup, tested before the drag origin is touched so that an
      // unarmed viewer leaves the ref exactly as it always did.
      //
      // A measurement point lands HERE rather than on pointerdown, unlike a pin, and that is
      // the whole reason for putting it in this handler: a measure tool leaves the viewport
      // live and orbitable (the portal page keeps 3D measuring out of its annotation-session
      // effect on purpose), so a left-drag that orbits the model is the commonest gesture
      // while one is armed. Only this handler's 4px test can stop that drag from also
      // dropping a point.
      if (measureActive ? !onMeasurePoint || radius <= 0 : !onPartPick || !batches) return;

      // A stationary right-click is the pan gesture, not a pick — R3F/native listeners get no
      // button filtering for free the way onPointerMissed's delta<=2 check does. And a click
      // that ends on a TransformControls handle or a SectionPlaneWidget reaches this raw
      // listener as an ordinary pointerup on whatever geometry happens to be behind it, since
      // neither stops propagation to it — so a plane-select drag would otherwise also pick the
      // part under the plane from the same click.
      if (e.button !== 0 || gizmoDraggingRef.current) return;

      const down = pointerDownPos.current;
      if (!down) return;
      // Consumed here, not left for next time: a pointerup with no matching canvas pointerdown
      // (the down happened on an HTML overlay instead, which this native listener never sees)
      // would otherwise still find the PREVIOUS gesture's origin sitting in the ref and test
      // itself against it — and if that stale point happens to land within 4px, a pick fires
      // for a gesture that never started on the model at all. Clearing immediately, rather than
      // only on a path that reaches the end of this handler, means every return below (over a
      // gizmo, no model, no hit) already leaves the ref clean for the next pointerup to find
      // `null` and bail at the check above, instead of re-testing against this same stale point.
      pointerDownPos.current = null;
      // A drag that orbits the camera must not also select — only a pointer that stayed put
      // reads as a click; past this threshold the user was orbiting.
      if (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4) return;

      if (measureActive) {
        if (!onMeasurePoint) return;
        // Surface hits only: a snap needs a triangle, and a STEP wireframe polyline has none.
        const hit = pickModel(e, isSurfaceHit);
        if (!hit) return;
        // A snapped vertex comes back in WORLD space, so it goes through the SAME worldToModel
        // conversion the pin path above uses — not a separate one. Points are stored in the
        // model's own frame so a measurement travels with a moved or rotated object instead of
        // floating where it was placed.
        const snapped = nearestVertexSnap(hit, camera, gl);
        const world = snapped ?? hit.point;
        const local = worldToModel([world.x, world.y, world.z], transform);
        onMeasurePoint(local, radius * MIN_SEPARATION_FRACTION);
        return;
      }

      // A part pick runs only when neither the comment tool nor a measure tool is armed, so
      // the three are mutually exclusive by construction rather than by luck.
      if (!onPartPick || !batches) return;
      const hit = pickModel(e, hasBatchId);
      if (!hit || hit.batchId === undefined) return;
      const key = partKeyAt(batches, hit.object, hit.batchId);
      if (key) onPartPick(key);
    },
    [
      commentToolActive,
      measureActive,
      onMeasurePoint,
      radius,
      onPartPick,
      batches,
      pickModel,
      camera,
      gl,
      transform,
      gizmoDraggingRef,
      eraserOwnsPointer,
      stopErasing,
    ]
  );

  /**
   * The cursor's resolved measurement point, reported on every move while a gesture is live.
   *
   * Resolving it is SHARED with handlePointerUp's commit branch above, deliberately and in every
   * step: the same `pickModel` (so the gizmo-rect exclusion and the clipping test cannot drift
   * between preview and commit), the same `nearestVertexSnap`, the same `worldToModel`. A second
   * raycast written beside them would resolve the point a little differently, and the previewed
   * point would visibly jump somewhere else at the instant the user clicked — worse than showing
   * no preview at all.
   *
   * Unlike the commit this does NOT go through the 4px drag test: a preview that stopped
   * updating the moment the user began orbiting would be exactly backwards, and nothing is
   * committed here, so a drag costs at most a stale-looking dashed line for its duration.
   */
  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (eraserOwnsPointer) {
        // A pointerup this canvas never received — focus lost mid-press (Cmd-Tab, Mission
        // Control, an OS dialog) and the button released elsewhere — would otherwise leave
        // erasingRef armed forever, since pointerup and pointerleave are the only other places
        // that clear it. buttons === 0 means the press has already ended. Same guard, same
        // reason, as the two Konva surfaces' own eraser move handlers.
        if (e.buttons === 0) {
          stopErasing();
          return;
        }
        if (!erasingRef.current) return;
        const to = { x: e.clientX, y: e.clientY };
        // Interpolated, because pointer events arrive about once a frame and a quick flick
        // would otherwise jump clean over a dimension between two samples. Spacing is
        // ERASE_SAMPLE_SPACING_3D (2px), not eraseSweep's own 6px default — see that constant's
        // comment for why this viewport needs a tighter one.
        for (const point of sweepPoints(lastErasePointRef.current, to, ERASE_SAMPLE_SPACING_3D)) {
          eraseMeasurementsAt(point.x, point.y);
        }
        lastErasePointRef.current = to;
        return;
      }

      if (!measureActive || !onMeasureHover) return;
      // Gated on a gesture that already has a click in it, NOT merely on one existing.
      // `beginGesture` starts a gesture with an EMPTY points array the moment the tool is armed,
      // so `pendingMeasurement` is non-null for the whole armed session — testing it for null
      // alone would raycast the entire model on every idle mouse move, before the first click,
      // to preview a line that has no first point to draw from.
      if (!pendingMeasurement || pendingMeasurement.points.length === 0) {
        onMeasureHover(null);
        return;
      }

      // Surface hits only, exactly like the commit: a snap needs a triangle, and a STEP
      // wireframe polyline has none.
      const hit = pickModel(e, isSurfaceHit);
      if (!hit) {
        onMeasureHover(null);
        return;
      }

      const snapped = nearestVertexSnap(hit, camera, gl);
      const world = snapped ?? hit.point;
      onMeasureHover(worldToModel([world.x, world.y, world.z], transform));
    },
    [
      measureActive,
      onMeasureHover,
      pendingMeasurement,
      pickModel,
      camera,
      gl,
      transform,
      eraserOwnsPointer,
      eraseMeasurementsAt,
      stopErasing,
    ]
  );

  /**
   * Without this, moving off the canvas mid-gesture leaves the last `handlePointerMove` report
   * standing forever: nothing else clears it, so the dashed leg freezes pointing at the edge
   * until the pointer comes back. Mirrors the Konva surfaces' `onMouseLeave`.
   */
  const handlePointerLeave = useCallback(() => {
    // The pointerup that ends an erase drag off the edge of the canvas is delivered to whatever
    // element it happened over, never here — so leaving is the last event this listener set will
    // see, and it has to close the gesture. Unconditional, for the same reason pointerup's
    // branch tests the ref: what matters is that a gesture was in flight, not what is armed now.
    stopErasing();
    if (!measureActive || !onMeasureHover) return;
    onMeasureHover(null);
  }, [measureActive, onMeasureHover, stopErasing]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [gl, handlePointerDown, handlePointerUp, handlePointerMove, handlePointerLeave]);

  /**
   * Holds the camera off for as long as the eraser owns the pointer.
   *
   * `<CameraControls enabled={!eraserOwnsPointer}>` is the primary gate and sets this in the
   * very commit the tool is armed — but it is a React PROP DIFF, so it is re-applied only when
   * its own value changes. `controls.enabled` has a second writer that goes behind React's back:
   * drei's TransformControls sets it true on every drag end, and TransformGizmo's unmount
   * cleanup restores it unconditionally (see the comment there — it has its own good reason).
   * Either write landing while the eraser is armed would hand the left-drag back to the camera
   * for the rest of the session, because `eraserOwnsPointer` has not changed and nothing would
   * re-apply the prop. That is not hypothetical: arming the eraser makes the portal page disarm
   * the transform gizmo, which unmounts it, which runs exactly that cleanup one commit later.
   *
   * ONE-DIRECTIONAL on purpose. Nothing here ever writes `true`; restoring is the prop's job,
   * and it fires exactly once on the transition. Re-asserting `true` every frame instead would
   * break the gizmo's own drag-time disable for every user who is not erasing.
   */
  useFrame(() => {
    if (!eraserOwnsPointer) return;
    const cc = controls as unknown as CameraControlsImpl | null;
    if (cc && cc.enabled) cc.enabled = false;
  });

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

/**
 * Stable empty default for the `measurements` prop. A fresh `[]` in the parameter list would be
 * a new identity every render, which MeasureLayer's memo would take for a changed measurement
 * list and rebuild every label texture against.
 */
const NO_MEASUREMENTS: Measurement[] = [];

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
 *
 * The key ALSO carries whether the model is currently batched, which is what makes this
 * component's single measurement land on the right side of `<Center precise={!batches}>`
 * flipping mid-load. `batches` is state in ModelViewerInner, set from a passive effect inside
 * <Model> — so on the FIRST commit of a batched model, that state is still null (it always
 * starts that way), `<Center precise={!batches}>` is therefore `precise={true}` even though the
 * BatchedMesh is already attached that same commit, and Center's layout effect positions the
 * model using the WRONG (per-vertex, local-space) offset the big comment on `precise` documents.
 * A SECOND commit follows once `setBatches` lands, where `precise` is finally `false` and Center
 * repositions correctly — but this component was mounted on the FIRST commit (the url has not
 * changed, so nothing remounted it), its `useEffect` has empty deps, and it therefore already
 * ran, once, against the wrong first-commit offset, forever. Folding `batches` into this key
 * forces an actual remount the moment it flips from null to non-null, so the fresh instance's
 * one-shot effect runs against the corrected, second-commit positioning instead. A model that
 * never batches (legacy/STL/PLY, or a marked tree with nothing left to batch) never sees this
 * key change at all — `batches` stays null for its whole life — so its measurement, and every
 * comment pin stored against it, is unaffected.
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
  bytes,
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
  measureActive = false,
  onMeasurePoint,
  measurements = NO_MEASUREMENTS,
  pendingMeasurement = null,
  measureHoverPoint = null,
  onMeasureHover,
  measurePreviewColor,
  mmPerUnit = null,
  measureUnit = DEFAULT_LENGTH_UNIT,
  selectedMeasurementId = null,
  onSelectMeasurement,
  eraserActive = false,
  onEraseMeasurement,
}: ModelViewerInnerProps) {
  // The write path validates, but a row could still carry something unusable. A NaN here would
  // make the object vanish with no error anywhere, so fall back rather than propagate it.
  const safeTransform = isValidTransform(transform) ? transform : IDENTITY_TRANSFORM;
  // A stable idle default, so a caller that omits the prop does not hand a fresh object to
  // ApplyCrossSection on every render.
  const idleSlots = useMemo(() => emptySlots(), []);
  const slots = sectionSlots ?? idleSlots;

  /**
   * THE condition for "the eraser owns the viewport's left-drag". One expression, read by all
   * four things that must agree about it: the camera gate on <CameraControls> below, the
   * frame-loop hold inside SceneInteraction, that component's pointer handlers, and the cursor.
   *
   * Written once and passed down rather than re-derived at each site. Task 5's failure on the
   * 2D surfaces was precisely these drifting apart — the layer listened in a state the eraser
   * could not erase in, so it silently became a selection tool — and the shape of that bug here
   * would be worse: a mode that takes the camera away and then erases nothing.
   *
   * `!!onEraseMeasurement` is part of it because a mode with nowhere to send a deletion must not
   * disable the camera. `!commentToolActive` is the same precedence handlePointerUp already
   * gives the comment tool: it consumes the whole gesture, so the two can never fire from one
   * press. There is no `measureActive` clause because there cannot be one — the portal's
   * `activeTool` is a single value and 'eraser' is not a measure tool, so the two are mutually
   * exclusive at the source.
   */
  const eraserOwnsPointer = eraserActive && !commentToolActive && !!onEraseMeasurement;

  const modelRef = useRef<THREE.Group>(null);
  const transformRef = useRef<THREE.Group>(null);
  // MeasureLayer's root group, so the eraser can raycast against measurements and nothing else.
  // Null whenever that layer is unmounted (no bounds yet, or a file switch in flight), which is
  // also exactly when there is nothing on screen to erase.
  const measureGroupRef = useRef<THREE.Group | null>(null);
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
  //
  // The background poll is what makes this dangerous now: any add/delete elsewhere in the
  // version hands the page a fresh `transform` identity for every file, including the one on
  // screen, even though its values are unchanged. Applying that here while gizmoDraggingRef is
  // true would hard-reset this group out from under a live drag, snapping the object back to its
  // persisted pose under the user's cursor — and TransformGizmo's onMouseUp would then commit
  // THAT snapped pose as if the user had dragged it there. Skip while a drag owns this group.
  // Nothing is lost by skipping: TransformGizmo's onMouseUp always runs onCommit, and
  // handleTransformCommit always gives `transform` a fresh identity of its own afterwards —
  // on success with the just-dragged values, on failure with the reverted ones (see its comment
  // in page.tsx) — so this effect fires again with the latest value once dragging is over.
  //
  // That guarantee is the MODEL gizmo's. The plane gizmo shares this same ref and deliberately
  // has no onCommit (planes are session-only), so an identity arriving during a plane drag is
  // skipped with nothing to re-fire it. Harmless, and not worth plumbing for: a plane drag never
  // mutates THIS group, so the write being skipped would have been a no-op. Do not generalise the
  // sentence above into "any drag re-applies afterwards" — only one of the two does.
  useEffect(() => {
    const group = transformRef.current;
    if (!group || gizmoDraggingRef.current) return;
    group.position.set(safeTransform.position[0], safeTransform.position[1], safeTransform.position[2]);
    group.rotation.set(safeTransform.rotation[0], safeTransform.rotation[1], safeTransform.rotation[2]);
  }, [safeTransform]);

  return (
    <div
      className="h-full w-full"
      style={{
        minHeight: 400,
        // A measure tool places points by clicking exactly the way the comment tool does, so it
        // gets the same cursor. It does NOT freeze the viewport, so the viewer stays orbitable
        // underneath it.
        //
        // The eraser is the one mode that DOES take the viewport's left-drag (see
        // `eraserOwnsPointer`), and it is checked first so the cursor promises exactly what the
        // press will do — the same condition that disables the camera and the same one the
        // pointer handlers act on, never a fourth opinion about which tool is live.
        cursor: eraserOwnsPointer
          ? ERASER_CURSOR
          : commentToolActive || measureActive
            ? 'crosshair'
            : undefined,
      }}
    >
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
          // R3F fires this for a stationary 'contextmenu' as well as 'click' (both are
          // click-type DOM events it applies the same delta<=2 check to). Right-click is the
          // pan gesture, not a deselect gesture, so only a primary-button click should count.
          if (e.button !== 0) return;
          // A click on empty space is the only way out of a measurement selection: MeasureLayer
          // only ever calls onSelect with an id, and the portal's own clears happen when a
          // measurement is removed. A highlight with no way out turns the next Delete into a
          // surprise — the portal's window keydown deletes the selected measurement while the
          // markup surface's deletes the selected object, so one keypress removes two things.
          // The drag guard is R3F's own: it reaches this handler only when the click hit
          // nothing AND its accumulated pointer-move delta was <= 2 (see the isClickEvent
          // branch in events-*.esm.js), so an orbit ending over empty space clears nothing.
          onSelectMeasurement?.(null);
          // Nothing selected, nothing to deselect — avoid disarming an unrelated
          // object-gizmo session (see onSelectPlane in page.tsx).
          if (selectedPlane === null) return;
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
                change. The ground stack is offset down to the model's base instead.

                precise={!batches} — conditional, NOT hardcoded to one value, and that split is
                load-bearing. Do not "simplify" this back to a single literal either way; both
                halves below are deliberate and each protects a different case:

                BATCHED (batches truthy): precise MUST be false. drei's default precise=true
                calls `Box3().setFromObject(inner, true)`, and three r169's `expandByObject`
                only takes the fast/approximate branch for `isInstancedMesh` — `BatchedMesh`
                sets `isBatchedMesh`, not `isInstancedMesh`, so the precise branch runs and
                calls `getVertexPosition(i)`. `BatchedMesh` does NOT override that method
                (only `Mesh.prototype` defines it), so it reads straight off the shared merged
                buffer in each part's original LOCAL space — buildBatches deliberately never
                bakes placement into the geometry, only into each instance's matrix — and never
                consults `getMatrixAt`. Every part collapses onto wherever its geometry sat
                before batching, so the measured box (and the centring offset derived from it)
                is wrong for any model with more than one part. precise={false} instead reaches
                `BatchedMesh.computeBoundingBox()`, which unions each instance's own bounding
                box through `getMatrixAt(i)` — the correct per-instance transform, the same path
                MeasureModel below already relies on, and cheaper besides. There is nothing for
                BatchedMesh to be precise about.

                LEGACY (batches null — the `<primitive object={root ?? data} />` path in Model,
                and STL/PLY's single `<mesh>`): precise MUST stay true, i.e. drei's own default.
                precise=false gives a CONSERVATIVE box — each geometry's own bounding box
                transformed and unioned, not each vertex — so for a model with rotated
                sub-geometry the union overshoots and the computed centre shifts from where
                precise=true (vertex-exact) would put it. This offset sits between
                `transformRef` (the frame comment pins are stored in, via `worldToModel`) and
                `modelRef`, so a changed offset displaces every pin ever saved against a legacy
                model — which is every pin that exists today, since batched models are new
                uploads with none yet. `!batches` keeps every legacy model's centring, and every
                stored pin, bit-identical to what it was before this branch touched `<Center>`
                at all. */}
            <Center precise={!batches}>
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
                  // Same clear as the Canvas's onPointerMissed above, for the other half of "a
                  // click that missed the measurements": this handler runs only when the press
                  // landed on the model rather than on a dimension, since MeasureLayer's own
                  // onClick stops propagation. Without a clear on both paths a measurement stays
                  // highlighted for the rest of the session, and the next Delete removes it on
                  // top of whatever markup object the user actually meant to delete.
                  onSelectMeasurement?.(null);
                  // Nothing selected, nothing to deselect — avoid disarming an unrelated
                  // object-gizmo session (see onSelectPlane in page.tsx).
                  if (selectedPlane === null) return;
                  onSelectPlane?.(null);
                }}
              >
                <Model
                  url={url}
                  bytes={bytes}
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
                  //
                  // The eraser is on the same list for the same reason: its press already
                  // deletes whatever dimension is under the cursor, and a plane sheet is a large
                  // target sitting across the whole model, so without this every erase click
                  // that grazed one would also leave a plane highlighted behind it.
                  selectable={!commentToolActive && !eraserOwnsPointer}
                  gizmoDraggingRef={gizmoDraggingRef}
                  objectRef={registerPlaneObject}
                  onSelect={(next) => onSelectPlane?.(next)}
                />
              ))}
            {/* Inside the placement group and OUTSIDE <Center>, and that position is the whole
                contract. Measurement points are stored in the MODEL's frame — what
                `worldToModel` produces, which undoes this group's position and rotation and
                nothing else — so this is the one node in the tree whose local space IS that
                frame. Mounted here, a measurement is carried by a move or a rotate for free.
                Moved INSIDE <Center> it would pick up the centring offset as well and sit a
                bounding-box's distance from the geometry it was taken on, and it would also
                feed its own points into the box <Center> measures. */}
            {bounds && (
              <MeasureLayer
                measurements={measurements}
                pending={pendingMeasurement}
                hoverPoint={measureHoverPoint}
                previewColor={measurePreviewColor}
                mmPerUnit={mmPerUnit}
                unit={measureUnit}
                selectedId={selectedMeasurementId}
                onSelect={onSelectMeasurement}
                // Selecting a dimension is only ever the intended gesture when no tool owns the
                // click. With a measure tool armed the same press also drops a gesture point
                // (SceneInteraction's pointerup), and with the comment tool armed it drops a
                // pin — the PDF surface draws exactly the same line with `listening`.
                //
                // The eraser is on that list for a sharper reason, and it is the whole lesson of
                // the 2D eraser: this handler and the erase raycast resolve a hit through
                // DIFFERENT raycasters, so a dimension the eraser's threshold just missed could
                // still satisfy R3F's — and the press would select what it was meant to delete.
                // Erasing removes the node before the click could fire in the normal case, which
                // is exactly what makes the failure intermittent rather than obvious.
                selectable={!measureActive && !commentToolActive && !eraserOwnsPointer}
                clipPlanesRef={clipPlanesRef}
                radius={bounds.radius}
                // The eraser's raycast scope. Handed over here and nowhere else, so "what the
                // eraser can reach" is literally the subtree this layer draws.
                groupRef={measureGroupRef}
              />
            )}
          </group>
          <ApplyFocalLength focalLength={focalLength} />
          {/* `batches` in the key, not just `url` — see MeasureModel's own doc comment for why
              a model whose <Center precise> flips from true to false mid-load needs an actual
              remount to be measured against the corrected offset rather than the first commit's
              wrong one. */}
          <MeasureModel
            key={`measure-${url}-${batches ? 'batched' : 'unbatched'}`}
            targetRef={modelRef}
            transformRef={transformRef}
            onMeasured={handleMeasured}
          />
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
            gizmoDraggingRef={gizmoDraggingRef}
            measureActive={measureActive}
            onMeasurePoint={onMeasurePoint}
            // The same gesture MeasureLayer draws, handed over ONLY so the hover raycast can be
            // gated on a gesture that has actually started — see handlePointerMove.
            pendingMeasurement={pendingMeasurement}
            onMeasureHover={onMeasureHover}
            // 0 until the model has been measured, which is also the value that keeps the
            // measure branch of the pick handler shut: there is no scene scale to size the
            // minimum click separation against yet.
            radius={bounds?.radius ?? 0}
            eraserOwnsPointer={eraserOwnsPointer}
            onEraseMeasurement={onEraseMeasurement}
            measureGroupRef={measureGroupRef}
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
          // The eraser and the camera want the same left-drag, and camera-controls deliberately
          // never calls preventDefault() on pointerdown (see its own comment in onPointerDown),
          // so there is no way for SceneInteraction's listener to take the gesture from it.
          // Without this an erase drag orbits the model instead of erasing.
          //
          // `enabled` rather than a narrower mouseButtons override because it covers touch and
          // pinch too, and because the setter calls cancel() — a drag already in flight when the
          // tool is armed is ended cleanly instead of being left half-applied. The cost is that
          // wheel dolly and right-drag pan are off for as long as the eraser is armed, which is
          // the deliberate trade: the mode is transient, and one input mapping that is sometimes
          // live is worse than a viewport that is plainly in eraser mode.
          //
          // SceneInteraction re-asserts this every frame while the mode is armed; see the
          // useFrame there for the second writer this prop alone cannot answer.
          enabled={!eraserOwnsPointer}
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
