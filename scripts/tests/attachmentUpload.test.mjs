import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAttachmentRequest,
  validateCommentAttachmentList,
  MAX_ATTACHMENT_BYTES,
  MAX_SNAPSHOT_BYTES,
  MAX_ATTACHMENTS_PER_COMMENT,
} from '../../lib/attachmentUpload.ts';

const ok = (over) => ({
  filename: 'section-detail.pdf',
  contentType: 'application/pdf',
  size: 1024,
  // The file the comment hangs off. Required since 2026-09-08: it is what the
  // route resolves to a package to decide whether this caller may write at all.
  fileId: 'file-1',
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

test('a request without a fileId is malformed', () => {
  // The fileId is what ties this presigned WRITE to a package the caller belongs
  // to. Without it the route could only check that SOMEONE was logged in, so any
  // account could mint unlimited 25MB writes into the bucket.
  assert.deepEqual(
    validateAttachmentRequest({ filename: 'a.png', contentType: 'image/png', size: 10 }),
    { ok: false, reason: 'malformed' }
  );
});

test('a non-string or empty fileId is malformed', () => {
  const base = { filename: 'a.png', contentType: 'image/png', size: 10 };
  for (const fileId of [null, 42, '', {}, []]) {
    assert.deepEqual(
      validateAttachmentRequest({ ...base, fileId }),
      { ok: false, reason: 'malformed' },
      `fileId ${JSON.stringify(fileId)} should be rejected`
    );
  }
});

test('a valid request carries the fileId through for the access check', () => {
  const out = validateAttachmentRequest({
    filename: 'a.png', contentType: 'image/png', size: 10, fileId: 'file-123',
  });
  assert.equal(out.ok, true);
  assert.equal(out.fileId, 'file-123');
});

test('a snapshot is held to a tighter cap than an attachment', () => {
  // A snapshot is a canvas JPEG; letting one be as big as a 25 MiB attachment is
  // what made re-posting an attachment as a snapshot a way round the counted
  // storage. Bytes, not megabytes: the route compares against this directly.
  assert.equal(MAX_SNAPSHOT_BYTES, 10 * 1024 * 1024);
  assert.ok(MAX_SNAPSHOT_BYTES < MAX_ATTACHMENT_BYTES);
});

const att = (storageKey, over) => ({
  storageKey,
  filename: 'a.pdf',
  contentType: 'application/pdf',
  size: 1,
  ...over,
});

test('no attachments, or something that is not a list, is an empty list', () => {
  for (const input of [undefined, null, [], 'x', 5, {}]) {
    assert.deepEqual(validateCommentAttachmentList(input), { ok: true, list: [] });
  }
});

test('a list of distinct attachment keys is accepted and returned as is', () => {
  const list = [
    att('comment-attachments/a.pdf'),
    att('comment-attachments/b.png', { filename: 'b.png' }),
    att('snapshots/c.jpg'),
  ];
  assert.deepEqual(validateCommentAttachmentList(list), { ok: true, list });
});

test('exactly the cap is accepted and one more is refused', () => {
  const make = (n) => Array.from({ length: n }, (_, i) => att(`comment-attachments/${i}.pdf`));
  assert.equal(validateCommentAttachmentList(make(MAX_ATTACHMENTS_PER_COMMENT)).ok, true);
  assert.deepEqual(validateCommentAttachmentList(make(MAX_ATTACHMENTS_PER_COMMENT + 1)), {
    ok: false,
    reason: 'too_many',
  });
});

test('the count is checked before the entries are looked at', () => {
  // Otherwise a request of thousands of junk entries is walked end to end first.
  const junk = Array.from({ length: MAX_ATTACHMENTS_PER_COMMENT + 1 }, () => 'not an object');
  assert.deepEqual(validateCommentAttachmentList(junk), { ok: false, reason: 'too_many' });
});

test('the same key twice in one comment is refused', () => {
  assert.deepEqual(
    validateCommentAttachmentList([
      att('comment-attachments/a.pdf'),
      att('comment-attachments/b.pdf'),
      att('comment-attachments/a.pdf', { filename: 'renamed.pdf' }),
    ]),
    { ok: false, reason: 'duplicate' }
  );
});

test('an entry that does not name a stored comment object is refused', () => {
  for (const bad of [
    att('https://example.com/x.png'),
    att('http://example.com/x.png'),
    att('data:image/png;base64,AAAA'),
    att('uploads/p1/k1/v1/f1.step'),
    att('anything/else'),
    att(''),
    att(undefined),
    att(42),
    att(null),
    null,
    'comment-attachments/a.pdf',
    42,
    [],
  ]) {
    assert.deepEqual(
      validateCommentAttachmentList([att('comment-attachments/ok.pdf'), bad]),
      { ok: false, reason: 'invalid_key' },
      JSON.stringify(bad)
    );
  }
});
