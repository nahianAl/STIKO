/**
 * Converting a measured span on a 2D surface into that file's own intrinsic units.
 *
 * This is the arithmetic that fails silently. A wrong factor here does not throw and does not
 * look wrong — it produces plausible numbers that are simply incorrect, on a tool whose entire
 * purpose is to be trusted. Hence: every input validated, every factor separately tested.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSnapshotSpace {
  /** Where the source <img> was drawn inside the captured snapshot, in snapshot pixels. */
  imageRect: Rect;
  naturalWidth: number;
  naturalHeight: number;
}

function requirePositive(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${what} must be a positive, finite number`);
  }
}

/**
 * How many NATURAL image pixels one AnnotationCanvas stage pixel spans.
 *
 * Two uniform, aspect-preserving steps compound into one factor:
 *
 *   stage px  --bgFit-->  snapshot px  --imageRect-->  natural px
 *
 * `bgFit` is AnnotationCanvas's contain-fit of the snapshot into the stage (it already computes
 * this for the native-resolution capture path). `imageRect` is where captureViewerSnapshot drew
 * the <img> inside the snapshot, captured at freeze time — the viewer's zoom is baked into it,
 * which is exactly why calibration must be stored in natural pixels and never in stage pixels.
 */
export function naturalPerStagePixel(
  bgFit: Rect,
  snapshotWidth: number,
  space: ImageSnapshotSpace,
): number {
  requirePositive(bgFit.width, 'The fitted background width');
  requirePositive(snapshotWidth, 'The snapshot width');
  requirePositive(space.imageRect.width, 'The image rect width');
  requirePositive(space.naturalWidth, 'The natural image width');

  const stageToSnapshot = snapshotWidth / bgFit.width;
  const snapshotToNatural = space.naturalWidth / space.imageRect.width;
  return stageToSnapshot * snapshotToNatural;
}

/**
 * The scale PDFKonvaViewer renders pages at. PDFKonvaViewer must import this constant rather
 * than repeating the literal: a PDF's intrinsic unit is the POINT (1/72"), and storing
 * mm-per-rendered-pixel instead would make every PDF calibration exactly this factor wrong.
 */
export const PDF_RENDER_SCALE = 2;

/** How many PDF points one rendered page pixel spans. */
export function pointsPerStagePixel(): number {
  return 1 / PDF_RENDER_SCALE;
}
