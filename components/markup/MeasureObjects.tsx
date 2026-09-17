'use client';

import { Line, Text, Circle, Group, Label, Tag } from 'react-konva';
import { distance, angleAt } from '@/lib/measure/geometry';
import { formatLength, formatAngle, type LengthUnit } from '@/lib/measure/units';
import { readableTextOn } from '@/lib/markup/colors';
import type { Measurement } from './useMeasurements';
import type { PendingGesture } from '@/lib/measure/gesture';

/**
 * Measurements on a Konva surface, shared by the PDF viewer and the image annotation canvas.
 *
 * Points arrive in STAGE coordinates and are rendered in stage coordinates; only the LENGTH is
 * converted. Two uniform scales stand between a stage pixel and a millimetre —
 * `intrinsicPerStagePixel` (stage px to the file's own unit) and `mmPerIntrinsicUnit` (that unit
 * to millimetres) — and separating them is what keeps calibration storable in file-intrinsic
 * units while the drawing stays in whatever space the surface happens to use.
 *
 * Deliberately NOT part of the annotation object model: measurements carry colour (stamped from
 * the toolbar's colour at the moment they were placed) but NOT stroke width — a width is part
 * of a drawing, whereas a dimension is chrome that has to stay legible at any zoom — so they
 * must never reach the markup style picker, and the eraser must not sweep them away mid-review.
 * The host renders this in its own layer and decides when that layer is hit-testable at all —
 * see the `listening` prop at the PDF call site.
 */

/** Sampling of the arc drawn between the two legs of an angle. */
const ARC_SEGMENTS = 32;
/** Arc radius as a fraction of the shorter leg — a WHOLE-drawing fraction, never a screen one. */
const ARC_LEG_FRACTION = 0.28;

export interface MeasureObjectsProps {
  measurements: Measurement[];
  pending: PendingGesture | null;
  /**
   * The cursor, in STAGE space, while a gesture is pending — drawn as a provisional last point
   * so the line and its running value follow the pointer between clicks. Null before the first
   * pointermove of a gesture, and on a host that reports no hover at all, in which case the
   * placed clicks still render on their own.
   */
  hoverPoint: number[] | null;
  /**
   * The toolbar's LIVE colour, for the in-progress gesture only.
   *
   * A separate prop rather than `Measurement.color` because the gesture has not committed yet,
   * so there is no measurement to read a colour off. It has to be the same colour the commit
   * will stamp on (see the portal's `handleMeasurePoint`, which passes the same value): a
   * preview drawn in a different ink from the dimension it is about to become makes the whole
   * thing flicker at the moment of the click.
   */
  previewColor: string;
  /** Null when uncalibrated: angular still renders, linear shows no number. */
  mmPerIntrinsicUnit: number | null;
  intrinsicPerStagePixel: number;
  unit: LengthUnit;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Only measurements on this page render. Pass 0 (UNPAGED) for surfaces without pages. */
  page: number;
  /**
   * The colour drawn UNDER a selected measurement, wider than the stroke, so selection reads
   * against any measurement colour on any background.
   *
   * A fixed highlight colour is no longer possible: the old #5B60FF is now a colour the user
   * can pick from the swatch row, and a purple dimension would look identical selected and not.
   * The value is the host stage's own matte — PDF_MATTE or CANVAS_MATTE — because "the
   * background" genuinely differs per surface.
   */
  haloColor: string;
  /**
   * The host stage's zoom, so lines, dots and labels keep a constant SCREEN size.
   *
   * Not cosmetic. Everything here is drawn in stage space, and a fitted A1 sheet sits at a
   * stage scale near 0.2 — at which a 14px label is three screen pixels tall and a 2px line is
   * a hairline. The comment pins in PDFKonvaViewer divide by the same number for the same
   * reason, and the 3D MeasureLayer re-scales its label sprites against the camera every frame.
   * Measurements are viewer chrome, unlike markup, whose widths are part of the drawing.
   *
   * Defaults to 1 for a surface that does not zoom.
   */
  screenScale?: number;
}

