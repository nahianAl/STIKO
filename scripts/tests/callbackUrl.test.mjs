import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCallbackUrl } from '../../lib/callbackUrl.ts';

test('a path on this site is kept', () => {
  assert.equal(safeCallbackUrl('/invite/abc'), '/invite/abc');
  assert.equal(safeCallbackUrl('/portal/p1?file=f1'), '/portal/p1?file=f1');
});

test('nothing means home', () => {
  assert.equal(safeCallbackUrl(null), '/');
  assert.equal(safeCallbackUrl(undefined), '/');
  assert.equal(safeCallbackUrl(''), '/');
});

// callbackUrl ends up in router.push right after a successful sign-in. An
// unchecked value turns every login link into a redirect to wherever the
// link's author likes — the classic phishing follow-through.
test('anything that could leave the site means home', () => {
  for (const raw of [
    'https://evil.example/login',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'evil.example',
  ]) {
    assert.equal(safeCallbackUrl(raw), '/', raw);
  }
});
