// Pure selection rules for markup multi-select (spec: docs/superpowers/specs/2026-11-02-markup-multiselect-design.md).
// No imports: `node --test` loads this file directly (scripts/tests/markupSelection.test.mjs).

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The selection after a press on object `id`. Shift (`additive`) toggles it. A plain press
 * selects only it — unless it is already selected, in which case the group is kept so the drag
 * that follows moves all of it.
 */
export function pickId(ids: string[], id: string, additive: boolean): string[] {
  if (additive) return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
  return ids.includes(id) ? ids : [id];
}

/** The selection after a box: its hits replace the selection, or (Shift) join it. No duplicates. */
export function mergeSelection(current: string[], hits: string[], additive: boolean): string[] {
  const out = additive ? [...current] : [];
  for (const h of hits) if (!out.includes(h)) out.push(h);
  return out;
}

/** The box between two drag points, whichever way the drag went. */
export function normalizeBox(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** True when two boxes overlap or share an edge — the "touching" rule the selection box uses. */
export function boxesTouch(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** A drag this small in both directions was meant as a click. `minSize` is in the box's units. */
export function isTinyBox(box: Box, minSize: number): boolean {
  return box.width < minSize && box.height < minSize;
}