/** The arc between the two legs of an angle, sampled the short way around. */
function arcPoints(vertex: number[], a: number[], b: number[]): number[] {
  const radius =
    Math.min(distance(vertex, a), distance(vertex, b)) * ARC_LEG_FRACTION;
  if (!(radius > 0)) return [];

  const from = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
  const to = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]);
  // Wrap into (-π, π] so the arc sweeps the angle that is actually being measured rather than
  // the reflex one: atan2 returns per-ray angles, and their raw difference can be up to 2π.
  let sweep = to - from;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const flat: number[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const angle = from + (sweep * i) / ARC_SEGMENTS;
    flat.push(vertex[0] + Math.cos(angle) * radius, vertex[1] + Math.sin(angle) * radius);
  }
  return flat;
}

export default function MeasureObjects({
  measurements,
  pending,
  hoverPoint,
  previewColor,
  mmPerIntrinsicUnit,
  intrinsicPerStagePixel,
  unit,
  selectedId,
  onSelect,
  page,
  haloColor,
  screenScale = 1,
}: MeasureObjectsProps) {
  // Stage units for a size meant to be read in screen pixels.
  const px = (value: number) => value / (screenScale > 0 ? screenScale : 1);

  /**
   * A linear reading for two points in STAGE space.
   *
   * Extracted so the in-progress preview below and the committed measurements above run the
   * SAME conversion chain rather than two copies of it. The running value the user watches has
   * to be the value the commit keeps, and a second copy of `stage px -> intrinsic -> mm` is
   * exactly how the two would drift.
   */
  const lengthLabel = (a: number[], b: number[]): string => {
    // No scale, no number. A wrong reading is worse than none on a tool whose whole purpose is
    // to be trusted; the toolbar's units chip is what says the file is uncalibrated.
    if (mmPerIntrinsicUnit === null) return '';
    return formatLength(distance(a, b) * intrinsicPerStagePixel * mmPerIntrinsicUnit, unit);
  };

  const labelFor = (m: Measurement): string => {
    if (m.kind === 'angular') return formatAngle(angleAt(m.points[1], m.points[0], m.points[2]));
    return lengthLabel(m.points[0], m.points[1]);
  };

  /**
   * The reading's pill. One helper, used for both a committed measurement and the preview, so
   * the two are pixel-identical apart from the colour they are handed.
   *
   * A solid pill in the measurement's own colour, not a blur: a white glow behind `fill={color}`
   * text added nothing against white paper, and for the yellow swatch left the number at ~1.5:1
   * contrast — effectively invisible. Text colour is picked by luminance (readableTextOn) so
   * every swatch, including yellow and black, clears 4.5:1. `listening={false}` on the Label
   * keeps the whole pill (Tag AND Text — listening cascades to children in Konva) out of the hit
   * graph, so it cannot change what a click or an erase sweep finds; the leg's `hitStrokeWidth`
   * below remains the only hit target.
   */
  const pill = (anchor: number[], text: string, color: string) => (
    <Label x={anchor[0] + px(8)} y={anchor[1] - px(20)} listening={false}>
      <Tag fill={color} cornerRadius={px(4)} />
      <Text
        text={text}
        fontSize={px(14)}
        fontFamily="system-ui, sans-serif"
        fontStyle="600"
        fill={readableTextOn(color)}
        padding={px(6)}
      />
    </Label>
  );

  return (
    <>
      {measurements
        .filter((m) => m.page === page)
        .map((m) => {
          const color = m.color;
          const selected = m.id === selectedId;
          const flat = m.points.flat();
          const arc = m.kind === 'angular'
            ? arcPoints(m.points[1], m.points[0], m.points[2])
            : [];
          const anchor = m.kind === 'angular'
            ? m.points[1]
            : [(m.points[0][0] + m.points[1][0]) / 2, (m.points[0][1] + m.points[1][1]) / 2];
          const text = labelFor(m);
          return (
            <Group key={m.id} id={m.id} onClick={() => onSelect(m.id)} onTap={() => onSelect(m.id)}>
              {selected && (
                <Line
                  points={flat}
                  stroke={haloColor}
                  strokeWidth={px(7)}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              )}
              <Line
                points={flat}
                stroke={color}
                strokeWidth={px(selected ? 3.5 : 2)}
                lineCap="round"
                lineJoin="round"
                // A 2px line at a fitted sheet's zoom is a sub-pixel click target, and on an
                // uncalibrated file the label is blank — so the line is the only way to select
                // a measurement in order to delete it.
                hitStrokeWidth={px(14)}
              />
              {arc.length > 0 && (
                <>
                  {selected && (
                    <Line
                      points={arc}
                      stroke={haloColor}
                      strokeWidth={px(7)}
                      lineCap="round"
                      lineJoin="round"
                      listening={false}
                    />
                  )}
                  <Line points={arc} stroke={color} strokeWidth={px(selected ? 2 : 1.5)} />
                </>
              )}
              {m.points.map((p, i) => (
                <Circle key={i} x={p[0]} y={p[1]} radius={px(3.5)} fill={color} />
              ))}
              {text !== '' && pill(anchor, text, color)}
            </Group>
          );
        })}

      {pending && pending.page === page && pending.points.length > 0 && (() => {
        // The clicks placed so far plus the cursor as a PROVISIONAL last point. `hoverPoint` is
        // null between the click that restarts a gesture and the next pointermove, so the placed
        // clicks have to render on their own too — which is also the whole behaviour on a host
        // that reports no hover.
        const preview = hoverPoint ? [...pending.points, hoverPoint] : pending.points;
        // The reading follows the gesture's KIND, not merely how many points happen to exist —
        // `pending.points.length` alone can't tell a half-placed angle (one point + hover, which
        // is also 2 points) from a length (one point + hover). A linear/calibrate gesture reaches
        // 2 points at most before it commits; an angular one reaches 3. See PendingGesture.
        const isAngular = pending.kind === 'angular';
        // Linear/calibrate: a reading once the second (provisional) point exists.
        // Angular: no reading until the THIRD point exists — a length here would describe a
        // distance the gesture is not measuring and would pop to an angle the instant the vertex
        // lands. Nothing (dashed leg + dots) is shown for the one-point-plus-hover case instead.
        const value = isAngular
          ? preview.length === 3
            ? formatAngle(angleAt(preview[1], preview[0], preview[2]))
            : ''
          : preview.length === 2
            ? lengthLabel(preview[0], preview[1])
            : '';
        // The arc appears exactly when the angle does, built with the SAME arcPoints() the
        // committed entries use, so the arc that shows at commit was already on screen.
        const arc = isAngular && preview.length === 3
          ? arcPoints(preview[1], preview[0], preview[2])
          : [];
        // The SAME anchor rule the committed measurements above use — the vertex for an angle,
        // the midpoint for a length — so the pill does not jump across the drawing at the instant
        // the gesture commits. The colour is the toolbar's live colour for the same reason.
        // (Only meaningful when `value !== ''`, i.e. the pill actually renders — otherwise a
        // shorter `preview` can leave the other branch's index past the end.)
        const last = preview[preview.length - 1];
        const anchor = isAngular
          ? preview[1]
          : [(preview[0][0] + last[0]) / 2, (preview[0][1] + last[1]) / 2];
        return (
          <Group listening={false}>
            {preview.length > 1 && (
              <Line
                points={preview.flat()}
                stroke={previewColor}
                strokeWidth={px(1.5)}
                dash={[px(6), px(4)]}
                lineCap="round"
                lineJoin="round"
              />
            )}
            {arc.length > 0 && (
              <Line points={arc} stroke={previewColor} strokeWidth={px(1.5)} />
            )}
            {/* Every preview point, the hovered one included — not just the placed clicks. The
                dots are not decoration: without them the first click of a two-click linear
                gesture has no feedback at all, and a three-click angular gesture none until the
                second. Drawing one at the hover point too is what makes a snapped position
                visible BEFORE it is committed, which is the only way to see that the click will
                not land under the cursor. Same reasoning as the 3D MeasureLayer's pending
                points. */}
            {preview.map((p, i) => (
              <Circle key={i} x={p[0]} y={p[1]} radius={px(3.5)} fill={previewColor} />
            ))}
            {value !== '' && pill(anchor, value, previewColor)}
          </Group>
        );
      })()}
    </>
  );
}
