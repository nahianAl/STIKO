import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRejectedExtensions,
  MAX_REJECTED_PER_REPORT,
} from '../../lib/rejectedUploads.ts';

test('extensions are lowercased and kept once per refused file', () => {
  // Duplicates are deliberate: three refused .sldprt files are three data points.
  assert.deepEqual(normalizeRejectedExtensions(['SLDPRT', 'sldprt', 'rvt']), ['sldprt', 'sldprt', 'rvt']);
});

test('an empty string means a file with no extension and is stored as (none)', () => {
  assert.deepEqual(normalizeRejectedExtensions(['']), ['(none)']);
});

test('anything that does not look like an extension is dropped', () => {
  assert.deepEqual(
    normalizeRejectedExtensions(['x_t', 'a.b', 'has space', 'waytoolongext', "'; drop", 42, null]),
    ['x_t']
  );
});

test('a report is capped so one request cannot write unbounded rows', () => {
  const many = Array.from({ length: 50 }, () => 'skp');
  assert.equal(normalizeRejectedExtensions(many).length, MAX_REJECTED_PER_REPORT);
  assert.equal(MAX_REJECTED_PER_REPORT, 20);
});

test('a body that is not an array yields nothing', () => {
  for (const bad of [undefined, null, 'sldprt', { extensions: ['sldprt'] }]) {
    assert.deepEqual(normalizeRejectedExtensions(bad), []);
  }
});
