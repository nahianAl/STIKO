import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubInviteTokens } from '../../lib/analytics/scrub.ts';

const TOKEN = 'k3J9xQ2mZpLw8RtYv1NaBcDe';

test('the page URL and referrer lose the invite token', () => {
  const event = scrubInviteTokens({
    event: '$pageview',
    properties: {
      $current_url: `https://app.stiko.design/invite/${TOKEN}`,
      $pathname: `/invite/${TOKEN}`,
      $referrer: `https://app.stiko.design/invite/${TOKEN}?fbclid=abc`,
      $session_entry_url: `https://app.stiko.design/invite/${TOKEN}`,
    },
  });
  assert.equal(event.properties.$current_url, 'https://app.stiko.design/invite/[token]');
  assert.equal(event.properties.$pathname, '/invite/[token]');
  assert.equal(event.properties.$referrer, 'https://app.stiko.design/invite/[token]?fbclid=abc');
  assert.equal(event.properties.$session_entry_url, 'https://app.stiko.design/invite/[token]');
});

test('a percent-encoded callbackUrl (login and signup redirects) is redacted too', () => {
  const event = scrubInviteTokens({
    event: '$pageview',
    properties: {
      $current_url: `https://app.stiko.design/login?callbackUrl=%2Finvite%2F${TOKEN}`,
      $pathname: '/signup',
    },
  });
  assert.equal(event.properties.$current_url, 'https://app.stiko.design/login?callbackUrl=%2Finvite%2F[token]');
  assert.equal(event.properties.$pathname, '/signup');
});

test('$set and $set_once copies are redacted', () => {
  const event = scrubInviteTokens({
    event: '$identify',
    properties: {},
    $set: { $current_url: `https://app.stiko.design/invite/${TOKEN}` },
    $set_once: { $initial_current_url: `https://app.stiko.design/invite/${TOKEN}`, $initial_pathname: `/invite/${TOKEN}` },
  });
  assert.equal(event.$set.$current_url, 'https://app.stiko.design/invite/[token]');
  assert.equal(event.$set_once.$initial_current_url, 'https://app.stiko.design/invite/[token]');
  assert.equal(event.$set_once.$initial_pathname, '/invite/[token]');
});

test('nested values (replay metadata) are redacted', () => {
  const event = scrubInviteTokens({
    event: '$snapshot',
    properties: {
      $snapshot_data: [{ type: 4, data: { href: `https://app.stiko.design/invite/${TOKEN}`, width: 800 } }],
    },
  });
  assert.equal(event.properties.$snapshot_data[0].data.href, 'https://app.stiko.design/invite/[token]');
  assert.equal(event.properties.$snapshot_data[0].data.width, 800);
});

test('other pages, other values and non-string values are left alone', () => {
  const when = new Date('2026-11-15T00:00:00Z');
  const event = scrubInviteTokens({
    event: 'reviewer_signup_prompt_shown',
    properties: {
      $current_url: 'https://app.stiko.design/dashboard?tab=packages',
      invite_id: 'b1f8c1de-0000-4000-8000-000000000001',
      count: 3,
      flag: true,
      nothing: null,
      when,
    },
  });
  assert.equal(event.properties.$current_url, 'https://app.stiko.design/dashboard?tab=packages');
  assert.equal(event.properties.invite_id, 'b1f8c1de-0000-4000-8000-000000000001');
  assert.equal(event.properties.count, 3);
  assert.equal(event.properties.flag, true);
  assert.equal(event.properties.nothing, null);
  assert.equal(event.properties.when, when);
});

test('an event with no properties does not throw', () => {
  assert.doesNotThrow(() => scrubInviteTokens({ event: '$pageview' }));
});
