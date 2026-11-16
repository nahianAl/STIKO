import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PILLARS, BUSINESS_TYPES, CLIENT_MODELS, SIZE_BANDS, ROLES } from '../../lib/kyc/catalog.ts';
import {
  validateProfile, trackForSize, businessTypesFor, isOtherSegment, isBusinessEmail,
} from '../../lib/kyc/profile.ts';

const VALID = {
  pillar: 'PD', segmentId: 'PD-07', clientModel: 'clients',
  companySizeBand: '25-49', role: 'engineer', marketingConsent: false,
};

test('every business type ID is unique and belongs to its pillar prefix', () => {
  const ids = BUSINESS_TYPES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of BUSINESS_TYPES) assert.equal(b.id.slice(0, 2), b.pillar, b.id);
});

test('every pillar has exactly 10 business types plus one Other', () => {
  assert.deepEqual(PILLARS.map((p) => p.id), ['ID', 'PD', 'AC', 'GV']);
  for (const p of PILLARS) {
    const types = businessTypesFor(p.id);
    assert.equal(types.length, 11, p.id);
    assert.equal(types.filter((t) => isOtherSegment(t.id)).length, 1, p.id);
    assert.ok(types.some((t) => t.id === `${p.id}-99`), p.id);
  }
});

test('every option has a non-empty label', () => {
  for (const o of [...PILLARS, ...BUSINESS_TYPES, ...CLIENT_MODELS, ...SIZE_BANDS, ...ROLES]) {
    assert.ok(o.label.trim().length > 0, o.id);
  }
});

test('company size maps to the four tracks', () => {
  assert.equal(trackForSize('just_me'), 'prosumer');
  assert.equal(trackForSize('2-4'), 'small_team');
  for (const b of ['5-9', '10-24', '25-49']) assert.equal(trackForSize(b), 'mid_team', b);
  for (const b of ['50-99', '100-249', '250+']) assert.equal(trackForSize(b), 'large_team', b);
  assert.equal(trackForSize('1-4'), null);
  for (const b of SIZE_BANDS) assert.ok(trackForSize(b.id), b.id);
});

test('a complete, consistent answer set validates', () => {
  const r = validateProfile(VALID);
  assert.equal(r.ok, true);
  assert.deepEqual(r.answers, { ...VALID, businessTypeOther: null });
});

test('each field is checked against the catalog', () => {
  for (const [field, value] of [
    ['pillar', 'XX'], ['segmentId', 'PD-42'], ['clientModel', 'agency'],
    ['companySizeBand', '1-4'], ['role', 'ceo'],
  ]) {
    const r = validateProfile({ ...VALID, [field]: value });
    assert.deepEqual(r, { ok: false, field }, field);
  }
  assert.deepEqual(validateProfile(null), { ok: false, field: 'pillar' });
});

test('a business type from another pillar is refused', () => {
  assert.deepEqual(validateProfile({ ...VALID, segmentId: 'AC-06' }), { ok: false, field: 'segmentId' });
});

test('Other needs its free text, trimmed and at most 120 chars', () => {
  const other = { ...VALID, segmentId: 'PD-99' };
  assert.deepEqual(validateProfile(other), { ok: false, field: 'businessTypeOther' });
  assert.deepEqual(validateProfile({ ...other, businessTypeOther: '   ' }), { ok: false, field: 'businessTypeOther' });
  assert.deepEqual(validateProfile({ ...other, businessTypeOther: 'x'.repeat(121) }), { ok: false, field: 'businessTypeOther' });
  const ok = validateProfile({ ...other, businessTypeOther: '  Boat builder ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.answers.businessTypeOther, 'Boat builder');
});

test('free text on a non-Other type is dropped', () => {
  const r = validateProfile({ ...VALID, businessTypeOther: 'ignored' });
  assert.equal(r.answers.businessTypeOther, null);
});

test('marketing consent is true only when explicitly true', () => {
  assert.equal(validateProfile({ ...VALID, marketingConsent: 'true' }).answers.marketingConsent, false);
  assert.equal(validateProfile({ ...VALID, marketingConsent: true }).answers.marketingConsent, true);
});

test('free-mail domains are not business email, case-insensitively', () => {
  for (const e of ['a@gmail.com', 'A@GMAIL.COM', 'b@outlook.com', 'c@icloud.com', 'd@yahoo.ca', 'e@shaw.ca', 'f@proton.me']) {
    assert.equal(isBusinessEmail(e), false, e);
  }
  assert.equal(isBusinessEmail('dana@acme-design.com'), true);
  assert.equal(isBusinessEmail('not-an-email'), false);
});
