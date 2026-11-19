import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signProfileCookie, profileCookieValid, profileCookieHeader, PROFILE_COOKIE } from '../../lib/kyc/profileCookie.ts';
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

// WorkOS's refreshed session cookie is appended to the response headers AFTER
// the NextResponse is built. NextResponse.cookies.set() rewrites Set-Cookie from
// its construction-time snapshot, which silently DROPS that cookie (verified on
// next@14.2.35) and logs the user out on the next refresh. The profile cookie is
// therefore appended as a raw header, which leaves existing Set-Cookie alone.
test('the profile Set-Cookie header carries the cookie with the right attributes', () => {
  const h = profileCookieHeader('user_01ABC.sig-_x', true);
  assert.equal(h.startsWith(`${PROFILE_COOKIE}=user_01ABC.sig-_x; `), true);
  for (const attr of ['Path=/', 'Max-Age=31536000', 'HttpOnly', 'SameSite=Lax', 'Secure']) {
    assert.equal(h.split('; ').includes(attr), true, `missing ${attr} in ${h}`);
  }
  assert.equal(profileCookieHeader('v', false).split('; ').includes('Secure'), false);
});

test('appending the profile cookie keeps a Set-Cookie already on the response', () => {
  const res = new Response(null);
  res.headers.append('set-cookie', 'wos-session=abc; Path=/; HttpOnly');
  res.headers.append('set-cookie', profileCookieHeader('v', true));
  const all = res.headers.getSetCookie();
  assert.equal(all.length, 2);
  assert.equal(all[0], 'wos-session=abc; Path=/; HttpOnly');
});

import { ONBOARDING_VERSION } from '../../lib/kyc/gate.ts';

test('the profile cookie is versioned: a v1 cookie no longer passes', async () => {
  const SECRET_V = 's3cret';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET_V), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('stiko-profile:user_01ABC')));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  const v1 = `user_01ABC.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  assert.equal(await profileCookieValid(v1, 'user_01ABC', SECRET_V), false);
  assert.equal(await profileCookieValid(await signProfileCookie('user_01ABC', SECRET_V), 'user_01ABC', SECRET_V), true);
  assert.equal(ONBOARDING_VERSION, 2);
});
