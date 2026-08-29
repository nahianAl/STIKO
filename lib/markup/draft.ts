// lib/markup/draft.ts
// The geometry of an in-progress draw gesture, and what Shift does to it.
//
// Extracted out of useAnnotationObjects so it can be unit-tested: the two drawing surfaces
// both delegate here, so the constraint behaves identically on a 3D snapshot and on a PDF.
// Pure arithmetic, no React and no '@/' imports.

export type DraftTool = 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud';

/** Tools drawn by dragging out a bounding box. They share all of their gesture maths. */
export const BOX_TOOLS = ['rect', 'ellipse', 'cloud'] as const;
/** Tools drawn as a single two-point segment. */
export const SEGMENT_TOOLS = ['line', 'arrow'] as const;

export type BoxTool = (typeof BOX_TOOLS)[number];
export type SegmentTool = (typeof SEGMENT_TOOLS)[number];

// Widened to `string` on purpose: callers hold an AnnotationObjectType, which also spans
// 'text' and 'image', and should be able to ask without casting first.
export function isBoxTool(tool: string): tool is BoxTool {
  return (BOX_TOOLS as readonly string[]).includes(tool);
}

export function isSegmentTool(tool: string): tool is SegmentTool {
  return (SEGMENT_TOOLS as readonly string[]).includes(tool);
}

export interface Point {
  x: number;
  y: number;
}

/** The subset of an AnnotationObject a draw gesture writes. */
export interface DraftGeometry {
  points: number[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export function startGeometry(tool: DraftTool, p: Point): DraftGeometry {
  if (tool === 'freehand') return { points: [p.x, p.y], x: 0, y: 0, width: 0, height: 0 };
  if (isSegmentTool(tool)) return { points: [p.x, p.y, p.x, p.y], x: 0, y: 0, width: 0, height: 0 };
  return { points: [], x: p.x, y: p.y, width: 0, height: 0 };
}

/**
 * Square off a box, so an ellipse drawn with Shift is a perfect circle.
 *
 * Both extents take the magnitude of the LARGER of the two and keep their own sign. Taking
 * the width would collapse a mostly-vertical drag to whatever width it happened to have,
 * which feels like the tool fighting you.
 */
export function constrainBox(width: number, height: number): { width: number; height: number } {
  const size = Math.max(Math.abs(width), Math.abs(height));
  return {
    width: width < 0 ? -size : size,
    height: height < 0 ? -size : size,
  };
}

/** Shift snaps a segment to eighths of a turn. */
export const SEGMENT_SNAP_STEP = Math.PI / 4;

/** The far end of a segment, snapped to the nearest 45 deg about its anchor, length kept. */
export function constrainSegment(x0: number, y0: number, x1: number, y1: number): Point {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: x1, y: y1 };
  const angle = Math.round(Math.atan2(dy, dx) / SEGMENT_SNAP_STEP) * SEGMENT_SNAP_STEP;
  return { x: x0 + Math.cos(angle) * length, y: y0 + Math.sin(angle) * length };
}

/**
 * Advance a draft to the current pointer position. `constrain` is the Shift key, read fresh
 * from each pointer event — so pressing or releasing Shift mid-drag takes effect on the next
 * move rather than instantly, which is the ordinary design-tool behaviour.
 */
export function updateGeometry(tool: DraftTool, g: DraftGeometry, p: Point, constrain: boolean): DraftGeometry {
  if (tool === 'freehand') return { ...g, points: [...g.points, p.x, p.y] };
  if (isSegmentTool(tool)) {
    const end = constrain ? constrainSegment(g.points[0], g.points[1], p.x, p.y) : p;
    return { ...g, points: [g.points[0], g.points[1], end.x, end.y] };
  }
  const width = p.x - g.x;
  const height = p.y - g.y;
  const box = constrain ? constrainBox(width, height) : { width, height };
  return { ...g, width: box.width, height: box.height };
}

/**
 * The box a possibly-negative-extent draft occupies, in the node's OWN coordinates — the
 * node sits at (x, y) and the box spans (0,0) to (width, height). Committed objects are
 * normalised on release, but a draft mid-drag is not, so anything drawing a box shape has
 * to cope with negative extents.
 */
export function normalizedBox(width: number, height: number): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(0, width),
    top: Math.min(0, height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
}
