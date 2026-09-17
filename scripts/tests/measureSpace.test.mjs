import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  naturalPerStagePixel,
  pointsPerStagePixel,
  PDF_RENDER_SCALE,
} from '../../lib/measure/space.ts';

test('an unscaled, unletterboxed chain is 1:1', () => {
  const scale = naturalPerStagePixel(
    { x: 0, y: 0, width: 800, height: 600 },
    800,
    { imageRect: { x: 0, y: 0, width: 800, height: 600 }, naturalWidth: 800, naturalHeight: 600 },
  );
  assert.ok(Math.abs(scale - 1) < 1e-12);
});

// AnnotationCanvas contain-fits the snapshot into the stage, so a stage wider than the
// snapshot's aspect leaves matte on both sides and bgFit.width < snapshot width.
test('a letterboxed bgFit is accounted for', () => {
  const scale = naturalPerStagePixel(
    { x: 100, y: 0, width: 400, height: 300 },
    800,
    { imageRect: { x: 0, y: 0, width: 800, height: 600 }, naturalWidth: 800, naturalHeight: 600 },
  );
  assert.ok(Math.abs(scale - 2) < 1e-12);
});

// The image branch of captureViewerSnapshot draws the <img> at its on-screen size, which is
// smaller than the source whenever the viewer is fit-to-window on a large photo.
test('a downscaled <img> inside the snapshot is accounted for', () => {
  const scale = naturalPerStagePixel(
    { x: 0, y: 0, width: 800, height: 600 },
    800,
    { imageRect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 4000, naturalHeight: 3000 },
  );
  assert.ok(Math.abs(scale - 10) < 1e-12);
});

test('both factors compound', () => {
  const scale = naturalPerStagePixel(
    { x: 100, y: 0, width: 400, height: 300 },
    800,
    { imageRect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 4000, naturalHeight: 3000 },
  );
  assert.ok(Math.abs(scale - 20) < 1e-12);
});

test('degenerate geometry throws rather than producing a silently wrong scale', () => {
  const space = {
    imageRect: { x: 0, y: 0, width: 800, height: 600 },
    naturalWidth: 800,
    naturalHeight: 600,
  };
  assert.throws(() => naturalPerStagePixel({ x: 0, y: 0, width: 0, height: 0 }, 800, space), RangeError);
  assert.throws(() => naturalPerStagePixel({ x: 0, y: 0, width: 800, height: 600 }, 0, space), RangeError);
  assert.throws(
    () =>
      naturalPerStagePixel({ x: 0, y: 0, width: 800, height: 600 }, 800, {
        imageRect: { x: 0, y: 0, width: 0, height: 0 },
        naturalWidth: 800,
        naturalHeight: 600,
      }),
    RangeError,
  );
});

// The 2x trap: PDFKonvaViewer renders at scale 2, so page coordinates are twice the points.
// Storing mm-per-rendered-pixel would make every PDF calibration exactly 2x wrong.
test('PDF page pixels are half a point each, at the viewer render scale', () => {
  assert.equal(PDF_RENDER_SCALE, 2);
  assert.equal(pointsPerStagePixel(), 0.5);
});
