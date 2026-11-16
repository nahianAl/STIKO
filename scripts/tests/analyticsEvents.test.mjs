import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapture, buildGroupIdentify, stripForbidden, toBatchPayload, billingTransitionEvents,
  ANONYMOUS_CONTEXT, extensionOf,
} from '../../lib/analytics/events.ts';

const CTX = { workspaceId: 'ws_1', segmentId: 'PD-07', track: 'mid_team', analyticsConsent: null };

test('every event carries the four standard properties and the workspace group', () => {
  const row = buildCapture({ event: 'project_created', distinctId: 'u1', userId: 'u1', context: CTX, properties: { project_id: 'p1' } }, 'uuid-1');
  assert.deepEqual(row, {
    uuid: 'uuid-1', event: 'project_created', distinctId: 'u1',
    properties: {
      project_id: 'p1', user_id: 'u1', workspace_id: 'ws_1', segment_id: 'PD-07', track: 'mid_team',
      $groups: { workspace: 'ws_1' }, $lib: 'stiko-server',
    },
  });
});

test('standard properties cannot be overridden by the caller', () => {
  const row = buildCapture({ event: 'x', distinctId: 'u1', userId: 'u1', context: CTX, properties: { segment_id: 'GV-01', user_id: 'other' } }, 'u');
  assert.equal(row.properties.segment_id, 'PD-07');
  assert.equal(row.properties.user_id, 'u1');
});

test('before KYC the segment and track read unknown, and no group is sent without a workspace', () => {
  const row = buildCapture({ event: 'review_link_opened', distinctId: 'anon-1', userId: null, context: ANONYMOUS_CONTEXT }, 'u');
  assert.equal(row.properties.segment_id, 'unknown');
  assert.equal(row.properties.track, 'unknown');
  assert.equal(row.properties.workspace_id, null);
  assert.equal('$groups' in row.properties, false);
});

test('denied or pending consent suppresses the event entirely', () => {
  for (const analyticsConsent of ['denied', 'pending']) {
    assert.equal(buildCapture({ event: 'x', distinctId: 'u1', userId: 'u1', context: { ...CTX, analyticsConsent } }, 'u'), null);
  }
});

test('person properties ride along as $set and $set_once', () => {
  const row = buildCapture({ event: 'x', distinctId: 'u1', userId: 'u1', context: CTX, set: { role: 'engineer' }, setOnce: { first_utm_source: 'meta' } }, 'u');
  assert.deepEqual(row.properties.$set, { role: 'engineer' });
  assert.deepEqual(row.properties.$set_once, { first_utm_source: 'meta' });
});

test('names, emails, filenames and tokens are stripped from properties', () => {
  assert.deepEqual(
    stripForbidden({ file_id: 'f', filename: 'secret.step', email: 'a@b.c', name: 'Dana', project_name: 'X', package_name: 'Y', token: 't', body: 'c', extension: 'step' }),
    { file_id: 'f', extension: 'step' }
  );
  const row = buildCapture({ event: 'x', distinctId: 'u1', userId: 'u1', context: CTX, properties: { filename: 'a.pdf' }, set: { email: 'a@b.c', role: 'engineer' } }, 'u');
  assert.equal(row.properties.filename, undefined);
  assert.deepEqual(row.properties.$set, { role: 'engineer' });
});

test('$groupidentify names the workspace group and its properties', () => {
  assert.deepEqual(buildGroupIdentify('ws_1', 'u1', { pillar: 'PD' }, 'u'), {
    uuid: 'u', event: '$groupidentify', distinctId: 'u1',
    properties: { $group_type: 'workspace', $group_key: 'ws_1', $group_set: { pillar: 'PD' }, $lib: 'stiko-server' },
  });
});

test('the batch payload carries uuid and timestamp for dedupe', () => {
  const p = toBatchPayload('phc_x', [{ uuid: 'u', event: 'e', distinctId: 'd', properties: { a: 1 }, createdAt: '2026-11-15T00:00:00.000Z' }]);
  assert.deepEqual(p, { api_key: 'phc_x', batch: [{ uuid: 'u', event: 'e', distinct_id: 'd', properties: { a: 1 }, timestamp: '2026-11-15T00:00:00.000Z' }] });
});

test('billing events fire on entering trialing or active, never on repeats', () => {
  assert.deepEqual(billingTransitionEvents(null, 'active'), ['subscription_started']);
  assert.deepEqual(billingTransitionEvents('canceled', 'active'), ['subscription_started']);
  assert.deepEqual(billingTransitionEvents(null, 'trialing'), ['trial_started']);
  assert.deepEqual(billingTransitionEvents('trialing', 'active'), ['subscription_started']);
  assert.deepEqual(billingTransitionEvents('active', 'active'), []);
  assert.deepEqual(billingTransitionEvents('past_due', 'active'), []);
  assert.deepEqual(billingTransitionEvents('active', 'canceled'), []);
});

test('extension is lowercased and dotless', () => {
  assert.equal(extensionOf('Part.STEP'), 'step');
  assert.equal(extensionOf('noext'), '');
});
