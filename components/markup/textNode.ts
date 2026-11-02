// components/markup/textNode.ts
// Konva-side helpers for markup text. A text object is a Group (which carries the object id and
// every transform) wrapping an optional fill/border Shape and a Text, neither of which has an id.
import type Konva from 'konva';

/** Name on the Group that stands for one markup text object. */
export const TEXT_GROUP_NAME = 'markup-text';

/** Name on the optional fill/border shape drawn behind the glyphs. */
export const TEXT_BOX_NAME = 'markup-text-box';

/**
 * The markup object id a hit shape belongs to. Most markup is a single Konva shape carrying its
 * own id, but `stage.getIntersection` always returns the LEAF, and a text's leaves have no id —
 * its Group does. Only a text Group's id is borrowed: any other parent (a comment pin's Group, a
 * measurement's) must not turn a press on its child into an id the eraser would act on.
 */
export function hitObjectId(shape: Konva.Node | null | undefined): string {
  if (!shape) return '';
  const own = shape.id();
  if (own) return own;
  const parent = shape.getParent();
  return parent && parent.hasName(TEXT_GROUP_NAME) ? parent.id() : '';
}

/** The Text inside a markup text Group, or null for any other node. */
export function textOf(node: Konva.Node): Konva.Text | null {
  const group = node as Konva.Group;
  if (typeof group.findOne !== 'function') return null;
  return group.findOne<Konva.Text>('Text') ?? null;
}

/**
 * Each rendered line's glyph box, in the Text node's own space. Mirrors Konva's own alignment
 * arithmetic (Text._sceneFunc): a line is offset inside the width-minus-padding by its slack,
 * all of it for 'right' and half of it for 'center'.
 */
export function glyphLineRects(t: Konva.Text): { x: number; y: number; width: number; height: number }[] {
  const pad = t.padding();
  const inner = t.width() - pad * 2;
  const lineHeight = t.fontSize() * t.lineHeight();
  const align = t.align();
  return t.textArr.map((line, i) => {
    const slack = Math.max(0, inner - line.width);
    const dx = align === 'center' ? slack / 2 : align === 'right' ? slack : 0;
    return { x: pad + dx, y: pad + i * lineHeight, width: line.width, height: lineHeight };
  });
}

/** The horizontal extent of the glyphs across all lines, in the Text node's own space. */
export function glyphSpan(t: Konva.Text): { x: number; width: number } {
  const rects = glyphLineRects(t).filter((r) => r.width > 0);
  if (!rects.length) return { x: 0, width: 0 };
  const x0 = Math.min(...rects.map((r) => r.x));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  return { x: x0, width: x1 - x0 };
}
