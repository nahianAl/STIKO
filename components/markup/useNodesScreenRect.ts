'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';
import type Konva from 'konva';
import type { RectLike } from '@/lib/markup/text';

function sameRect(a: RectLike | null, b: RectLike | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/**
 * The on-screen box around some Konva nodes, in the stage CONTAINER's pixels — the space
 * CanvasTextEditor and TextStyleBar are absolutely positioned in. `getClientRect()` with no
 * `relativeTo` already includes the stage's own zoom and pan, so this is right on the zoomable
 * PDF stage and on the unscaled AnnotationCanvas alike.
 *
 * Re-measured on every layer draw rather than on a hand-kept list of what can move a node
 * (typing, the bar, a drag, a zoom, a pan, a resize): each of those redraws a layer, and
 * a draw happens after Konva has the new attributes, which a React effect cannot promise —
 * react-konva commits into Konva from its own reconciler. State is set only on a real change.
 */
export function useNodesScreenRect(stageRef: RefObject<Konva.Stage>, ids: readonly string[]): RectLike | null {
  const [rect, setRect] = useState<RectLike | null>(null);
  const key = ids.join(' ');

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !key) {
      setRect(null);
      return;
    }
    const wanted = key.split(' ');
    const measure = () => {
      let next: RectLike | null = null;
      for (const id of wanted) {
        const node = stage.findOne(`#${id}`);
        if (!node) continue;
        const r = node.getClientRect();
        if (!next) {
          next = { x: r.x, y: r.y, width: r.width, height: r.height };
        } else {
          const x = Math.min(next.x, r.x);
          const y = Math.min(next.y, r.y);
          next = {
            x,
            y,
            width: Math.max(next.x + next.width, r.x + r.width) - x,
            height: Math.max(next.y + next.height, r.y + r.height) - y,
          };
        }
      }
      setRect((cur) => (sameRect(cur, next) ? cur : next));
    };
    measure();
    const layers = stage.getLayers();
    for (const l of layers) l.on('draw.nodesScreenRect', measure);
    return () => {
      for (const l of layers) l.off('draw.nodesScreenRect', measure);
    };
  }, [stageRef, key]);

  return key ? rect : null;
}
