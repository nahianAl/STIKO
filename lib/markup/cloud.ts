// lib/markup/cloud.ts
// The revision-cloud outline: a closed ring of outward scalloped arcs around a box.
//
// Emitted as data rather than drawn here, so the geometry can be unit-tested without a
// canvas. AnnotationObjects feeds these straight to ctx.arc in a Konva sceneFunc.

import { normalizedBox } from './draft.ts';

export interface CloudArc {
  cx: number;
  cy: number;
  r: number;
  /** Canvas angles, swept in increasing order (ctx.arc with counterclockwise = false). */
  start: number;
  end: number;
}

/** Below this a scallop stops reading as a bump and just thickens the line. */
export const MIN_SCALLOP_RADIUS = 4;

/** Sets the target scallop size: the short side of the box gets about this many bumps. */
export const SCALLOPS_PER_SHORT_SIDE = 4;

export function arcStart(a: CloudArc): { x: number; y: number } {
  return { x: a.cx + a.r * Math.cos(a.start), y: a.cy + a.r * Math.sin(a.start) };
}

export function arcEnd(a: CloudArc): { x: number; y: number } {
  return { x: a.cx + a.r * Math.cos(a.end), y: a.cy + a.r * Math.sin(a.end) };
}

/**
 * Arcs are emitted in perimeter order — top left-to-right, right top-to-bottom, bottom
 * right-to-left, left bottom-to-top — and each arc's end point is exactly the next one's
 * start point, so the implicit lineTo between consecutive ctx.arc calls is a zero-length
 * move rather than a chord slicing across the outline.
 *
 * Radius is solved per axis (r = side / 2n) rather than taken as a fixed target, so the
 * scallops divide each side exactly and the corners meet.
 *
 * `width` and `height` may be negative: a draft mid-drag is not normalised.
 */
export function cloudArcs(width: number, height: number): CloudArc[] {
  const box = normalizedBox(width, height);
  if (box.width <= 0 || box.height <= 0) return [];

  const target = Math.max(MIN_SCALLOP_RADIUS, Math.min(box.width, box.height) / (SCALLOPS_PER_SHORT_SIDE * 2));
  const countFor = (side: number) => Math.max(1, Math.round(side / (2 * target)));
  const nx = countFor(box.width);
  const ny = countFor(box.height);
  const rx = box.width / (2 * nx);
  const ry = box.height / (2 * ny);

  const { left, top } = box;
  const right = left + box.width;
  const bottom = top + box.height;
  const arcs: CloudArc[] = [];

  // Top edge, travelling right, bulging up (canvas y grows downward, so PI..2PI is the
  // upper half).
  for (let i = 0; i < nx; i++) {
    arcs.push({ cx: left + (2 * i + 1) * rx, cy: top, r: rx, start: Math.PI, end: 2 * Math.PI });
  }
  // Right edge, travelling down, bulging right.
  for (let i = 0; i < ny; i++) {
    arcs.push({ cx: right, cy: top + (2 * i + 1) * ry, r: ry, start: -Math.PI / 2, end: Math.PI / 2 });
  }
  // Bottom edge, travelling left, bulging down.
  for (let i = nx - 1; i >= 0; i--) {
    arcs.push({ cx: left + (2 * i + 1) * rx, cy: bottom, r: rx, start: 0, end: Math.PI });
  }
  // Left edge, travelling up, bulging left.
  for (let i = ny - 1; i >= 0; i--) {
    arcs.push({ cx: left, cy: top + (2 * i + 1) * ry, r: ry, start: Math.PI / 2, end: (3 * Math.PI) / 2 });
  }
  return arcs;
}
