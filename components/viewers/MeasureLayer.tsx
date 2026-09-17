'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { distance, angleAt } from '@/lib/measure/geometry';
import { formatLength, formatAngle, type LengthUnit } from '@/lib/measure/units';
import { readableTextOn } from '@/lib/markup/colors';
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

const ARC_SEGMENTS = 32;

/**
 * Drawn last, over the model. Set on every object individually and NOT on the wrapping group:
 * three's renderOrder is per object and a group's value is not inherited by its children, so a
 * single value on the group would leave every line and label sorting at the default 0.
 */
const RENDER_ORDER = 999;

/** Label sprites are sized against the camera each frame so text stays legible at any zoom. */
const LABEL_WORLD_HEIGHT_FRACTION = 0.035;

/**
 * Screen size of an endpoint dot: the half-placed gesture's clicks so far, and — doubled when
 * selected — every committed measurement's own endpoints (see `entries` below). Shared between
 * the two because a committed measurement's dots are built the same way the pending gesture's
 * are; see the `points` field on `MeasureEntry`.
 */
const POINT_PX = 9;

/** Dash and gap of the in-progress line, as a fraction of the model's bounding radius. */
const PENDING_DASH_FRACTION = 0.02;
const PENDING_GAP_FRACTION = 0.012;

/**
 * Always a solid pill filled with the measurement's own colour, text picked by luminance
 * (readableTextOn) rather than a fixed white — the same fix as the Konva surfaces'
 * MeasureObjects. This used to invert on selection (white pill / coloured text, unselected;
 * coloured pill / white text, selected), which meant a yellow measurement went from a faint
 * ~1.5:1 reading to a solid yellow pill with white text at the SAME ~1.5:1 — selecting it
 * destroyed the reading instead of emphasising it, at every swatch light enough for white text
 * to fail. Selection no longer needs the label at all: the endpoint `points` built in `entries`
 * below double in size when selected, which is the reliable signal, so the pill stays one fixed,
 * always-readable look regardless of `selected`.
 */
function drawLabel(canvas: HTMLCanvasElement, text: string, color: string): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

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

  const textColor = readableTextOn(color);

  // Inset by half the stroke width: a rect at 0,0 would have the outer half of its border
  // clipped off by the canvas edge on all four sides.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height - 2, 14);
  ctx.fill();
  ctx.strokeStyle = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.5)' : 'rgba(28,32,48,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = font;
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding, height / 2);

  return true;
}

/** Shared by the committed labels and by the ONE reused preview label — see `previewLabel`. */
function tuneLabelTexture(texture: THREE.CanvasTexture): THREE.CanvasTexture {
  // The canvas holds sRGB colours. Without this three takes them for linear data and the pill
  // renders noticeably washed out against everything else in the scene.
  texture.colorSpace = THREE.SRGBColorSpace;
  // A label is only ever drawn at roughly its own size; mipmaps would cost memory to blur it.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

/**
 * A texture of its own per call, for a label whose text never changes again. The live preview
 * does NOT use this — see `previewLabel` for why a per-change allocation is wrong there.
 */
function makeLabelTexture(text: string, color: string): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  if (!drawLabel(canvas, text, color)) return null;
  return tuneLabelTexture(new THREE.CanvasTexture(canvas));
}

/**
 * A linear reading in the display unit.
 *
 * One function for the committed entries and for the live preview, so the running value the user
 * watches between clicks is literally the value the commit keeps rather than a second copy of
 * the same arithmetic that could drift from it.
 */
function lengthLabel(a: number[], b: number[], mmPerUnit: number | null, unit: LengthUnit): string {
  // No scale, no number. A blank pill would claim a reading exists; showing none says the file
  // has not been calibrated yet, which is what the toolbar's units chip also reports.
  if (mmPerUnit === null) return '';
  return formatLength(distance(a, b) * mmPerUnit, unit);
}

/**
 * Sizes a label sprite against the camera so text neither shrinks to nothing on a large model
 * nor swallows a small one. The distance is taken from the sprite's WORLD position rather than
 * from its stored anchor: the anchor is in the model's frame, which is displaced from the world
 * by whatever placement the object carries.
 */
