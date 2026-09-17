import { distance, angleAt } from './geometry.ts';
import { UNPAGED } from './calibration.ts';

/**
 * Click-counting for the two measurement gestures, and the rules for throwing one away.
 *
 * Lives here rather than in each surface so "three clicks makes an angle" is one tested fact
 * instead of three implementations that drift. Every function is pure: `addPoint` returns a new
 * gesture rather than mutating the one it was given, so a rejected click leaves the caller's
 * state exactly as it was.
 */

export type MeasureKind = 'linear' | 'angular';

export interface PendingGesture {
  kind: MeasureKind;
  points: number[][];
  page: number;
}

export interface MeasurementDraft {
  kind: MeasureKind;
  points: number[][];
  page: number;
}

export type GestureResult =
  | { status: 'pending'; gesture: PendingGesture }
  | { status: 'committed'; measurement: MeasurementDraft }
  | { status: 'rejected'; reason: 'degenerate' };

/** How close to 0 or π an angle may come before the three clicks read as a misclick. */
const COLLINEAR_TOLERANCE = 1e-3;

export function pointsNeeded(kind: MeasureKind): number {
  return kind === 'linear' ? 2 : 3;
}

export function beginGesture(kind: MeasureKind, page: number = UNPAGED): PendingGesture {
  return { kind, points: [], page };
}

/**
 * Add a click.
 *
 * `minSeparation` is in the SURFACE's own units, which is why it is a parameter rather than a
 * constant: 3 is the right floor in Konva stage pixels and meaningless in a 3D scene, where the
 * caller passes something derived from the model's bounding radius.
 */
export function addPoint(
  gesture: PendingGesture,
  point: number[],
  minSeparation: number,
): GestureResult {
  const points = [...gesture.points, [...point]];

  if (points.length < pointsNeeded(gesture.kind)) {
    return { status: 'pending', gesture: { ...gesture, points } };
  }

  if (gesture.kind === 'linear') {
    if (distance(points[0], points[1]) < minSeparation) {
      return { status: 'rejected', reason: 'degenerate' };
    }
  } else {
    // Stored leg, vertex, leg — the vertex is the middle click, which is where the arc goes.
    const [a, vertex, b] = points;
    if (distance(a, vertex) < minSeparation || distance(b, vertex) < minSeparation) {
      return { status: 'rejected', reason: 'degenerate' };
    }
    const angle = angleAt(vertex, a, b);
    const collinear =
      !Number.isFinite(angle) ||
      angle < COLLINEAR_TOLERANCE ||
      Math.PI - angle < COLLINEAR_TOLERANCE;
    if (collinear) return { status: 'rejected', reason: 'degenerate' };
  }

  return { status: 'committed', measurement: { kind: gesture.kind, points, page: gesture.page } };
}
