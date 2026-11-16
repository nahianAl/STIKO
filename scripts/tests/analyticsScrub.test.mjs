import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropPageTitle, sanitizeEvent, scrubEvent, scrubUrl } from '../../lib/analytics/scrub.ts';

const TOKEN = 'k3J9xQ2mZpLw8RtYv1NaBcDe';
const APP = 'https://app.stiko.design';

// ---- scrubUrl: paths ----

test('an invite token in the path is replaced', () => {
  assert.equal(scrubUrl(`${APP}/invite/${TOKEN}`), `${APP}/invite/[token]`);
  assert.equal(scrubUrl(`/invite/${TOKEN}`), '/invite/[token]');
});

test('a reset-password token in the path is replaced', () => {
  assert.equal(scrubUrl(`${APP}/reset-password/abc123`), `${APP}/reset-password/[token]`);
  assert.equal(scrubUrl('/reset-password/abc123'), '/reset-password/[token]');
});

test('a token route deeper in the path (the API) is replaced too', () => {
  assert.equal(scrubUrl(`${APP}/api/invite/${TOKEN}/accept`), `${APP}/api/invite/[token]/accept`);
});

test('portal, project and file IDs are allowed and kept', () => {
  const url = `${APP}/portal/7c9e6679-7425-40de-944b-e07fc1f90ae7/file/42`;
  assert.equal(scrubUrl(url), url);
  assert.equal(scrubUrl(`${APP}/`), `${APP}/`);
});

test('look-alike routes are not touched', () => {
  assert.equal(scrubUrl('https://www.stiko.design/invite-friends'), 'https://www.stiko.design/invite-friends');
  assert.equal(scrubUrl('/reinvite/abc'), '/reinvite/abc');
});

// ---- scrubUrl: query string and fragment ----

test('verify-email loses the email address (and every other non-allowlisted key)', () => {
  assert.equal(scrubUrl(`${APP}/verify-email?email=a%40b.co&callbackUrl=%2Fdashboard`), `${APP}/verify-email`);
  assert.equal(scrubUrl('/verify-email?email=a@b.co'), '/verify-email');
});

test('a callbackUrl carrying an invite token is dropped, in either spelling', () => {
  assert.equal(scrubUrl(`${APP}/login?callbackUrl=%2Finvite%2F${TOKEN}`), `${APP}/login`);
  assert.equal(scrubUrl(`/signup?callbackUrl=/invite/${TOKEN}&utm_source=x`), '/signup?utm_source=x');
});

test('the allowlisted keys are kept, in order; everything else goes', () => {
  const kept =
    'utm_source=news&utm_medium=email&utm_campaign=fall&utm_content=hero&utm_term=cad' +
    '&gclid=G1&fbclid=F1&ttclid=T1&billing=success&tab=packages';
  assert.equal(scrubUrl(`${APP}/dashboard?${kept}&email=a%40b.co&token=zzz`), `${APP}/dashboard?${kept}`);
});

test('a token route percent-encoded inside an allowed value is redacted (single and double encoding)', () => {
  assert.equal(
    scrubUrl(`/pricing?utm_content=%2Finvite%2F${TOKEN}`),
    '/pricing?utm_content=%2Finvite%2F%5Btoken%5D'
  );
  assert.equal(
    scrubUrl('/pricing?utm_content=%252Freset-password%252Fabc123'),
    '/pricing?utm_content=%252Freset-password%252F%5Btoken%5D'
  );
  assert.equal(
    scrubUrl(`/pricing?utm_content=${encodeURIComponent(`${APP}/reset-password/abc123`)}`),
    `/pricing?utm_content=${encodeURIComponent(`${APP}/reset-password/`)}%5Btoken%5D`
  );
});

test('the fragment is dropped', () => {
  assert.equal(scrubUrl(`${APP}/dashboard#access_token=xyz`), `${APP}/dashboard`);
  assert.equal(scrubUrl('/welcome?tab=a#b'), '/welcome?tab=a');
});

test('credentials in the authority are dropped', () => {
  assert.equal(scrubUrl('https://user:pw@app.stiko.design/x?y=1'), 'https://app.stiko.design/x');
});

test('a protocol-relative URL is handled like an absolute one', () => {
  assert.equal(scrubUrl('//app.stiko.design/reset-password/abc123?email=a@b.co'), '//app.stiko.design/reset-password/[token]');
});

test('non-URL strings are left alone', () => {
  for (const s of ['$direct', 'PD-07', 'hello world?email=x#y', 'b1f8c1de-0000-4000-8000-000000000001', '', 'app.stiko.design']) {
    assert.equal(scrubUrl(s), s);
  }
});

test('a token route inside free text is still redacted (defence in depth)', () => {
  assert.equal(scrubUrl(`see /invite/${TOKEN} now`), 'see /invite/[token] now');
});

// ---- scrubEvent: every place posthog-js puts a URL ----

test('every URL property on an event is scrubbed', () => {
  const event = scrubEvent({
    event: '$pageview',
    properties: {
      $current_url: `${APP}/reset-password/abc123`,
      $pathname: '/reset-password/abc123',
      $referrer: `${APP}/verify-email?email=a%40b.co`,
      $session_entry_url: `${APP}/invite/${TOKEN}?fbclid=F1`,
      $session_entry_pathname: `/invite/${TOKEN}`,
      $prev_pageview_pathname: '/reset-password/abc123',
      $referring_domain: 'app.stiko.design',
      $host: 'app.stiko.design',
    },
  });
  assert.deepEqual(event.properties, {
    $current_url: `${APP}/reset-password/[token]`,
    $pathname: '/reset-password/[token]',
    $referrer: `${APP}/verify-email`,
    $session_entry_url: `${APP}/invite/[token]?fbclid=F1`,
    $session_entry_pathname: '/invite/[token]',
    $prev_pageview_pathname: '/reset-password/[token]',
    $referring_domain: 'app.stiko.design',
    $host: 'app.stiko.design',
  });
});

