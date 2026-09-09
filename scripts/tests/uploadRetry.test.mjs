import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_UPLOAD_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  isRetriableUploadFailure,
  retryDelayMs,
  shouldAbortForStall,
} from '../../lib/uploadRetry.ts';

test('a network-level failure has no status and is retriable', () => {
  // xhr.onerror fires with status 0 — the reset the co-founder hit. This is the
  // single case the whole module exists for.
  assert.equal(isRetriableUploadFailure(null), true);
  assert.equal(isRetriableUploadFailure(0), true);
});

test('server-side faults are retriable', () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(isRetriableUploadFailure(status), true, `${status} should retry`);
  }
});

test('throttling and request timeout are retriable', () => {
  assert.equal(isRetriableUploadFailure(408), true);
  assert.equal(isRetriableUploadFailure(429), true);
});

test('a rejection the client caused is NOT retriable', () => {
  // Retrying these burns the URL's remaining lifetime to reach the same answer.
  // 403 in particular is an expired or malformed signature: it will never pass.
  for (const status of [400, 401, 403, 404, 409, 413]) {
    assert.equal(isRetriableUploadFailure(status), false, `${status} should not retry`);
  }
});

test('success is not a failure to retry', () => {
  assert.equal(isRetriableUploadFailure(200), false);
  assert.equal(isRetriableUploadFailure(204), false);
});

test('backoff grows and is bounded', () => {
  const delays = [0, 1, 2, 3, 4, 5].map((a) => retryDelayMs(a));
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] >= delays[i - 1], `delay must not shrink at attempt ${i}`);
  }
  assert.ok(delays[0] >= 500 && delays[0] <= 1500, `first delay ~1s, got ${delays[0]}`);
  // Bounded so a long backoff cannot outlive the presigned URL it retries against.
  for (const d of delays) assert.ok(d <= 10_000, `delay ${d} exceeds the 10s cap`);
});

test('there is more than one attempt, and not an unbounded number', () => {
  // One attempt would mean no retry at all; too many would keep a doomed upload
  // spinning long past the point the user should be told it failed.
  assert.ok(MAX_UPLOAD_ATTEMPTS >= 3, 'need at least a couple of retries');
  assert.ok(MAX_UPLOAD_ATTEMPTS <= 5, 'not unbounded');
});

test('a transfer that is still moving is never aborted', () => {
  assert.equal(shouldAbortForStall(0), false);
  assert.equal(shouldAbortForStall(1_000), false);
  assert.equal(shouldAbortForStall(STALL_TIMEOUT_MS - 1), false);
});

test('a transfer with no progress past the threshold is aborted', () => {
  assert.equal(shouldAbortForStall(STALL_TIMEOUT_MS), true);
  assert.equal(shouldAbortForStall(STALL_TIMEOUT_MS + 1), true);
});

test('the stall threshold is generous enough for a slow but live transfer', () => {
  // This is a STALL detector, not a total timeout: a legitimately slow multi-GB
  // upload emits progress events throughout and must never trip it. Anything
  // under ~30s would risk aborting a live transfer on a congested link.
  assert.ok(STALL_TIMEOUT_MS >= 30_000, 'too aggressive for a slow connection');
  assert.ok(STALL_TIMEOUT_MS <= 180_000, 'so long the user gives up first');
});

test('the JSON request timeout is much shorter than the stall threshold', () => {
  // presign and complete are small same-origin requests. A flat timeout is right
  // for them, and it must be well under the stall threshold or a wedged JSON
  // call would outlive a wedged multi-gigabyte upload.
  assert.ok(REQUEST_TIMEOUT_MS > 0);
  assert.ok(
    REQUEST_TIMEOUT_MS < STALL_TIMEOUT_MS,
    'a small JSON POST should give up sooner than a file transfer'
  );
});

test('an aborted stall is retriable, which is the point of aborting it', () => {
  // The watchdog rejects with status null. If that were not retriable, aborting a
  // stall would convert an infinite hang into an instant permanent failure —
  // strictly worse than the bug it replaces.
  assert.equal(isRetriableUploadFailure(null), true);
});
