'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { distance, angleAt } from '@/lib/measure/geometry';
import { formatLength, formatAngle, type LengthUnit } from '@/lib/measure/units';
import type { Measurement } from '@/components/markup/useMeasurements';
import type { PendingGesture } from '@/lib/measure/gesture';

/**
 * Measurements drawn INSIDE the WebGL scene rather than as a DOM overlay.
 *
 * That is not a style choice. captureViewerSnapshot (app/portal/[id]/page.tsx) reads pixels off
 * the WebGL canvas and nothing else, so a drei <Html> label would be missing from every snapshot
 * a user posts — and since measurements are session-only, snapshotting one into a comment is the
 * ONLY way to keep it. A sprite with a canvas texture is captured for free.
 *
 * For the same reason nothing here is marked `userData.excludeFromSnapshot`, unlike the transform
 * handles: ModelViewerHandle.renderCleanFrame hides exactly what carries that flag, and it must
 * drop viewer chrome while keeping measurements.
 *
 * Every point arrives in the MODEL's own frame — the frame comment pins are stored in — so this
 * component is mounted inside ModelViewerInner's placement group and OUTSIDE its <Center>, which
 * is the only place where those two frames coincide. See the call site's comment.
 */

const LINE_COLOR = '#1C2030';
const SELECTED_COLOR = '#5B60FF';
const ARC_SEGMENTS = 32;

/**
 * Drawn last, over the model. Set on every object individually and NOT on the wrapping group:
 * three's renderOrder is per object and a group's value is not inherited by its children, so a
 * single value on the group would leave every line and label sorting at the default 0.
 */
const RENDER_ORDER = 999;

/** Label sprites are sized against the camera each frame so text stays legible at any zoom. */
const LABEL_WORLD_HEIGHT_FRACTION = 0.035;

/** Screen size of the dots marking a half-placed gesture's clicks so far. */
const PENDING_POINT_PX = 9;

/** Dash and gap of the in-progress line, as a fraction of the model's bounding radius. */
const PENDING_DASH_FRACTION = 0.02;
const PENDING_GAP_FRACTION = 0.012;

function makeLabelTexture(text: string): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const padding = 12;
  const fontSize = 40;
  const font = `600 ${fontSize}px system-ui, sans-serif`;

  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + padding * 2;
  const height = fontSize + padding * 2;

  // Resizing a canvas RESETS its 2d context to defaults, including the font just used to
  // measure with — which is why every drawing property is set below this line, not above it.
  canvas.width = width;
  canvas.height = height;

  // Inset by half the stroke width: a rect at 0,0 would have the outer half of its border
  // clipped off by the canvas edge on all four sides.
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height - 2, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(28,32,48,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = font;
  ctx.fillStyle = LINE_COLOR;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  // The canvas holds sRGB colours. Without this three takes them for linear data and the pill
  // renders noticeably washed out against everything else in the scene.
  texture.colorSpace = THREE.SRGBColorSpace;
  // A label is only ever drawn at roughly its own size; mipmaps would cost memory to blur it.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function toVectors(points: number[][]): THREE.Vector3[] {
  return points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
}

function midpoint(a: number[], b: number[]): THREE.Vector3 {
  return new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

/** The arc between the two legs of an angle, drawn at a fraction of the shorter leg. */
function arcPoints(vertex: number[], a: number[], b: number[]): THREE.Vector3[] {
  const v = new THREE.Vector3(vertex[0], vertex[1], vertex[2]);
  const va = new THREE.Vector3(a[0], a[1], a[2]).sub(v);
  const vb = new THREE.Vector3(b[0], b[1], b[2]).sub(v);
  const radius = Math.min(va.length(), vb.length()) * 0.28;
  va.normalize();
  vb.normalize();
  const axis = new THREE.Vector3().crossVectors(va, vb);
  // Collinear legs have no plane to sweep an arc in, and normalizing a zero vector leaves it
  // zero — applyAxisAngle would then build a non-unit quaternion and scale the leg into
  // nonsense rather than rotating it. lib/measure/gesture.ts rejects collinear gestures before
  // they ever commit, so this is belt-and-braces, but it fails to nothing instead of to noise.
  if (axis.lengthSq() === 0) return [];
  axis.normalize();

  const total = va.angleTo(vb);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const step = va.clone().applyAxisAngle(axis, (total * i) / ARC_SEGMENTS);
    points.push(step.multiplyScalar(radius).add(v));
  }
  return points;
}

