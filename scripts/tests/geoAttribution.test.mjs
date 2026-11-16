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

test('a touch cookie already decoded by Next keeps "%" and escape-like values intact', () => {
  const decoded = JSON.stringify({
    utm_content: '50% off',
    referrer: 'https://x.com/a%20b',
  });
  const t = parseTouchCookie(decoded);
  assert.notEqual(t, null);
  assert.equal(t.utm_content, '50% off');
  // A path keeps its escapes (query strings are re-serialised by the URL scrubber, so the
  // check is on the path: the cookie value must not be percent-decoded a second time).
  assert.equal(t.referrer, 'https://x.com/a%20b');
});

test('a percent-encoded touch cookie still parses (the encoded form is accepted too)', () => {
  const t = parseTouchCookie(encodeURIComponent(JSON.stringify({ utm_source: 'meta', utm_content: '50% off' })));
  assert.equal(t.utm_source, 'meta');
  assert.equal(t.utm_content, '50% off');
});

test('a percent-encoded non-whitelisted touch cookie still returns null', () => {
  assert.equal(parseTouchCookie(encodeURIComponent(JSON.stringify({ evil: 'x' }))), null);
});

test('a whitespace-only country fails closed', () => {
  assert.equal(consentRequired(' '), true);
  assert.equal(consentRequired('\t'), true);
});

test('every ISO code in the consent set is recognised', () => {
  const codes = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    'IS', 'LI', 'NO', 'GB', 'CH',
  ];
  assert.equal(codes.length, 32);
  for (const c of codes) assert.equal(consentRequired(c), true, c);
});

// ---- credentials and personal data never ride along in attribution values ----
// landing_page and referrer go through the same allowlist scrubber as PostHog events
// (lib/analytics/scrub.ts): token segments become [token], only UTM / click-id / billing / tab
// query keys survive, fragments and user:password@ are dropped.

const TOKEN = '7c9e2b1a4d5f60718293a4b5c6d7e8f9';
const touchWith = (fields) => parseTouchCookie(JSON.stringify(fields));

test('an invite link a social app appended ?fbclid to keeps its click id but loses the token', () => {
  const t = touchWith({ landing_page: `/invite/${TOKEN}?x=1`, utm_source: 'meta' });
  assert.equal(t.landing_page, '/invite/[token]');
  assert.equal(t.utm_source, 'meta');
  const full = touchWith({ landing_page: `https://app.stiko.design/invite/${TOKEN}?fbclid=IwAR0abc#top` });
  assert.equal(full.landing_page, 'https://app.stiko.design/invite/[token]?fbclid=IwAR0abc');
});

test('an app invite URL in the referrer loses the token', () => {
  const t = touchWith({ referrer: 'https://app.stiko.design/invite/abc' });
  assert.equal(t.referrer, 'https://app.stiko.design/invite/[token]');
});

test('/verify-email?email=… loses the email address', () => {
  const t = touchWith({ landing_page: '/verify-email?email=a@b.co', referrer: 'https://app.stiko.design/verify-email?email=a%40b.co&callbackUrl=%2Fdashboard' });
  assert.equal(t.landing_page, '/verify-email');
  assert.equal(t.referrer, 'https://app.stiko.design/verify-email');
  assert.ok(!JSON.stringify(t).includes('a@b.co') && !JSON.stringify(t).includes('a%40b.co'));
});

test('/reset-password/<token> loses the token', () => {
  const t = touchWith({ landing_page: '/reset-password/abc', referrer: 'https://app.stiko.design/reset-password/abc123?x=1' });
  assert.equal(t.landing_page, '/reset-password/[token]');
  assert.equal(t.referrer, 'https://app.stiko.design/reset-password/[token]');
});

test('a percent-encoded invite path (the /login?callbackUrl=… redirect) loses the token: the whole callbackUrl goes', () => {
  const t = touchWith({ landing_page: `https://app.stiko.design/login?callbackUrl=%2Finvite%2F${TOKEN}&x=1` });
  assert.equal(t.landing_page, 'https://app.stiko.design/login');
  const lower = touchWith({ landing_page: `/login?callbackUrl=%2finvite%2f${TOKEN}` });
  assert.equal(lower.landing_page, '/login');
});

test('a token route inside an allowed query value is still redacted', () => {
  const t = touchWith({ landing_page: `/pricing?utm_content=%2Finvite%2F${TOKEN}&utm_source=x` });
  assert.ok(!t.landing_page.includes(TOKEN), t.landing_page);
  assert.equal(t.landing_page, '/pricing?utm_content=%2Finvite%2F%5Btoken%5D&utm_source=x');
});

test('every invite path in a value is redacted, not just the first', () => {
  const t = touchWith({ landing_page: `/invite/${TOKEN}?utm_content=/invite/other` });
  assert.equal(t.landing_page, '/invite/[token]?utm_content=%2Finvite%2F%5Btoken%5D');
});

test('fragments and user:password@ are dropped from both URL fields', () => {
  const t = touchWith({ landing_page: 'https://user:pw@www.stiko.design/pricing#access_token=xyz', referrer: 'https://www.stiko.design/#frag' });
  assert.equal(t.landing_page, 'https://www.stiko.design/pricing');
  assert.equal(t.referrer, 'https://www.stiko.design/');
});

test('allowlisted campaign keys survive in a URL field; everything else goes', () => {
  const t = touchWith({ referrer: 'https://www.google.com/search?q=secret+plan&utm_source=news&gclid=G1&email=a@b.co' });
  assert.equal(t.referrer, 'https://www.google.com/search?utm_source=news&gclid=G1');
});

test('clean paths, other fields and near-miss paths are left alone', () => {
  const same = [
    'https://www.stiko.design/',
    '/pricing?utm_source=x',
    'https://www.stiko.design/invite-friends',
    'https://www.stiko.design/invitees/abc',
    '/invite',
    '/invite/',
    '/signup',
    'android-app://com.google.android.gm/',
  ];
  for (const v of same) {
    const t = touchWith({ landing_page: v, referrer: v });
    assert.equal(t.landing_page, v, v);
    assert.equal(t.referrer, v, v);
  }
  // Only landing_page and referrer are URLs. Campaign labels are stored as typed.
  const other = touchWith({ utm_content: '/invite/abc', utm_campaign: 'invite', utm_term: '/verify-email?email=a@b.co' });
  assert.equal(other.utm_content, '/invite/abc');
  assert.equal(other.utm_campaign, 'invite');
  assert.equal(other.utm_term, '/verify-email?email=a@b.co');
});

test('the URL is scrubbed before the length cap, so a long URL cannot leave a half token behind', () => {
  const t = touchWith({ landing_page: `https://app.stiko.design/${'a'.repeat(170)}/invite/${'f'.repeat(64)}` });
  assert.ok(!t.landing_page.includes('ffff'), t.landing_page);
  assert.ok(t.landing_page.length <= 200);
  const near = touchWith({ landing_page: `https://app.stiko.design/${'a'.repeat(150)}/invite/${'f'.repeat(64)}` });
  assert.ok(near.landing_page.endsWith('/invite/[token]'), near.landing_page);
  // A long query of non-allowlisted keys is dropped whole, not truncated into the output.
  const q = touchWith({ referrer: `https://www.stiko.design/verify-email?email=${'x'.repeat(300)}@b.co` });
  assert.equal(q.referrer, 'https://www.stiko.design/verify-email');
});
