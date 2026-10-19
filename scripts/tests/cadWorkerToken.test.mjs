import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadCallbackToken, verifyCadCallbackToken } from '../../lib/cadWorkerToken.ts';

test('a token verifies only for its own secret, file and claim', () => {
  const t = cadCallbackToken('s', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z');
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(verifyCadCallbackToken('s', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z', t), true);
  assert.equal(verifyCadCallbackToken('other', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z', t), false);
  assert.equal(verifyCadCallbackToken('s', 'file-2', 'cad:1:2026-10-18T12:00:00.000Z', t), false);
  assert.equal(verifyCadCallbackToken('s', 'file-1', 'cad:2:2026-10-18T12:00:00.000Z', t), false);
  assert.equal(verifyCadCallbackToken('s', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z', 'short'), false);
  assert.equal(verifyCadCallbackToken('s', 'file-1', 'cad:1:2026-10-18T12:00:00.000Z', t.toUpperCase()), false);
});