function makeLine(points: THREE.Vector3[], material: THREE.Material): THREE.Line {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
  line.renderOrder = RENDER_ORDER;
  return line;
}

/** A measurement whose points did not come from this surface cannot be drawn in it. */
function is3D(m: { points: number[][] }): boolean {
  return m.points.every((p) => p.length >= 3);
}

/**
 * The in-progress gesture's objects, with their geometries and materials listed separately so
 * disposal does not have to reach back through three's loose `Object3D.material` typing.
 */
interface PendingParts {
  objects: THREE.Object3D[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

interface MeasureEntry {
  id: string;
  lines: THREE.Line[];
  /** The line materials, held apart so the selected colour can be swapped without a rebuild. */
  materials: THREE.LineBasicMaterial[];
  /** Null when there is no reading to show yet — an uncalibrated file's linear measurement. */
  texture: THREE.CanvasTexture | null;
  anchor: THREE.Vector3;
}

interface MeasureLayerProps {
  measurements: Measurement[];
  pending: PendingGesture | null;
  /** Null when the file has no usable scale; the reading is then left blank until it calibrates. */
  mmPerUnit: number | null;
  unit: LengthUnit;
  selectedId: string | null;
  onSelect?: (id: string | null) => void;
  /**
   * ApplyCrossSection's live plane array, so a measurement clips with the model it belongs to.
   *
   * The REF and not the array, deliberately. ApplyCrossSection reassigns `planesRef.current`
   * from a passive effect, and nothing re-renders ModelViewerInner when it does — so a plain
   * `THREE.Plane[]` prop read at render time would go stale the moment a slot starts or stops
   * cutting, and the measurement would keep drawing through a cut it should have been clipped
   * by. Same reason SectionCaps tracks it by identity in its own frame loop.
   */
  clipPlanesRef: React.MutableRefObject<THREE.Plane[]>;
  /** The model's bounding radius — scene scale for the dash length and the line-pick threshold. */
  radius: number;
}

export default function MeasureLayer({
  measurements,
  pending,
  mmPerUnit,
  unit,
  selectedId,
  onSelect,
  clipPlanesRef,
  radius,
}: MeasureLayerProps) {
  const sprites = useRef(new Map<string, THREE.Sprite>());
  const worldAnchor = useRef(new THREE.Vector3());

  // three's line-raycast threshold defaults to 1 WORLD unit (Raycaster.js), which is only ever
  // right by accident: bounding radii in this app span 1 to 10,000 (see lib/sceneScale.ts), so on
  // most models it is either a sub-pixel target or a house-sized one. Scaling it to the model
  // keeps a measurement's THREE.Line pickable regardless of scene scale — which matters doubly on
  // an uncalibrated file (OBJ/STL/PLY/3DS/DAE, where assumedMmPerUnit returns null), because the
  // label sprite that normally carries the click target isn't rendered at all (see `label` below),
  // leaving the line as the ONLY way to select and delete the measurement.
  //
  // This raycaster is shared with the rest of the viewer (part picks, pin drops), so the previous
  // value is restored on cleanup rather than left raised — and `Math.max` never LOWERS whatever
  // threshold another consumer already needs.
  const raycaster = useThree((s) => s.raycaster);
  useEffect(() => {
    const previous = raycaster.params.Line.threshold;
    raycaster.params.Line.threshold = Math.max(previous, radius * 5e-3);
    return () => {
      raycaster.params.Line.threshold = previous;
    };
  }, [raycaster, radius]);

  const entries = useMemo<MeasureEntry[]>(() => {
    const label = (m: Measurement): string => {
      if (m.kind === 'angular') return formatAngle(angleAt(m.points[1], m.points[0], m.points[2]));
      // No scale, no number. A blank pill would claim a reading exists; showing none says the
      // file has not been calibrated yet, which is what the toolbar's units chip also reports.
      if (mmPerUnit === null) return '';
      return formatLength(distance(m.points[0], m.points[1]) * mmPerUnit, unit);
    };

    return measurements.filter(is3D).map((m) => {
      const materials: THREE.LineBasicMaterial[] = [];
      const lines: THREE.Line[] = [];

      // depthWrite paired with depthTest: false, matching the sprite material below. An overlay
      // that skips the depth TEST but still WRITES depth would stamp far-side depth values into
      // the buffer — and three draws the whole transparent queue after the whole opaque queue
      // regardless of renderOrder, so that interaction with SceneGround's transparent disc and
      // ContactShadows is not something reading the code alone can predict. Depth-write-off is
      // the standard pairing for a CAD-style overlay that must always read on top.
      const legMaterial = new THREE.LineBasicMaterial({
        color: LINE_COLOR,
        depthTest: false,
        depthWrite: false,
      });
      materials.push(legMaterial);
      lines.push(makeLine(toVectors(m.points), legMaterial));

      if (m.kind === 'angular') {
        const arc = arcPoints(m.points[1], m.points[0], m.points[2]);
        if (arc.length > 0) {
          const arcMaterial = new THREE.LineBasicMaterial({
            color: LINE_COLOR,
            depthTest: false,
            depthWrite: false,
          });
          materials.push(arcMaterial);
          lines.push(makeLine(arc, arcMaterial));
        }
      }

      const text = label(m);
      return {
        id: m.id,
        lines,
        materials,
        texture: text === '' ? null : makeLabelTexture(text),
        anchor:
          m.kind === 'angular'
            ? new THREE.Vector3(m.points[1][0], m.points[1][1], m.points[1][2])
            : midpoint(m.points[0], m.points[1]),
      };
    });
    // `measurements` is replaced whole on every add and remove, and the label text is BAKED
    // into the texture — so the unit and the scale belong here too.
  }, [measurements, mmPerUnit, unit]);

  // The half-placed gesture: a dot per click so far, and a dashed line once there are two.
  // Without the dots the first click of a two-click linear gesture has no feedback at all.
  const pendingParts = useMemo<PendingParts>(() => {
    if (!pending || pending.points.length === 0 || !is3D(pending)) {
      return { objects: [], geometries: [], materials: [] };
    }
    const points = toVectors(pending.points);
    const parts: PendingParts = { objects: [], geometries: [], materials: [] };

    // sizeAttenuation false keeps the dot a fixed SCREEN size: geometry in this repo arrives
    // with no unit convention and bounding radii span 1 to 10,000 (see lib/sceneScale.ts), so
    // a world-sized dot would be a speck on one model and swallow another.
    const dotMaterial = new THREE.PointsMaterial({
      color: LINE_COLOR,
      size: PENDING_POINT_PX,
      sizeAttenuation: false,
      depthTest: false,
      // See the depthWrite comment on entries' legMaterial above — same overlay pairing.
      depthWrite: false,
    });
    const dots = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(points),
      dotMaterial,
    );
    dots.renderOrder = RENDER_ORDER;
    parts.objects.push(dots);
    parts.geometries.push(dots.geometry);
    parts.materials.push(dotMaterial);

    if (points.length > 1) {
      const dashMaterial = new THREE.LineDashedMaterial({
        color: LINE_COLOR,
        // Dash and gap are WORLD lengths, so they have to be scaled to the model or they are
        // either invisible or one solid line.
        dashSize: radius * PENDING_DASH_FRACTION,
        gapSize: radius * PENDING_GAP_FRACTION,
        depthTest: false,
        // See the depthWrite comment on entries' legMaterial above — same overlay pairing.
        depthWrite: false,
      });
      const line = makeLine(points, dashMaterial);
      // LineDashedMaterial reads a per-vertex `lineDistance` attribute that only this call
      // writes. Without it the line renders perfectly solid, with no error anywhere.
      line.computeLineDistances();
      parts.objects.push(line);
      parts.geometries.push(line.geometry);
      parts.materials.push(dashMaterial);
    }

    return parts;
  }, [pending, radius]);

  // Every material this layer owns, for the clipping-plane binding in the frame loop below.
  const materials = useMemo(
    () => [...entries.flatMap((entry) => entry.materials), ...pendingParts.materials],
    [entries, pendingParts],
  );

  // three holds no reference to a disposed geometry/material/texture, and R3F only disposes
  // what IT created — everything above is built by hand, so it is freed by hand.
  //
  // One effect per memo, each depending on THAT memo alone. Do not merge them: a click on a
  // half-placed gesture replaces `pendingParts` while `entries` keeps its identity, and a
  // combined effect would then re-run and free the live geometry of every committed
  // measurement on screen — which React would never remount, because its props never changed.
  useEffect(
    () => () => {
      for (const entry of entries) {
        for (const line of entry.lines) line.geometry.dispose();
        for (const material of entry.materials) material.dispose();
        entry.texture?.dispose();
      }
    },
    [entries],
  );

  useEffect(
    () => () => {
      for (const geometry of pendingParts.geometries) geometry.dispose();
      for (const material of pendingParts.materials) material.dispose();
    },
    [pendingParts],
  );

  useEffect(() => {
    for (const entry of entries) {
      const color = entry.id === selectedId ? SELECTED_COLOR : LINE_COLOR;
      for (const material of entry.materials) material.color.set(color);
    }
  }, [entries, selectedId]);

  // Identity of the plane array and of the material list last bound together. Rebinding only
  // when one of them changes matters twice over: lib/threeMaterials.ts's setClippingPlanes
  // documents that changing the NUMBER of clipping planes on a material recompiles its shader,
  // and a fresh set of materials (a measurement added or removed) starts out bound to nothing.
  const boundPlanes = useRef<THREE.Plane[] | null>(null);
  const boundMaterials = useRef<THREE.Material[] | null>(null);

  useFrame(({ camera }) => {
    const planes = clipPlanesRef.current;
    if (planes !== boundPlanes.current || materials !== boundMaterials.current) {
      boundPlanes.current = planes;
      boundMaterials.current = materials;
      const value = planes.length > 0 ? planes : null;
      for (const material of materials) material.clippingPlanes = value;
    }

    // Sprites are scaled against camera distance every frame so a label neither shrinks to
    // nothing on a large model nor swallows a small one. The distance is taken from the
    // sprite's WORLD position rather than its stored anchor: the anchor is in the model's
    // frame, which is displaced from the world by whatever placement the object carries.
    for (const entry of entries) {
      const sprite = sprites.current.get(entry.id);
      const image = entry.texture?.image as HTMLCanvasElement | undefined;
      if (!sprite || !image) continue;
      sprite.getWorldPosition(worldAnchor.current);
      const height = camera.position.distanceTo(worldAnchor.current) * LABEL_WORLD_HEIGHT_FRACTION;
      sprite.scale.set((height * image.width) / image.height, height, 1);
    }
  });

  return (
    <group>
      {entries.map((entry) => (
        <group
          key={entry.id}
          onClick={(e) => {
            e.stopPropagation();
            // R3F's own delta<=2 drag-vs-click check (see events-*.esm.js) is applied ONLY on
            // the onPointerMissed path, not to an object's onClick like this one — and
            // camera-controls deliberately never calls preventDefault() on pointerdown, so a
            // left-drag orbit that starts and ends over this measurement would otherwise select
            // it every time. Same reasoning as the model's onClick guard in
            // ModelViewerInner.tsx. `e.delta` is R3F's accumulated pointer-move distance for the
            // click; 2 is the same threshold R3F applies itself.
            if (e.delta > 2) return;
            onSelect?.(entry.id);
          }}
        >
          {entry.lines.map((line, i) => (
            <primitive key={i} object={line} />
          ))}
          {entry.texture && (
            <sprite
              ref={(sprite: THREE.Sprite | null) => {
                if (sprite) sprites.current.set(entry.id, sprite);
                else sprites.current.delete(entry.id);
              }}
              position={entry.anchor}
              renderOrder={RENDER_ORDER}
            >
              {/* Deliberately unclipped, unlike the lines: a cross-section should hide the part
                  of a dimension that runs through cut-away geometry, not the reading itself. */}
              <spriteMaterial map={entry.texture} depthTest={false} depthWrite={false} transparent />
            </sprite>
          )}
        </group>
      ))}
      {pendingParts.objects.map((object, i) => (
        <primitive key={i} object={object} />
      ))}
    </group>
  );
}
