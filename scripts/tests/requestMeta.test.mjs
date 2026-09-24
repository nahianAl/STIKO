import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestMeta } from '../../lib/requestMeta.ts';

test('the first forwarded address is the client', () => {
  const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Safari' });
  assert.deepEqual(requestMeta(h), { ipAddress: '203.0.113.7', userAgent: 'Safari' });
});

test('x-real-ip is the fallback', () => {
  assert.deepEqual(requestMeta(new Headers({ 'x-real-ip': '203.0.113.8' })), { ipAddress: '203.0.113.8' });
});

test('nothing known means nothing sent', () => {
  assert.deepEqual(requestMeta(new Headers()), {});
});
