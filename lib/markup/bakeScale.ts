// lib/markup/bakeScale.ts
// Folding a Transformer's scale into a markup object's own geometry.
//
// Konva's Transformer resizes a node by setting scaleX/scaleY. Left there, that scale stretches
// everything the node draws: the stroke gets thick on the stretched axis, a cloud's scallops
// flatten into ovals, an arrowhead skews. So for the stroked types the scale is folded into the
// geometry (box size or points) and reset to 1 — the shape is redrawn at its new size rather
// than stretched to it. Text has its own folding; an image is meant to stretch.
//
// Pure arithmetic, no React and no '@/' imports: unit-tested by `node --test`.

import type { AnnotationObjectType } from '../../components/markup/useAnnotationObjects.ts';

export const BAKED_TYPES: ReadonlySet<AnnotationObjectType> = new Set<AnnotationObjectType>([
  'freehand', 'highlight', 'line', 'arrow', 'rect', 'ellipse', 'cloud',
]);

/** A flat [x, y, ...] list with x multiplied by `sx` and y by `sy`. */
export function scalePoints(points: number[], sx: number, sy: number): number[] {
  return points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy));
}

/**
 * A box with possibly negative extents (a handle dragged through the opposite side flips it)
 * rewritten with positive extents and the origin moved so it covers the same place on screen.
 * The origin moves along the node's ROTATED axes, because that is the space the extents are in.
 */
export function normalizeBox(b: { x: number; y: number; width: number; height: number; rotation: number }): {
  x: number; y: number; width: number; height: number;
} {
  const rad = (b.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let { x, y } = b;
  if (b.width < 0) {
    x += b.width * cos;
    y += b.width * sin;
  }
  if (b.height < 0) {
    x += -b.height * sin;
    y += b.height * cos;
  }
  return { x, y, width: Math.abs(b.width), height: Math.abs(b.height) };
}
