import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeDecision, loginRedirectPath } from '../../lib/routeAccess.ts';

// The live bug this module was extracted to fix: the recovery pages were not
// public, so the people who need them — signed-out people — were bounced to
// /login, including everyone arriving from a reset email.
test('password recovery pages are reachable while signed out', () => {
  assert.equal(routeDecision('/forgot-password', false), 'pass');
  assert.equal(routeDecision('/reset-password/3f1c2a', false), 'pass');
});

test('the email-code page is reachable while signed out', () => {
  assert.equal(routeDecision('/verify-email', false), 'pass');
});

test('sign-in, sign-up and invitation pages are public', () => {
  for (const p of ['/login', '/signup', '/invite/abc', '/api/invite/abc', '/api/auth/workos/sign-in']) {
    assert.equal(routeDecision(p, false), 'pass', p);
  }
});

// The trailing slash on '/api/invite/' is load-bearing: '/api/invites' is the
// pending-invite roster and revoke endpoint, and startsWith('/api/invite')
// would open it to anyone.
test('the invite management API is NOT public', () => {
  assert.equal(routeDecision('/api/invites', false), 'login');
});

test('package views are public; their handlers check access themselves', () => {
  assert.equal(routeDecision('/portal/abc', false), 'pass');
});

test('the cron route is exempt by exact match only', () => {
  assert.equal(routeDecision('/api/cron/purge-trash', false), 'pass');
  assert.equal(routeDecision('/api/cron/purge-trash-everything', false), 'login');
});

test('everything else needs a session', () => {
  assert.equal(routeDecision('/', false), 'login');
  assert.equal(routeDecision('/settings/account', false), 'login');
  assert.equal(routeDecision('/api/projects', false), 'login');
});

test('a signed-in visitor passes everywhere', () => {
  for (const p of ['/', '/settings/account', '/api/invites', '/forgot-password']) {
    assert.equal(routeDecision(p, true), 'pass', p);
  }
});

test('the login redirect carries the requested path', () => {
  assert.equal(loginRedirectPath('/settings/account'), '/login?callbackUrl=%2Fsettings%2Faccount');
});