test('$set and $set_once copies ($initial_*) are scrubbed', () => {
  const event = scrubEvent({
    event: '$identify',
    properties: {},
    $set: { $current_url: `${APP}/verify-email?email=a@b.co` },
    $set_once: {
      $initial_current_url: `${APP}/reset-password/abc123`,
      $initial_pathname: `/invite/${TOKEN}`,
      $initial_referrer: `${APP}/login?callbackUrl=%2Finvite%2F${TOKEN}`,
    },
  });
  assert.equal(event.$set.$current_url, `${APP}/verify-email`);
  assert.equal(event.$set_once.$initial_current_url, `${APP}/reset-password/[token]`);
  assert.equal(event.$set_once.$initial_pathname, '/invite/[token]');
  assert.equal(event.$set_once.$initial_referrer, `${APP}/login`);
});

test('replay meta and custom-event hrefs are scrubbed', () => {
  const event = scrubEvent({
    event: '$snapshot',
    properties: {
      $snapshot_data: [
        { type: 4, data: { href: `${APP}/reset-password/abc123`, width: 800 } },
        { type: 5, data: { tag: '$url_changed', payload: { href: `${APP}/verify-email?email=a@b.co` } } },
      ],
    },
  });
  assert.equal(event.properties.$snapshot_data[0].data.href, `${APP}/reset-password/[token]`);
  assert.equal(event.properties.$snapshot_data[0].data.width, 800);
  assert.equal(event.properties.$snapshot_data[1].data.payload.href, `${APP}/verify-email`);
});

test('nesting is followed to depth 8; cycles do not hang', () => {
  let deep = { href: '/reset-password/abc123' };
  for (let i = 0; i < 6; i++) deep = { next: deep };
  const event = scrubEvent({ event: 'x', properties: { deep } });
  let node = event.properties.deep;
  while (node.next) node = node.next;
  assert.equal(node.href, '/reset-password/[token]');

  const cyclic = { a: '/invite/abc' };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => scrubEvent({ event: 'x', properties: cyclic }));
  assert.equal(cyclic.a, '/invite/[token]');
});

test('other values and non-string values are left alone', () => {
  const when = new Date('2026-11-15T00:00:00Z');
  const event = scrubEvent({
    event: 'reviewer_signup_prompt_shown',
    properties: {
      $current_url: `${APP}/dashboard?tab=packages`,
      invite_id: 'b1f8c1de-0000-4000-8000-000000000001',
      count: 3,
      flag: true,
      nothing: null,
      when,
    },
  });
  assert.equal(event.properties.$current_url, `${APP}/dashboard?tab=packages`);
  assert.equal(event.properties.invite_id, 'b1f8c1de-0000-4000-8000-000000000001');
  assert.equal(event.properties.count, 3);
  assert.equal(event.properties.flag, true);
  assert.equal(event.properties.nothing, null);
  assert.equal(event.properties.when, when);
});

test('gzip-compressed replay payloads are not rewritten', () => {
  const gz = '\x1f\x8b\x08\x00/invite/abc';
  const event = scrubEvent({ event: '$snapshot', properties: { $snapshot_data: [{ type: 2, data: gz }] } });
  assert.equal(event.properties.$snapshot_data[0].data, gz);
});

test('an event with no properties does not throw', () => {
  assert.doesNotThrow(() => scrubEvent({ event: '$pageview' }));
});

// ---- the page title: today static, but a package name the day a page sets a dynamic one ----

test('the $pageview title (document.title) is removed, as is $title', () => {
  const event = sanitizeEvent({
    event: '$pageview',
    properties: {
      title: 'Bracket assembly rev C - Acme package',
      $title: 'Bracket assembly rev C',
      $current_url: `${APP}/portal/p1`,
      $pathname: '/portal/p1',
    },
  });
  assert.equal('title' in event.properties, false);
  assert.equal('$title' in event.properties, false);
  assert.equal(event.properties.$current_url, `${APP}/portal/p1`);
  assert.equal(event.properties.$pathname, '/portal/p1');
});

test('sanitizeEvent still scrubs URLs, in the same pass', () => {
  const event = sanitizeEvent({
    event: '$pageview',
    properties: { title: 'x', $current_url: `${APP}/invite/${TOKEN}`, $referrer: `${APP}/verify-email?email=a%40b.co` },
  });
  assert.deepEqual(event.properties, { $current_url: `${APP}/invite/[token]`, $referrer: `${APP}/verify-email` });
});

test('dropPageTitle edits in place, leaves other events alone, and tolerates a missing or odd properties', () => {
  const event = { event: '$pageview', properties: { title: 'x', keep: 1 } };
  assert.equal(dropPageTitle(event), event);
  assert.deepEqual(event.properties, { keep: 1 });
  const custom = dropPageTitle({ event: 'plan_viewed', properties: { plan: 'standard' } });
  assert.deepEqual(custom.properties, { plan: 'standard' });
  assert.doesNotThrow(() => dropPageTitle({ event: '$pageview' }));
  assert.doesNotThrow(() => dropPageTitle({ event: '$pageview', properties: null }));
  assert.doesNotThrow(() => dropPageTitle({ event: '$pageview', properties: 'str' }));
  assert.doesNotThrow(() => sanitizeEvent({ event: '$pageview' }));
});
