'use client';

import { useCallback, useRef, useState } from 'react';
import type Konva from 'konva';
import { boxesTouch, isTinyBox, normalizeBox, type Box, type Point } from '@/lib/markup/selection';

interface Selectable {
  objects: { id: string }[];
  selectMany: (ids: string[], additive: boolean) => void;
}

/**
 * The drag-on-empty-space selection box. Points are in the surface's own drawing space (page
 * pixels on the PDF viewer, stage pixels on AnnotationCanvas) — the same space each object's
 * node lives in, which is why the hit test measures nodes relative to their LAYER (untransformed)
 * rather than the stage (which carries the PDF zoom and pan).
 */
export function useMarqueeSelect(ann: Selectable) {
  const startRef = useRef<{ p: Point; additive: boolean } | null>(null);
  const boxRef = useRef<Box | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  const begin = useCallback((p: Point, additive: boolean) => {
    startRef.current = { p, additive };
    boxRef.current = null;
    setBox(null);
  }, []);

  const move = useCallback((p: Point) => {
    const s = startRef.current;
    if (!s) return;
    const b = normalizeBox(s.p, p);
    boxRef.current = b;
    setBox(b);
  }, []);

  /**
   * Finish the gesture. Applies the selection and returns true when a real box was drawn; false
   * for no gesture or a click-sized one. `minSize` is 3 SCREEN pixels expressed in drawing units.
   */
  const end = useCallback((stage: Konva.Stage | null, minSize: number): boolean => {
    const s = startRef.current;
    const b = boxRef.current;
    startRef.current = null;
    boxRef.current = null;
    setBox(null);
    if (!s || !b || !stage || isTinyBox(b, minSize)) return false;
    const hits: string[] = [];
    for (const o of ann.objects) {
      const node = stage.findOne(`#${o.id}`);
      // Hidden = the text box open in the editor; missing = an image still decoding.
      if (!node || !node.isVisible()) continue;
      const layer = node.getLayer();
      if (!layer) continue;
      if (boxesTouch(b, node.getClientRect({ relativeTo: layer }))) hits.push(o.id);
    }
    ann.selectMany(hits, s.additive);
    return true;
  }, [ann]);

  return { box, begin, move, end };
}
