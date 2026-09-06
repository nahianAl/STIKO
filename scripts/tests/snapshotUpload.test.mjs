import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshotDataUrl, MAX_SNAPSHOT_BYTES } from '../../lib/snapshotUpload.ts';

const jpeg = (body) => `data:image/jpeg;base64,${body}`;

test('a well-formed JPEG snapshot is accepted and decoded', () => {
  const payload = Buffer.from('pretend-jpeg-bytes').toString('base64');
  const result = parseSnapshotDataUrl(jpeg(payload));

  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.extension, 'jpg');
  assert.equal(result.buffer.toString(), 'pretend-jpeg-bytes');
});

test('PNG is accepted and gets the png extension', () => {
  const payload = Buffer.from('pretend-png-bytes').toString('base64');
  const result = parseSnapshotDataUrl(`data:image/png;base64,${payload}`);

  assert.equal(result.ok, true);
  assert.equal(result.extension, 'png');
});

// The old regex group was [\w/+-]+. Everything written to R2 is served back, so
// a caller-chosen content type is stored XSS on our own origin.
test('a non-image content type is refused, not stored', () => {
  const payload = Buffer.from('<script>alert(1)</script>').toString('base64');

  for (const type of ['text/html', 'image/svg+xml', 'application/javascript']) {
    const result = parseSnapshotDataUrl(`data:${type};base64,${payload}`);
    assert.equal(result.ok, false, type);
    assert.equal(result.reason, 'unsupported_type', type);
  }
});

test('anything that is not a base64 data URL is malformed', () => {
  for (const input of [
    'https://example.com/x.jpg',
    'data:image/jpeg,not-base64-at-all',
    '',
    null,
    undefined,
    42,
    {},
  ]) {
    const result = parseSnapshotDataUrl(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.reason, 'malformed', JSON.stringify(input));
  }
});

test('an oversized payload is refused', () => {
  // Four base64 characters carry three bytes, so this is deliberately just past
  // the cap without allocating anything near it in the test itself.
  const chars = Math.ceil(((MAX_SNAPSHOT_BYTES + 1024) * 4) / 3);
  const result = parseSnapshotDataUrl(jpeg('A'.repeat(chars)));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too_large');
});

test('the cap is a real bound, not a placeholder', () => {
  assert.equal(typeof MAX_SNAPSHOT_BYTES, 'number');
  assert.ok(MAX_SNAPSHOT_BYTES > 0 && MAX_SNAPSHOT_BYTES <= 16 * 1024 * 1024);
});
