// lib/markup/matte.ts
// The opaque background rect that has to live INSIDE a Konva stage.
//
// A stage captured with `toDataURL({ mimeType: 'image/jpeg' })` encodes every transparent
// pixel as black, because JPEG has no alpha channel. A CSS background on the container div is
// therefore not enough: `toDataURL` reads the stage, which knows nothing about its container.

export interface MatteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** AnnotationCanvas. Matches the 3D viewer's own background (ModelViewerInner.tsx:605). */
export const CANVAS_MATTE = '#f0f0f0';

/** PDFKonvaViewer. Matches its existing `bg-gray-100` container. */
export const PDF_MATTE = '#f3f4f6';

const EMPTY: MatteRect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * A rect that covers the whole visible container, expressed in the stage's own coordinate
 * space.
 *
 * PDFKonvaViewer puts the zoom and pan on the `Stage` itself, so every layer inherits them and
 * a rect at `(0, 0, containerWidth, containerHeight)` would be scaled and translated away from
 * the viewport. Inverting the transform is what keeps the fill pinned to the screen while the
 * page moves under it.
 *
 * AnnotationCanvas has an untransformed stage and can pass `stageScale: 1`, `stagePos: {x:0,y:0}`,
 * which reduces this to the container rect.
 */
export function matteRectForStage({
  stagePos,
  stageScale,
  containerSize,
}: {
  stagePos: { x: number; y: number };
  stageScale: number;
  containerSize: { width: number; height: number };
}): MatteRect {
  if (!Number.isFinite(stageScale) || stageScale <= 0) return EMPTY;
  if (containerSize.width <= 0 || containerSize.height <= 0) return EMPTY;
  return {
    x: -stagePos.x / stageScale,
    y: -stagePos.y / stageScale,
    width: containerSize.width / stageScale,
    height: containerSize.height / stageScale,
  };
}
