// lib/markup/eraseSweep.ts
// Dragging the eraser must delete everything the path crosses, but pointer events arrive
// once a frame — a quick flick can jump a hundred pixels between two of them, straight over
// an object. This fills the gap in with sample points to hit-test.

import type { Point } from './draft.ts';

export type { Point };

/** Roughly half the smallest object we care about hitting; small enough to never skip one.
 * Past MAX_ERASE_SAMPLES * ERASE_SAMPLE_SPACING (about 384px), the cap takes precedence and
 * gaps between samples grow without bound. */
export const ERASE_SAMPLE_SPACING = 6;

/** A backstop on a pathological jump (window resize, tab restore) — 64 hit tests is plenty.
 * Beyond MAX_ERASE_SAMPLES * ERASE_SAMPLE_SPACING, the spacing guarantee gives way to this cap. */
export const MAX_ERASE_SAMPLES = 64;

/**
 * Sample points from just after `from` up to and including `to`.
 *
 * `from` is excluded because it was hit-tested on the previous event. `to` is always the
 * final element, so the object directly under the cursor is always erased even when the
 * sample count is capped.
 */
export function sweepPoints(from: Point | null, to: Point, spacing: number = ERASE_SAMPLE_SPACING): Point[] {
  // Negated rather than `spacing <= 0`, so NaN falls back too: NaN fails every comparison,
  // and an unguarded NaN makes the step count NaN and returns nothing at all — silently
  // breaking the one guarantee above, that `to` is always sampled.
  if (!(spacing > 0)) spacing = ERASE_SAMPLE_SPACING;
  if (!from) return [to];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= spacing) return [to];
  const steps = Math.min(MAX_ERASE_SAMPLES, Math.ceil(distance / spacing));
  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    points.push({ x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps });
  }
  return points;
}
