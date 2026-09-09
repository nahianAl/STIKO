import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_UPLOAD_ATTEMPTS,
  isRetriableUploadFailure,
  retryDelayMs,
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
