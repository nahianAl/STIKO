import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDrawingFilename,
  viewerKindFor,
  drawingClaimId,
  mayClaim,
  nextPollStep,
  converterOutcome,
  DRAWING_CLAIM_STALE_MS,
  DRAWING_POLL_LIMIT_MS,
} from '../../lib/drawingConversion.ts';

test('DWG and DXF are drawings, in any case; nothing else is', () => {
  for (const n of ['a.dwg', 'A.DWG', 'plan.dxf', 'x/y/Plan.DxF']) assert.equal(isDrawingFilename(n), true, n);
  for (const n of ['a.pdf', 'a.dwf', 'dwg', 'a.dwg.zip', '.dwg']) assert.equal(isDrawingFilename(n), false, n);
});

test('a drawing with a PDF is shown as a PDF; without one it is a pending drawing', () => {
  assert.equal(viewerKindFor('plan.dwg', 'uploads/p/x.drawing.pdf'), 'pdf');
  assert.equal(viewerKindFor('plan.dxf', null), 'drawing');
  assert.equal(viewerKindFor('sheet.pdf', null), 'pdf');
  assert.equal(viewerKindFor('model.glb', 'uploads/p/x.optimized.glb'), 'other');
  assert.equal(viewerKindFor('photo.png', null), 'other');
});

test('a claim id records when it was made', () => {
  assert.equal(drawingClaimId(new Date('2026-10-15T12:00:00.000Z')), 'drawing:2026-10-15T12:00:00.000Z');
});

test('only an unclaimed file, or a stale drawing claim, may be claimed', () => {
  const now = new Date('2026-10-15T12:10:00.000Z');
  const fresh = drawingClaimId(new Date(now.getTime() - 60_000));
  const stale = drawingClaimId(new Date(now.getTime() - DRAWING_CLAIM_STALE_MS - 1));
  assert.equal(mayClaim(null, null, now), true);
  assert.equal(mayClaim('processing', fresh, now), false);
  assert.equal(mayClaim('processing', stale, now), true);
  // A 'processing' row with no readable drawing claim (e.g. a legacy CloudConvert job) is
  // treated as stale rather than stuck forever.
  assert.equal(mayClaim('processing', null, now), true);
  assert.equal(mayClaim('processing', 'cloudconvert-job-123', now), true);
  assert.equal(mayClaim('completed', fresh, now), false);
  assert.equal(mayClaim('failed', stale, now), false);
  assert.equal(mayClaim('pending', null, now), false);
});

test('polling stops on a finished PDF, on failure, or at the time limit', () => {
  assert.equal(nextPollStep('completed', 'k.drawing.pdf', 1000), 'done');
  assert.equal(nextPollStep('failed', null, 1000), 'failed');
  assert.equal(nextPollStep('processing', null, 1000), 'wait');
  assert.equal(nextPollStep(null, null, 1000), 'wait');
  assert.equal(nextPollStep('processing', null, DRAWING_POLL_LIMIT_MS), 'failed');
  // 'completed' without a key is not a usable PDF.
  assert.equal(nextPollStep('completed', null, 1000), 'wait');
});

// 'failed' is never retried, so only a verdict on the drawing itself may set it. Anything that
// could be fixed by configuration or a retry releases the claim instead.
test('only a too-large or unreadable drawing fails for good; a 200 completes', () => {
  assert.equal(converterOutcome(200), 'completed');
  assert.equal(converterOutcome(413), 'failed');
  assert.equal(converterOutcome(422), 'failed');
});

test('configuration, storage and server errors, and no response at all, are retried', () => {
  for (const status of [400, 401, 404, 500, 502, 503]) {
    assert.equal(converterOutcome(status), 'retry', String(status));
  }
  // null: no HTTP response (network error, timeout, a throw before the call).
  assert.equal(converterOutcome(null), 'retry');
});
