import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAttachmentRequest,
  MAX_ATTACHMENT_BYTES,
} from '../../lib/attachmentUpload.ts';

const ok = (over) => ({
  filename: 'section-detail.pdf',
  contentType: 'application/pdf',
  size: 1024,
  ...over,
});

test('a normal document attachment is accepted', () => {
  const result = validateAttachmentRequest(ok());

  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(result.size, 1024);
  assert.equal(result.extension, '.pdf');
});

// Comment attachments are arbitrary files by design — the file input carries no
// `accept` attribute. An image-only allow-list here would delete the feature.
test('arbitrary document types stay allowed', () => {
  for (const contentType of [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip',
    'model/step',
  ]) {
    const result = validateAttachmentRequest(ok({ contentType }));
    assert.equal(result.ok, true, contentType);
  }
});

// Narrow deny-list: only the types dangerous because a browser renders them.
test('browser-rendering types are refused', () => {
  for (const contentType of [
    'text/html',
    'image/svg+xml',
    'application/xhtml+xml',
    'TEXT/HTML',
    'text/html; charset=utf-8',
  ]) {
    const result = validateAttachmentRequest(ok({ contentType }));
    assert.equal(result.ok, false, contentType);
    assert.equal(result.reason, 'unsupported_type', contentType);
  }
});

test('an oversized attachment is refused', () => {
  const result = validateAttachmentRequest(ok({ size: MAX_ATTACHMENT_BYTES + 1 }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too_large');
});

test('a size exactly at the cap is accepted', () => {
  const result = validateAttachmentRequest(ok({ size: MAX_ATTACHMENT_BYTES }));
  assert.equal(result.ok, true);
});

test('a missing, non-numeric, zero or negative size is malformed', () => {
  // The declared size is what bounds the presigned URL. Without it there is no
  // cap at all, so it must be required rather than defaulted.
  for (const size of [undefined, null, '1024', 0, -1, 1.5, NaN, Infinity]) {
    const result = validateAttachmentRequest(ok({ size }));
    assert.equal(result.ok, false, String(size));
    assert.equal(result.reason, 'malformed', String(size));
  }
});

test('a missing or non-string filename or contentType is malformed', () => {
  for (const over of [
    { filename: undefined },
    { filename: '' },
    { filename: 42 },
    { contentType: undefined },
    { contentType: '' },
    { contentType: 99 },
  ]) {
    const result = validateAttachmentRequest(ok(over));
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.equal(result.reason, 'malformed', JSON.stringify(over));
  }
});

test('a non-object input is malformed', () => {
  for (const input of [null, undefined, 'x', 42, []]) {
    const result = validateAttachmentRequest(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.reason, 'malformed', JSON.stringify(input));
  }
});

test('the extension is derived from the filename and never invented', () => {
  assert.equal(validateAttachmentRequest(ok({ filename: 'a.PDF' })).extension, '.PDF');
  assert.equal(validateAttachmentRequest(ok({ filename: 'no-extension' })).extension, '');
  assert.equal(validateAttachmentRequest(ok({ filename: 'a.b.c' })).extension, '.c');
});

// The storage key is built from this extension. A path separator or a space in
// it would let the caller steer the object outside its namespace.
test('a filename cannot smuggle a path segment through the extension', () => {
  for (const filename of ['a.pdf/../../evil', 'a./../x', 'a. x']) {
    const result = validateAttachmentRequest(ok({ filename }));
    if (result.ok) {
      assert.ok(!result.extension.includes('/'), filename);
      assert.ok(!result.extension.includes('\\'), filename);
      assert.ok(!result.extension.includes(' '), filename);
    }
  }
});
