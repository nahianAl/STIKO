import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signProfileCookie, profileCookieValid } from '../../lib/kyc/profileCookie.ts';
import { kycGateEnabled, isGatedPage, welcomeRedirectPath } from '../../lib/kyc/gate.ts';

const SECRET = 'test-secret-0123456789';

test('a signed cookie validates only for its own subject and secret', async () => {
  const v = await signProfileCookie('user_01ABC', SECRET);
  assert.equal(await profileCookieValid(v, 'user_01ABC', SECRET), true);
  assert.equal(await profileCookieValid(v, 'user_02XYZ', SECRET), false);
  assert.equal(await profileCookieValid(v, 'user_01ABC', 'other-secret'), false);
  assert.equal(await profileCookieValid(v.slice(0, -2) + 'xx', 'user_01ABC', SECRET), false);
  assert.equal(await profileCookieValid(undefined, 'user_01ABC', SECRET), false);
  assert.equal(await profileCookieValid(v, 'user_01ABC', undefined), false);
});

test('the gate is on unless KYC_GATE is exactly off', () => {
  assert.equal(kycGateEnabled(undefined), true);
  assert.equal(kycGateEnabled('on'), true);
  assert.equal(kycGateEnabled('off'), false);
});

test('signed-in app pages are gated', () => {
  for (const p of ['/', '/new', '/settings', '/settings/billing', '/portal/abc', '/portal/abc/submit']) {
    assert.equal(isGatedPage(p), true, p);
  }
});

test('the welcome page, APIs, auth pages, invites, pricing and static files are not', () => {
  for (const p of [
    '/welcome', '/api/welcome', '/api/me', '/ingest/e/', '/login', '/signup', '/invite/tok',
    '/forgot-password', '/reset-password', '/verify-email', '/pricing',
    '/stiko-tracking.js', '/icon.svg', '/_next/static/x.js',
  ]) {
    assert.equal(isGatedPage(p), false, p);
  }
});

test('the welcome match is exact or a path segment, not a prefix', () => {
  assert.equal(isGatedPage('/welcomes'), true);
  assert.equal(isGatedPage('/welcome/x'), false);
});

test('the redirect keeps the full destination, query included', () => {
  assert.equal(welcomeRedirectPath('/portal/abc', '?file=f1'), '/welcome?callbackUrl=%2Fportal%2Fabc%3Ffile%3Df1');
  assert.equal(welcomeRedirectPath('/', ''), '/welcome?callbackUrl=%2F');
});
