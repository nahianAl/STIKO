'use client';

import { Line } from '@react-three/drei';
import { sceneScaleForRadius } from '@/lib/sceneScale';

// Muted and brand-tinted: hue-correct so the conventional X/Y/Z reading survives, but
// desaturated so they recede behind the model. Deliberately NOT the view gizmo's saturated
// triad — the gizmo is a foreground control, these are background reference.
const AXIS_X_COLOR = '#B5636B';
const AXIS_Y_COLOR = '#6E9178';
const AXIS_Z_COLOR = '#6B74A8';

// Screen pixels, courtesy of Line2 — scale independent by construction.
const AXIS_LINE_WIDTH = 1.5;

export default function SceneAxes({ radius, height }: { radius: number; height: number }) {
  const scale = sceneScaleForRadius(radius);

  // axesY is one step above the model's base; the ground and shadow sit below it, so the
  // lines are never drawn over. The ordering lives in sceneScale.ts so it is tested once.
  const y = scale.axesY;
  const half = scale.axisHalfLength;

  // A perfectly flat model has zero height, which would make the Y axis a zero-length line.
  // Fall back to a short stub so the vertical direction is still marked.
  const yAxisTop = height > 0 ? height : half / 2;

  return (
    <>
      <Line
        points={[
          [-half, y, 0],
          [half, y, 0],
        ]}
        color={AXIS_X_COLOR}
        lineWidth={AXIS_LINE_WIDTH}
      />
      <Line
        points={[
          [0, y, -half],
          [0, y, half],
        ]}
        color={AXIS_Z_COLOR}
        lineWidth={AXIS_LINE_WIDTH}
      />
      {/* Upward only, and only as tall as the model: a full-length vertical line reads as a
          pole skewering the object. */}
      <Line
        points={[
          [0, y, 0],
          [0, yAxisTop, 0],
        ]}
        color={AXIS_Y_COLOR}
        lineWidth={AXIS_LINE_WIDTH}
      />
    </>
  );
}
