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

test('a known file type comes out lowercased and dotless', () => {
  assert.equal(extensionOf('Part.STEP'), 'step');
  assert.equal(extensionOf('drawing.DWG'), 'dwg');
  assert.equal(extensionOf('part.sldprt'), 'sldprt');
  assert.equal(extensionOf('noext'), '');
  assert.equal(extensionOf('.gitignore'), '');
  assert.equal(extensionOf('trailing.'), '');
  assert.equal(extensionOf(''), '');
});

test('an unknown extension is "other", never the text itself', () => {
  assert.equal(extensionOf('archive.tar.gz'), 'other');
  assert.equal(extensionOf('Rev 2.Dana'), 'other');
  assert.equal(extensionOf('Rev 2. Dana Smith final'), 'other');
  assert.equal(extensionOf('Acme v1.2'), 'other');
  assert.equal(extensionOf('Acme Pump v1.2 draft'), 'other');
  assert.equal(extensionOf('Client X (confidential).step v2'), 'other');
  assert.equal(extensionOf('name.with-dash'), 'other');
  assert.equal(extensionOf('weird.verylongextension'), 'other');
  assert.equal(extensionOf('name.ünï'), 'other');
  assert.equal(extensionOf('x.constructor'), 'other');
  assert.equal(extensionOf('x.toString'), 'other');
});

test('billing recoveries (past_due, unpaid, paused to active) are not new subscriptions', () => {
  for (const prev of ['past_due', 'unpaid', 'paused']) {
    assert.deepEqual(billingTransitionEvents(prev, 'active'), [], `${prev} -> active`);
  }
});

test('billing: incomplete, expired and canceled states entering active still start a subscription', () => {
  for (const prev of ['incomplete', 'incomplete_expired', 'canceled', null]) {
    assert.deepEqual(billingTransitionEvents(prev, 'active'), ['subscription_started'], `${prev} -> active`);
  }
});

test('billing: repeats and exits fire nothing', () => {
  assert.deepEqual(billingTransitionEvents('trialing', 'trialing'), []);
  assert.deepEqual(billingTransitionEvents('active', null), []);
  assert.deepEqual(billingTransitionEvents(null, null), []);
  assert.deepEqual(billingTransitionEvents('active', 'past_due'), []);
});

test('stripForbidden removes PostHog-reserved keys a caller must not inject', () => {
  const out = stripForbidden({
    file_id: 'f', $set: { email: 'a@b.c', name: 'Dana' }, $set_once: { x: 1 }, $groups: { workspace: 'evil' },
    $lib: 'x', distinct_id: 'other', $group_type: 't', $group_key: 'k', $group_set: { a: 1 },
  });
  assert.deepEqual(out, { file_id: 'f' });
});

test('a caller $set / $groups / $lib inside properties never reaches the capture', () => {
  const row = buildCapture({
    event: 'x', distinctId: 'u1', userId: 'u1', context: CTX,
    properties: { $set: { email: 'a@b.c', name: 'Dana' }, $groups: { workspace: 'evil' }, $lib: 'evil', distinct_id: 'other' },
  }, 'u');
  assert.equal(row.properties.$set, undefined);
  assert.deepEqual(row.properties.$groups, { workspace: 'ws_1' });
  assert.equal(row.properties.$lib, 'stiko-server');
  assert.equal('distinct_id' in row.properties, false);
});

test('a caller $groups is removed even when the context has no workspace', () => {
  const row = buildCapture({
    event: 'x', distinctId: 'a1', userId: null, context: ANONYMOUS_CONTEXT,
    properties: { $groups: { workspace: 'evil' }, $set: { email: 'a@b.c' } },
  }, 'u');
  assert.equal('$groups' in row.properties, false);
  assert.equal('$set' in row.properties, false);
});

test('person properties passed via set are still stripped, and reserved keys inside them dropped', () => {
  const row = buildCapture({
    event: 'x', distinctId: 'u1', userId: 'u1', context: CTX,
    set: { role: 'engineer', email: 'a@b.c', $groups: { workspace: 'evil' } },
  }, 'u');
  assert.deepEqual(row.properties.$set, { role: 'engineer' });
});

test('forbidden keys are matched case-insensitively and by pattern', () => {
  const dirty = {
    Email: 'a@b.c', EMAIL: 'a@b.c', fileName: 'x.step', FileName: 'x', filename: 'x', first_name: 'Dana', last_name: 'S',
    full_name: 'Dana S', display_name: 'D', text: 't', message: 'm', title: 't', Body: 'b', comment: 'c', note: 'n',
    user_email: 'a@b.c', company_name: 'Acme', workspace_name: 'W', invite_token: 'tok', share_token: 'tok',
    userEmail: 'a@b.c', projectName: 'P', Token: 't', Name: 'n',
  };
  assert.deepEqual(stripForbidden({ ...dirty, file_id: 'f' }), { file_id: 'f' });
});

test('is_ flags survive even when they end in a forbidden word', () => {
  assert.deepEqual(stripForbidden({ is_business_email: true, is_named: false, email: 'a@b.c' }), { is_business_email: true, is_named: false });
});

test('every legitimate Stiko property key survives stripping', () => {
  const keep = {
    marketing_consent: true, signup_source: 'google', segment_id: 'PD-07', track: 'mid_team', invite_id: 'i1',
    inviter_workspace_id: 'ws_2', first_utm_campaign: 'c', reason_code: 'r', extension: 'step', size_bytes: 10,
    project_id: 'p', file_id: 'f', workspace_id: 'ws', user_id: 'u', role: 'engineer', pillar: 'PD',
    company_size_band: '11-50', client_model: 'agency', country: 'DE', region: 'BY',
  };
  assert.deepEqual(stripForbidden({ ...keep }), keep);
});

test('forbidden keys nested one level deep are stripped, not passed through', () => {
  assert.deepEqual(stripForbidden({ meta: { filename: 'x', size_bytes: 3, Email: 'a@b.c' } }), { meta: { size_bytes: 3 } });
  assert.deepEqual(stripForbidden({ meta: { filename: 'x' } }), { meta: {} });
});

test('objects nested two levels deep, and objects inside arrays, are dropped entirely', () => {
  assert.deepEqual(stripForbidden({ a: { b: { filename: 'x', ok: 1 }, keep: 1 } }), { a: { keep: 1 } });
  assert.deepEqual(stripForbidden({ list: [{ email: 'a@b.c' }], tags: ['a', 'b'], n: 1 }), { tags: ['a', 'b'], n: 1 });
  assert.deepEqual(stripForbidden({ a: { list: [{ filename: 'x' }], tags: ['a'] } }), { a: { tags: ['a'] } });
});

test('stripForbidden does not mutate its input and tolerates a __proto__ key', () => {
  const input = { meta: { filename: 'x' }, email: 'a@b.c' };
  stripForbidden(input);
  assert.deepEqual(input, { meta: { filename: 'x' }, email: 'a@b.c' });
  const evil = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
  const out = stripForbidden(evil);
  assert.equal(out.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(out.ok, 1);
});

test('$group_set passes through the same stripping', () => {
  const row = buildGroupIdentify('ws_1', 'u1', { pillar: 'PD', workspace_name: 'Acme', $groups: {}, meta: { email: 'a@b.c' } }, 'u');
  assert.deepEqual(row.properties.$group_set, { pillar: 'PD', meta: {} });
});
