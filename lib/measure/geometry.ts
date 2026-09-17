/**
 * The two measurements the tool takes, over plain number arrays.
 *
 * Dimension-agnostic on purpose: the 2D surfaces pass [x, y] and the 3D viewer passes
 * [x, y, z], and there is no reason for two implementations of Pythagoras to exist and drift.
 */

export type Point = readonly number[];

export function distance(a: Point, b: Point): number {
  if (a.length !== b.length) {
    throw new RangeError(`Cannot measure between a ${a.length}D and a ${b.length}D point`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * The angle at `vertex`, between the rays to `a` and to `b`. Radians, in [0, π].
 *
 * NaN when either leg has zero length — there is no angle at a point that coincides with its
 * own vertex, and the caller must reject the gesture rather than render "NaN°".
 */
export function angleAt(vertex: Point, a: Point, b: Point): number {
  if (vertex.length !== a.length || vertex.length !== b.length) {
    throw new RangeError('Cannot measure an angle between points of different dimensions');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vertex.length; i++) {
    const va = a[i] - vertex[i];
    const vb = b[i] - vertex[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return NaN;

  // Clamp before acos. For genuinely collinear input the quotient can exceed 1 by one ulp,
  // and Math.acos(1.0000000000000002) is NaN — a blank label for a perfectly valid gesture.
  const cosine = Math.min(1, Math.max(-1, dot / denominator));
  return Math.acos(cosine);
}
