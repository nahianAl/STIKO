import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCadFilename, cadFormatEnabled, cadLabel, cadPreparingLabel, isPendingCad, opensAsModel, cadClaimId, parseCadClaim, claimDecision,
  capLikePattern, firstOfNextMonth, monthlyCap, workerStartOutcome, parseCallbackBody,
  callbackOutcome, nextCadPollStep, CAD_CLAIM_STALE_MS, CAD_MAX_ATTEMPTS, CAD_POLL_LIMIT_MS,
} from '../../lib/cadConversion.ts';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

test('every converted format is a CAD file, in any case, enabled or not', () => {
  for (const n of ['a.sldprt', 'A.SLDPRT', 'dir/Part.SldPrt', 'b.ipt', 'c.CATPart', 'nx.prt', 'creo.prt.5', 'd.x_t', 'd.X_B', 'e.jt', 'f.sat', 'Top.SLDASM']) {
    assert.equal(isCadFilename(n), true, n);
  }
  for (const n of ['a.iam', 'a.asm.3', 'a.step', 'sldprt', '.sldprt', 'a.sldprt.glb', 'a.constructor', 'notes.5']) {
    assert.equal(isCadFilename(n), false, n);
  }
});

test('cadFormatEnabled follows the enabled list', () => {
  assert.equal(cadFormatEnabled('a.ipt', ['sldprt', 'ipt']), true);
  assert.equal(cadFormatEnabled('a.jt', ['sldprt', 'ipt']), false);
  assert.equal(cadFormatEnabled('creo.prt.5', ['prt']), true);
  assert.equal(cadFormatEnabled('a.step', ['sldprt']), false);
  // Default: this build's list, which with the env unset is SolidWorks only.
  assert.equal(cadFormatEnabled('a.sldprt'), true);
  assert.equal(cadFormatEnabled('a.ipt'), false);
});

test('cadLabel and cadPreparingLabel name the format', () => {
  assert.deepEqual(cadLabel('a.ipt'), { app: 'Inventor', noun: 'part', advice: 'Export STEP, then upload.' });
  assert.equal(cadLabel('a.step'), null);
  assert.equal(cadPreparingLabel('a.sldprt'), 'Preparing SolidWorks part…');
  assert.equal(cadPreparingLabel('Top.SLDASM'), 'Preparing SolidWorks assembly…');
  assert.deepEqual(cadLabel('a.sldasm'), { app: 'SolidWorks', noun: 'assembly', advice: 'Save As STEP, then upload.' });
  // With the env unset only SolidWorks parts are switched on; assemblies wait for the switch.
  assert.equal(cadFormatEnabled('a.sldasm'), false);
  assert.equal(cadFormatEnabled('a.sldasm', ['sldprt', 'sldasm']), true);
  assert.equal(cadPreparingLabel('creo.prt.5'), 'Preparing NX or Creo part…');
  assert.equal(cadPreparingLabel('m.jt'), 'Preparing JT model…');
  assert.equal(cadPreparingLabel('a.step'), 'Preparing file…');
});

test('a part without a GLB is pending; with one it opens as a model', () => {
  assert.equal(isPendingCad('a.sldprt', null), true);
  assert.equal(isPendingCad('a.sldprt', 'k/a.sldprt.glb'), false);
  assert.equal(isPendingCad('a.step', null), false);
  assert.equal(opensAsModel('a.sldprt', null), false);
  assert.equal(opensAsModel('a.sldprt', 'k/a.sldprt.glb'), true);
  assert.equal(opensAsModel('a.step', null), true);
  assert.equal(opensAsModel('a.png', null), false);
  assert.equal(isPendingCad('a.ipt', null), true);
  assert.equal(opensAsModel('a.ipt', null), false);
  assert.equal(opensAsModel('creo.prt.5', 'k/creo.prt.5.glb'), true);
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
