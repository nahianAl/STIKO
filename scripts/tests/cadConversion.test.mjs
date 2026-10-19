import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSldprtFilename, isPendingCad, opensAsModel, cadClaimId, parseCadClaim, claimDecision,
  capLikePattern, firstOfNextMonth, monthlyCap, workerStartOutcome, parseCallbackBody,
  callbackOutcome, nextCadPollStep, CAD_CLAIM_STALE_MS, CAD_MAX_ATTEMPTS, CAD_POLL_LIMIT_MS,
} from '../../lib/cadConversion.ts';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

test('only .sldprt is a SolidWorks part, in any case', () => {
  for (const n of ['a.sldprt', 'A.SLDPRT', 'dir/Part.SldPrt']) assert.equal(isSldprtFilename(n), true, n);
  for (const n of ['a.sldasm', 'a.step', 'sldprt', '.sldprt', 'a.sldprt.glb']) assert.equal(isSldprtFilename(n), false, n);
});

test('a part without a GLB is pending; with one it opens as a model', () => {
  assert.equal(isPendingCad('a.sldprt', null), true);
  assert.equal(isPendingCad('a.sldprt', 'k/a.sldprt.glb'), false);
  assert.equal(isPendingCad('a.step', null), false);
  assert.equal(opensAsModel('a.sldprt', null), false);
  assert.equal(opensAsModel('a.sldprt', 'k/a.sldprt.glb'), true);
  assert.equal(opensAsModel('a.step', null), true);
  assert.equal(opensAsModel('a.png', null), false);
});

test('claim ids carry the attempt and the time, and parse back', () => {
  const id = cadClaimId(2, NOW);
  assert.equal(id, 'cad:2:2026-10-18T12:00:00.000Z');
  assert.deepEqual(parseCadClaim(id), { attempt: 2, claimedAt: NOW.getTime() });
  for (const bad of [null, '', 'drawing:2026-10-18T12:00:00.000Z', 'cad:x:2026', 'cad:1:not-a-date', 'cad:0:2026-10-18T12:00:00.000Z']) {
    assert.equal(parseCadClaim(bad), null, String(bad));
  }
});

test('claim decisions', () => {
  assert.deepEqual(claimDecision(null, null, NOW), { kind: 'claim', attempt: 1 });
  assert.deepEqual(claimDecision('pending', null, NOW), { kind: 'claim', attempt: 1 });
  assert.deepEqual(claimDecision('completed', 'cad:1:x', NOW), { kind: 'final' });
  assert.deepEqual(claimDecision('failed', 'cad:1:x', NOW), { kind: 'final' });
  assert.deepEqual(claimDecision('processing', cadClaimId(1, ago(60_000)), NOW), { kind: 'wait' });
  assert.deepEqual(claimDecision('processing', cadClaimId(1, ago(CAD_CLAIM_STALE_MS + 1)), NOW), { kind: 'claim', attempt: 2 });
  assert.deepEqual(claimDecision('processing', cadClaimId(CAD_MAX_ATTEMPTS, ago(CAD_CLAIM_STALE_MS + 1)), NOW), { kind: 'give-up' });
  // A processing row with no readable cad claim (another feature's, or garbage) starts afresh.
  assert.deepEqual(claimDecision('processing', 'job-123', NOW), { kind: 'claim', attempt: 1 });
});

test('the cap counts this month\'s claims and reopens on the 1st', () => {
  assert.equal(capLikePattern(NOW), 'cad:%:2026-10-%');
  assert.equal(firstOfNextMonth(NOW), '2026-11-01');
  assert.equal(firstOfNextMonth(new Date('2026-12-31T23:59:59.000Z')), '2027-01-01');
  assert.equal(monthlyCap(undefined), 300);
  assert.equal(monthlyCap(''), 300);
  assert.equal(monthlyCap('abc'), 300);
  assert.equal(monthlyCap('-5'), 300);
  assert.equal(monthlyCap('0'), 0);
  assert.equal(monthlyCap(' 120 '), 120);
});

test('only a 200 with a call id means the worker started', () => {
  assert.equal(workerStartOutcome(200, { callId: 'fc-1' }), 'started');
  assert.equal(workerStartOutcome(200, {}), 'retry');
  assert.equal(workerStartOutcome(200, { callId: '' }), 'retry');
  for (const s of [null, 400, 401, 413, 422, 500, 502, 302]) assert.equal(workerStartOutcome(s, { callId: 'x' }), 'retry', String(s));
});

test('callback bodies are validated and classified', () => {
  const ok = { fileId: 'f', claimId: 'c', token: 't', ok: true, glbBytes: 10 };
  assert.deepEqual(parseCallbackBody(ok), ok);
  assert.equal(callbackOutcome(ok), 'completed');
  assert.equal(callbackOutcome({ ...ok, glbBytes: 0 }), 'failed');
  assert.equal(callbackOutcome({ ...ok, ok: false, reason: 'too_large' }), 'failed');
  for (const bad of [null, 'x', {}, { ...ok, fileId: 1 }, { ...ok, ok: 'yes' }, { ...ok, token: '' }]) {
    assert.equal(parseCallbackBody(bad), null, JSON.stringify(bad));
  }
});

test('poll steps', () => {
  assert.equal(nextCadPollStep('completed', 'k', 0), 'done');
  assert.equal(nextCadPollStep('completed', null, 0), 'wait');
  assert.equal(nextCadPollStep('failed', null, 0), 'failed');
  assert.equal(nextCadPollStep('processing', null, 1000), 'wait');
  assert.equal(nextCadPollStep('processing', null, CAD_POLL_LIMIT_MS), 'timeout');
});
