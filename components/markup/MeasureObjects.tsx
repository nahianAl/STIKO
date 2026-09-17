'use client';

import { Line, Text, Circle, Group } from 'react-konva';
import { distance, angleAt } from '@/lib/measure/geometry';
import { formatLength, formatAngle, type LengthUnit } from '@/lib/measure/units';
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

/**
 * The in-progress gesture's click dots and dashed leg have not committed yet, so there is no
 * `Measurement.color` to draw them in. Tinting that preview to the toolbar's live colour is a
 * later refinement (the hover-preview task); until then this stays the same fixed ink the
 * whole tool used to draw in.
 */
const PENDING_STROKE = '#1C2030';

export interface MeasureObjectsProps {
  measurements: Measurement[];
  pending: PendingGesture | null;
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

  const labelFor = (m: Measurement): string => {
    if (m.kind === 'angular') return formatAngle(angleAt(m.points[1], m.points[0], m.points[2]));
    // No scale, no number. A wrong reading is worse than none on a tool whose whole purpose is
    // to be trusted; the toolbar's units chip is what says the file is uncalibrated.
    if (mmPerIntrinsicUnit === null) return '';
    const stagePx = distance(m.points[0], m.points[1]);
    return formatLength(stagePx * intrinsicPerStagePixel * mmPerIntrinsicUnit, unit);
  };

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
                    <Line points={arc} stroke={haloColor} strokeWidth={px(7)} listening={false} />
                  )}
                  <Line points={arc} stroke={color} strokeWidth={px(selected ? 2 : 1.5)} />
                </>
              )}
              {m.points.map((p, i) => (
                <Circle key={i} x={p[0]} y={p[1]} radius={px(3.5)} fill={color} />
              ))}
              <Text
                x={anchor[0] + px(8)}
                y={anchor[1] - px(20)}
                text={labelFor(m)}
                fontSize={px(14)}
                fontFamily="system-ui, sans-serif"
                fontStyle="600"
                // The measurement's own colour, matching the line, arc and dots: a number left
                // in a fixed ink beside a colourful line would read as a different object.
                fill={color}
                // A white plate behind the number, so a dimension stays readable over dark
                // drawing content instead of disappearing into it.
                shadowColor="#FFFFFF"
                shadowBlur={px(6)}
                shadowOpacity={1}
              />
            </Group>
          );
        })}

      {pending && pending.page === page && pending.points.length > 0 && (
        <Group listening={false}>
          {/* The dots are not decoration: without them the first click of a two-click linear
              gesture has no feedback at all, and a three-click angular gesture none until the
              second. Same reasoning as the 3D MeasureLayer's pending points. */}
          {pending.points.map((p, i) => (
            <Circle key={i} x={p[0]} y={p[1]} radius={px(3.5)} fill={PENDING_STROKE} />
          ))}
          {pending.points.length > 1 && (
            <Line
              points={pending.points.flat()}
              stroke={PENDING_STROKE}
              strokeWidth={px(1.5)}
              dash={[px(6), px(4)]}
            />
          )}
        </Group>
      )}
    </>
  );
}
