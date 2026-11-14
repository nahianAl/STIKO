import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notUploadedMessage } from '../../lib/uploadMessages.ts';

test('a batch stopped by a full plan says storage is full and how to recover', () => {
  const msg = notUploadedMessage(true);
  assert.match(msg, /Storage is full/);
  assert.match(msg, /Upgrade or free up space/);
});

test('any other left-behind file keeps the generic retry copy', () => {
  const msg = notUploadedMessage(false);
  assert.match(msg, /Some files didn’t upload/);
  assert.match(msg, /nothing is published until they all land/);
  assert.doesNotMatch(msg, /Storage is full/);
});

test('the copy never uses the retired words', () => {
  for (const blocked of [true, false]) {
    assert.doesNotMatch(notUploadedMessage(blocked), /version|portal/i);
  }
});