function scaleLabelSprite(
  sprite: THREE.Sprite,
  width: number,
  height: number,
  camera: THREE.Camera,
  scratch: THREE.Vector3,
): void {
  if (!(width > 0) || !(height > 0)) return;
  sprite.getWorldPosition(scratch);
  const worldHeight = camera.position.distanceTo(scratch) * LABEL_WORLD_HEIGHT_FRACTION;
  sprite.scale.set((worldHeight * width) / height, worldHeight, 1);
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
 * The in-progress gesture's objects, with their geometries listed separately so disposal does
 * not have to reach back through three's loose `Object3D.material` typing.
 *
 * No materials here, unlike the committed `MeasureEntry` below: the preview's geometry is
 * rebuilt on every pointermove while its materials are not — see `pendingMaterials`.
 */
interface PendingParts {
  objects: THREE.Object3D[];
  geometries: THREE.BufferGeometry[];
}

interface MeasureEntry {
  id: string;
  lines: THREE.Line[];
  /**
   * Every material this entry owns — leg/arc lines plus the endpoint `points` below — held
   * apart from the objects that use them so the frame loop's clipping-plane binding below can
   * reach every material without walking three's loosely-typed `Object3D.material`.
   */
  materials: THREE.Material[];
  /**
   * Endpoint dots, built the same way the pending gesture's own dots are (see `pendingParts`
   * below) — same `sizeAttenuation: false`/`depthTest: false`/`depthWrite: false` overlay
   * pairing, same `renderOrder`. Coloured with the measurement's own colour and sized at
   * `POINT_PX`, doubled when selected.
   *
   * This is the reliable half of the selection signal: `PointsMaterial.size`, unlike
   * `LineBasicMaterial.linewidth` on the leg/arc above, is honoured on every platform. That
   * matters most for an uncalibrated linear 3D measurement (OBJ/STL/PLY/3DS/DAE, where
   * `assumedMmPerUnit` returns null): it has no label (`texture` below is null), so the dots and
   * the weaker linewidth toggle are the only signals selection has left.
   */
  points: THREE.Points;
  /** Null when there is no reading to show yet — an uncalibrated file's linear measurement. */
  texture: THREE.CanvasTexture | null;
  anchor: THREE.Vector3;
}

interface MeasureLayerProps {
  measurements: Measurement[];
  pending: PendingGesture | null;
  /**
   * The cursor, in the MODEL's own frame, while a gesture is pending — drawn as a provisional
   * last point so the dashed leg and its running value follow the pointer between clicks.
   *
   * Already snapped and already converted by the time it arrives: SceneInteraction resolves it
   * with the very same `pickModel` + `nearestVertexSnap` + `worldToModel` chain its pointerup
   * commits with, which is what stops the point from jumping at the instant it is clicked.
   * Null before the first pointermove of a gesture, in which case the placed clicks render alone.
   */
  hoverPoint: number[] | null;
  /**
   * The toolbar's LIVE colour, for the in-progress gesture only.
   *
   * A separate prop rather than `Measurement.color` because the gesture has not committed yet,
   * so there is no measurement to read a colour off. It must be the colour the commit will stamp
   * on (the portal passes the same `drawingColor` to both): a preview in a different ink from
   * the dimension it is about to become flickers at the moment of the click.
   */
  previewColor: string;
  /** Null when the file has no usable scale; the reading is then left blank until it calibrates. */
  mmPerUnit: number | null;
  unit: LengthUnit;
  selectedId: string | null;
  onSelect?: (id: string | null) => void;
  /**
   * Whether a measurement can be clicked to select it. Defaults to true.
   *
   * False whenever another tool owns the click, exactly like the PDF measure layer's
   * `listening` and like SectionPlaneWidget's own `selectable` below. With a measure tool armed
   * SceneInteraction's pointerup drops a gesture point from the same press, so a click that
   * lands on an existing dimension would both place a point AND select that dimension; with the
   * comment tool armed the same press drops a pin. Dropping the handler rather than ignoring it
   * inside also takes the whole group out of R3F's `internal.interaction` list (see applyProps
   * in events-*.esm.js: the object is re-added only when its eventCount is non-zero), so a
   * dimension cannot shield the model behind it from a pick either.
   */
  selectable?: boolean;
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
  hoverPoint,
  previewColor,
  mmPerUnit,
  unit,
  selectedId,
  onSelect,
  selectable = true,
  clipPlanesRef,
  radius,
}: MeasureLayerProps) {
  const sprites = useRef(new Map<string, THREE.Sprite>());
  const previewSprite = useRef<THREE.Sprite | null>(null);
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
    const label = (m: Measurement): string =>
      m.kind === 'angular'
        ? formatAngle(angleAt(m.points[1], m.points[0], m.points[2]))
        : lengthLabel(m.points[0], m.points[1], mmPerUnit, unit);

    return measurements.filter(is3D).map((m) => {
      const selected = m.id === selectedId;
      const materials: THREE.Material[] = [];
      const lines: THREE.Line[] = [];

      // depthWrite paired with depthTest: false, matching the sprite material below. An overlay
      // that skips the depth TEST but still WRITES depth would stamp far-side depth values into
      // the buffer — and three draws the whole transparent queue after the whole opaque queue
      // regardless of renderOrder, so that interaction with SceneGround's transparent disc and
      // ContactShadows is not something reading the code alone can predict. Depth-write-off is
      // the standard pairing for a CAD-style overlay that must always read on top.
      //
      // A 3D scene has no matte to halo against, so selection here is expressed on the objects
      // that already exist instead: the line gets the measurement's colour EITHER WAY, and a
      // selected entry's linewidth doubles — three ignores linewidth on most platforms, so this
      // is the weaker half of the signal. The endpoint `points` built below carry the reliable
      // half, via `PointsMaterial.size`, which three DOES honour everywhere.
      const legMaterial = new THREE.LineBasicMaterial({
        color: m.color,
        linewidth: selected ? 2 : 1,
        depthTest: false,
        depthWrite: false,
      });
      materials.push(legMaterial);
      lines.push(makeLine(toVectors(m.points), legMaterial));

      if (m.kind === 'angular') {
        const arc = arcPoints(m.points[1], m.points[0], m.points[2]);
        if (arc.length > 0) {
          const arcMaterial = new THREE.LineBasicMaterial({
            color: m.color,
            linewidth: selected ? 2 : 1,
            depthTest: false,
            depthWrite: false,
          });
          materials.push(arcMaterial);
          lines.push(makeLine(arc, arcMaterial));
        }
      }

      // Endpoint dots for the points actually measured — conventional on a dimension in its own
      // right, and (see the `points` field's doc comment on MeasureEntry) the one selection
      // signal guaranteed to read regardless of platform or whether this measurement has a
      // label. Built exactly like the pending gesture's own dots below: same
      // sizeAttenuation/depthTest/depthWrite overlay pairing, same renderOrder.
      const pointsMaterial = new THREE.PointsMaterial({
        color: m.color,
        size: selected ? POINT_PX * 2 : POINT_PX,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      });
      materials.push(pointsMaterial);
      const points = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(toVectors(m.points)),
        pointsMaterial,
      );
      points.renderOrder = RENDER_ORDER;

      const text = label(m);
      return {
        id: m.id,
        lines,
        materials,
        points,
        texture: text === '' ? null : makeLabelTexture(text, m.color),
        anchor:
          m.kind === 'angular'
            ? new THREE.Vector3(m.points[1][0], m.points[1][1], m.points[1][2])
            : midpoint(m.points[0], m.points[1]),
      };
    });
    // `measurements` is replaced whole on every add and remove, and the label text is BAKED
    // into the texture — so the unit and the scale belong here too. `selectedId` STAYS in this
    // list even though the label's fill/text colours no longer depend on it (see
    // `makeLabelTexture`'s doc comment) — `legMaterial`/`arcMaterial`'s `linewidth` and
    // `pointsMaterial`'s `size` above both still branch on `selected`, and all three are baked
    // into the material/geometry at construction rather than swapped after the fact, so a
    // selection change still has to rebuild the entry.
  }, [measurements, mmPerUnit, unit, selectedId]);

  /**
   * The half-placed gesture's points, with the cursor appended as a PROVISIONAL last one.
   *
   * Null when there is nothing to preview. `hoverPoint` is null between the click that restarts
   * a gesture and the next pointermove, so the placed clicks still have to render on their own.
   * Its length is checked the same way `is3D` checks a measurement's: the store is shared with
   * the two Konva surfaces, which feed it two-component stage points, and one of those reaching
   * `toVectors` here would silently become a point at z = undefined.
   */
  const preview = useMemo<number[][] | null>(() => {
    if (!pending || pending.points.length === 0 || !is3D(pending)) return null;
    if (!hoverPoint || hoverPoint.length < 3) return pending.points;
    return [...pending.points, hoverPoint];
  }, [pending, hoverPoint]);

  /**
   * The in-progress gesture's MATERIALS, held apart from its geometry below.
   *
   * Split deliberately, and this is the split that makes a live preview affordable. The preview's
   * POINTS change on every pointermove — dozens of times a second — while its materials depend
   * only on the toolbar colour and the model's scale. Built together, every mouse move would
   * allocate and immediately free two GPU-backed materials for no visual change; built apart, a
   * move rebuilds nothing but two small BufferGeometries. It also keeps the `materials` list
   * below stable across a move, so the frame loop's clipping-plane rebind does not re-fire
   * either.
   *
   * Allocated even when no gesture is pending. Two unused materials cost nothing — three compiles
   * a shader program only when a material is actually rendered — and the alternative is a
   * nullable memo whose disposal effect has more ways to be wrong than this has to be wasteful.
   */
  const pendingMaterials = useMemo(() => {
    // sizeAttenuation false keeps the dot a fixed SCREEN size: geometry in this repo arrives
    // with no unit convention and bounding radii span 1 to 10,000 (see lib/sceneScale.ts), so
    // a world-sized dot would be a speck on one model and swallow another.
    const dot = new THREE.PointsMaterial({
      color: previewColor,
      size: POINT_PX,
      sizeAttenuation: false,
      depthTest: false,
      // See the depthWrite comment on entries' legMaterial above — same overlay pairing.
      depthWrite: false,
    });
    const dash = new THREE.LineDashedMaterial({
      color: previewColor,
      // Dash and gap are WORLD lengths, so they have to be scaled to the model or they are
      // either invisible or one solid line.
      dashSize: radius * PENDING_DASH_FRACTION,
      gapSize: radius * PENDING_GAP_FRACTION,
      depthTest: false,
      // See the depthWrite comment on entries' legMaterial above — same overlay pairing.
      depthWrite: false,
    });
    // Solid, not dashed — matching a committed entry's arcMaterial, because this arc is the same
    // arc the entry keeps: the angle it draws is already final the moment the second leg exists,
    // unlike the still-moving legs the dashed material represents.
    const arc = new THREE.LineBasicMaterial({
      color: previewColor,
      depthTest: false,
      // See the depthWrite comment on entries' legMaterial above — same overlay pairing.
      depthWrite: false,
    });
    return { dot, dash, arc, all: [dot, dash, arc] as THREE.Material[] };
  }, [previewColor, radius]);

  // The half-placed gesture: a dot per preview point, a dashed line once there are two, and —
  // for an angular gesture with both legs placed — the arc between them. Without the dots the
  // first click of a two-click linear gesture has no feedback at all, and the dot on the HOVER
  // point is what makes a vertex snap visible before it is committed — the snapped position is
  // deliberately not under the cursor.
  const pendingParts = useMemo<PendingParts>(() => {
    if (!preview || !pending) return { objects: [], geometries: [] };
    const points = toVectors(preview);
    const parts: PendingParts = { objects: [], geometries: [] };

    const dots = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(points),
      pendingMaterials.dot,
    );
    dots.renderOrder = RENDER_ORDER;
    parts.objects.push(dots);
    parts.geometries.push(dots.geometry);

    if (points.length > 1) {
      const line = makeLine(points, pendingMaterials.dash);
      // LineDashedMaterial reads a per-vertex `lineDistance` attribute that only this call
      // writes. Without it the line renders perfectly solid, with no error anywhere.
      line.computeLineDistances();
      parts.objects.push(line);
      parts.geometries.push(line.geometry);
    }

    // Gated on KIND, not merely on `preview.length === 3`: that length only ever occurs for an
    // angular gesture (a linear one commits at 2 points, so its preview tops out at a placed
    // point plus the hover), but branching on kind says so rather than leaving it to be worked
    // out from `addPoint`'s point counts. Built with the SAME arcPoints() the committed entries
    // use (see `entries` above), so the arc the commit draws was already on screen.
    if (pending.kind === 'angular' && preview.length === 3) {
      const arc = arcPoints(preview[1], preview[0], preview[2]);
      if (arc.length > 0) {
        const arcLine = makeLine(arc, pendingMaterials.arc);
        parts.objects.push(arcLine);
        parts.geometries.push(arcLine.geometry);
      }
    }

    return parts;
  }, [preview, pending, pendingMaterials]);

  /**
   * The running reading, and where it hangs — following the gesture's KIND, not merely how many
   * points happen to exist. `preview.length === 2` is ambiguous on its own: it is both "linear,
   * one point placed plus the hover" (a real length) AND "angular, one point placed plus the
   * hover" (no angle yet — the vertex has not been placed). Reading `pending.kind` instead of
   * inferring from the count is what tells those apart; see `PendingGesture`.
   *
   * A linear/calibrate gesture never exceeds 2 preview points (it commits at 2 placed points).
   * An angular one shows nothing until the THIRD preview point exists — the two placed clicks
   * plus the hover — at which point it reads the angle at the middle one, which is where
   * `addPoint` puts the vertex. The anchor follows the SAME rule the committed entries use —
   * vertex for an angle, midpoint for a length — so the pill does not jump across the model at
   * the instant the gesture commits.
   */
  const previewText = useMemo(() => {
    if (!preview || !pending) return '';
    if (pending.kind === 'angular') {
      return preview.length === 3
        ? formatAngle(angleAt(preview[1], preview[0], preview[2]))
        : '';
    }
    return preview.length === 2 ? lengthLabel(preview[0], preview[1], mmPerUnit, unit) : '';
  }, [preview, pending, mmPerUnit, unit]);

  const previewAnchor = useMemo(() => {
    if (!preview || !pending) return null;
    if (pending.kind === 'angular') {
      return preview.length === 3
        ? new THREE.Vector3(preview[1][0], preview[1][1], preview[1][2])
        : null;
    }
    return preview.length === 2 ? midpoint(preview[0], preview[1]) : null;
  }, [preview, pending]);

  /**
   * ONE canvas and ONE texture for the whole life of this layer, repainted in place.
   *
   * A committed entry's text never changes, so `entries` can afford a CanvasTexture each. The
   * preview's text changes on essentially every pointermove, and a texture per change is a GPU
   * upload plus an allocation dozens of times a second — a fast leak, not a slow one, and one
   * that a matching dispose only converts into constant churn. So the pair is allocated once,
   * `drawLabel` repaints the canvas whenever the text or the colour changes, and `needsUpdate`
   * re-uploads it. The identity never changes, which also keeps the sprite's `map` prop stable.
   */
  const previewLabel = useMemo(
    () => {
      const canvas = document.createElement('canvas');
      return { canvas, texture: tuneLabelTexture(new THREE.CanvasTexture(canvas)) };
    },
    [],
  );

  // The one free matching the one allocation above. Keyed on the memo that made it, like every
  // other disposal effect here.
  useEffect(() => () => previewLabel.texture.dispose(), [previewLabel]);

  // Repaint, never reallocate — see previewLabel. Returns the SAME texture every time it has
  // something to show, so the sprite below never swaps its map.
  const previewTexture = useMemo(() => {
    if (previewText === '') return null;
    if (!drawLabel(previewLabel.canvas, previewText, previewColor)) return null;
    previewLabel.texture.needsUpdate = true;
    return previewLabel.texture;
  }, [previewText, previewColor, previewLabel]);

  // Every material this layer owns, for the clipping-plane binding in the frame loop below.
  const materials = useMemo(
    () => [...entries.flatMap((entry) => entry.materials), ...pendingMaterials.all],
    [entries, pendingMaterials],
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
        entry.points.geometry.dispose();
        for (const material of entry.materials) material.dispose();
        entry.texture?.dispose();
      }
    },
    [entries],
  );

  useEffect(
    () => () => {
      for (const geometry of pendingParts.geometries) geometry.dispose();
    },
    [pendingParts],
  );

  // The pending MATERIALS outlive the geometry that uses them — that is the whole point of the
  // split — so they need their own free, keyed on their own memo. Merged into the effect above
  // they would be disposed on every pointermove while the next frame was still drawing with
  // them; split off, they are freed only when the colour, the model scale or the layer changes.
  useEffect(
    () => () => {
      for (const material of pendingMaterials.all) material.dispose();
    },
    [pendingMaterials],
  );

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
    // nothing on a large model nor swallows a small one — see scaleLabelSprite.
    for (const entry of entries) {
      const sprite = sprites.current.get(entry.id);
      const image = entry.texture?.image as HTMLCanvasElement | undefined;
      if (!sprite || !image) continue;
      scaleLabelSprite(sprite, image.width, image.height, camera, worldAnchor.current);
    }

    // The live preview's label gets the same treatment, read off the reused canvas rather than
    // off a texture of its own. Skipped entirely when there is no reading to show.
    const sprite = previewSprite.current;
    if (sprite && previewTexture) {
      scaleLabelSprite(
        sprite,
        previewLabel.canvas.width,
        previewLabel.canvas.height,
        camera,
        worldAnchor.current,
      );
    }
  });

  return (
    <group>
      {entries.map((entry) => (
        <group
          key={entry.id}
          // No handler at all when another tool owns the click — see `selectable`. This is the
          // 3D equivalent of the PDF measure layer's `listening={activeTool === 'pointer'}`.
          onClick={!selectable ? undefined : (e) => {
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
          <primitive object={entry.points} />
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
      {previewTexture && previewAnchor && (
        <sprite
          ref={(sprite: THREE.Sprite | null) => {
            previewSprite.current = sprite;
          }}
          position={previewAnchor}
          renderOrder={RENDER_ORDER}
        >
          {/* Deliberately unclipped, exactly like a committed entry's label: a cross-section
              should hide the part of a dimension that runs through cut-away geometry, not the
              reading itself. */}
          <spriteMaterial map={previewTexture} depthTest={false} depthWrite={false} transparent />
        </sprite>
      )}
    </group>
  );
}
