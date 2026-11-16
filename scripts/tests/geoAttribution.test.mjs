import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consentRequired, consentValue, analyticsConsentAtSignup, analyticsAllowed } from '../../lib/geo.ts';
import { parseTouchCookie, signupSource, inviteTokenFromCallback, clickIds } from '../../lib/attribution.ts';

test('EU, EEA, UK and Switzerland need consent; North America does not', () => {
  for (const c of ['DE', 'FR', 'IE', 'IS', 'NO', 'LI', 'GB', 'CH', 'de']) assert.equal(consentRequired(c), true, c);
  for (const c of ['US', 'CA', 'MX', 'AU', 'IN']) assert.equal(consentRequired(c), false, c);
});

test('an unknown country fails closed', () => {
  assert.equal(consentRequired(null), true);
  assert.equal(consentRequired(''), true);
  assert.equal(consentRequired(undefined), true);
});

test('only the two known consent values are read', () => {
  assert.equal(consentValue('granted'), 'granted');
  assert.equal(consentValue('denied'), 'denied');
  assert.equal(consentValue('yes'), null);
  assert.equal(consentValue(undefined), null);
});

test('consent at signup: cookie wins, else pending in consent countries, else null', () => {
  assert.equal(analyticsConsentAtSignup('granted', 'DE'), 'granted');
  assert.equal(analyticsConsentAtSignup('denied', 'US'), 'denied');
  assert.equal(analyticsConsentAtSignup(undefined, 'DE'), 'pending');
  assert.equal(analyticsConsentAtSignup(undefined, 'US'), null);
});

test('server events are allowed only for granted or never-asked users', () => {
  assert.equal(analyticsAllowed(null), true);
  assert.equal(analyticsAllowed('granted'), true);
  assert.equal(analyticsAllowed('denied'), false);
  assert.equal(analyticsAllowed('pending'), false);
});

test('a touch cookie is parsed, whitelisted and capped', () => {
  const raw = encodeURIComponent(JSON.stringify({
    utm_source: 'meta', utm_campaign: '2026-11_meta_pd_trial', gclid: 'AbC',
    landing_page: '/solutions', referrer: 'https://l.facebook.com/', ts: '2026-11-15T10:00:00.000Z',
    evil: 'x', utm_term: 'y'.repeat(500),
  }));
  const t = parseTouchCookie(raw);
  assert.equal(t.utm_source, 'meta');
  assert.equal(t.gclid, 'AbC');
  assert.equal(t.evil, undefined);
  assert.equal(t.utm_term.length, 200);
  assert.equal(parseTouchCookie('not json'), null);
  assert.equal(parseTouchCookie(undefined), null);
  assert.equal(parseTouchCookie(encodeURIComponent('[1,2]')), null);
});

test('an invite token makes the signup a reviewer_invite, whatever the UTMs', () => {
  assert.equal(signupSource('abc'), 'reviewer_invite');
  assert.equal(signupSource(''), 'direct');
  assert.equal(signupSource(null), 'direct');
});

test('the invite token is recovered from a /signup callbackUrl', () => {
  assert.equal(inviteTokenFromCallback('/invite/7c9e6679-7425-40de-944b-e07fc1f90ae7'), '7c9e6679-7425-40de-944b-e07fc1f90ae7');
  assert.equal(inviteTokenFromCallback('/invite/abc?x=1'), 'abc');
  assert.equal(inviteTokenFromCallback('/portal/abc'), null);
  assert.equal(inviteTokenFromCallback(null), null);
});

test('click ids merge last touch over first touch, plus Meta and GA cookies', () => {
  const ids = clickIds({
    first: { gclid: 'g1', fbclid: 'f1' }, last: { gclid: 'g2' },
    fbc: 'fb.1.123.f1', fbp: 'fb.1.456', ga: 'GA1.1.111.222',
  });
  assert.deepEqual(ids, { gclid: 'g2', fbclid: 'f1', fbc: 'fb.1.123.f1', fbp: 'fb.1.456', ga: 'GA1.1.111.222' });
  assert.deepEqual(clickIds({ first: null, last: null }), {});
});
