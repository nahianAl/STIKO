import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_FORM, withIndustry, withCompanySize, toRequestBody, firstInvalidField, FIELD_ERRORS, fieldDomId,
} from '../../lib/kyc/form.ts';
import { toggleValue, moveValue, visibleOptions, nextActive } from '../../lib/kyc/combo.ts';

const FILLED = {
  ...EMPTY_FORM, website: 'acme.com', industry: 'MFG', markets: ['MK-15'], clientModel: 'CM-3',
  companySize: 'CS-04', reviewTeamSize: 'RT-03', role: 'RL-33', reviewers: ['rv-customers'],
  fileTypes: ['FT-STEP'],
};

test('changing industry clears role and reviewers, and a client model it does not offer', () => {
  const v = withIndustry(FILLED, 'INT');
  assert.equal(v.industry, 'INT');
  assert.equal(v.role, '');
  assert.deepEqual(v.reviewers, []);
  assert.equal(v.clientModel, '');
  const keep = withIndustry({ ...FILLED, clientModel: 'CM-1' }, 'INT');
  assert.equal(keep.clientModel, 'CM-1');
  assert.equal(withIndustry(FILLED, 'MFG'), FILLED);
  assert.equal(withIndustry({ ...FILLED, industry: 'OTH', industryOtherText: 'x' }, 'PRD').industryOtherText, '');
});

test('changing company size clears a review-team band that no longer fits', () => {
  assert.equal(withCompanySize(FILLED, 'CS-02').reviewTeamSize, '');
  assert.equal(withCompanySize(FILLED, 'CS-08').reviewTeamSize, 'RT-03');
});

test('toRequestBody sends only what each kind needs', () => {
  const full = toRequestBody(FILLED, 'full');
  assert.equal(full.kind, 'full');
  assert.equal(full.role, 'RL-33');
  assert.equal(full.industry, 'MFG');
  assert.equal(full.marketingConsent, false);
  assert.equal(full.industryOtherText, undefined);
  const role = toRequestBody(FILLED, 'role');
  assert.equal(role.industry, undefined);
  assert.equal(role.role, 'RL-33');
  const company = toRequestBody(FILLED, 'company');
  assert.equal(company.role, undefined);
  assert.equal(company.marketingConsent, undefined);
  assert.equal(company.industry, 'MFG');
});

test('firstInvalidField mirrors the server', () => {
  assert.equal(firstInvalidField(FILLED, 'full'), null);
  assert.equal(firstInvalidField(EMPTY_FORM, 'full'), 'website');
  assert.equal(firstInvalidField({ ...FILLED, role: '' }, 'full'), 'role');
  assert.equal(firstInvalidField({ ...FILLED, role: '' }, 'company'), null);
  assert.equal(firstInvalidField({ ...EMPTY_FORM, role: 'RL-40' }, 'role'), null);
  assert.equal(firstInvalidField({ ...EMPTY_FORM, role: 'RL-99' }, 'role'), 'roleOtherText');
  assert.equal(firstInvalidField({ ...FILLED, website: '', noWebsite: true }, 'full'), null);
});

test('every field has an error message and a DOM id', () => {
  for (const f of ['website', 'industry', 'industryOtherText', 'markets', 'marketOtherText', 'clientModel',
    'companySize', 'reviewTeamSize', 'reviewers', 'fileTypes', 'fileTypeOtherText', 'role', 'roleOtherText']) {
    assert.ok(FIELD_ERRORS[f], f);
    assert.equal(fieldDomId(f), `kyc-${f}`);
  }
});

test('toggleValue respects max and removes on second toggle', () => {
  assert.deepEqual(toggleValue([], 'a', 3), ['a']);
  assert.deepEqual(toggleValue(['a'], 'a', 3), []);
  assert.deepEqual(toggleValue(['a', 'b', 'c'], 'd', 3), ['a', 'b', 'c']);
  assert.deepEqual(toggleValue(['a', 'b', 'c'], 'b', 3), ['a', 'c']);
});

test('moveValue reorders and ignores out-of-range moves', () => {
  assert.deepEqual(moveValue(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveValue(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  const same = ['a', 'b'];
  assert.equal(moveValue(same, 0, 5), same);
  assert.equal(moveValue(same, -1, 0), same);
  assert.equal(moveValue(same, 1, 1), same);
});

test('visibleOptions filters by label and synonyms', () => {
  const opts = [{ id: '1', label: 'CNC programmer', synonyms: ['machining'] }, { id: '2', label: 'Architect' }];
  assert.deepEqual(visibleOptions(opts, 'machin').map((o) => o.id), ['1']);
  assert.equal(visibleOptions(opts, '').length, 2);
});

test('nextActive wraps and clamps', () => {
  assert.equal(nextActive(0, 3, 'ArrowDown'), 1);
  assert.equal(nextActive(2, 3, 'ArrowDown'), 0);
  assert.equal(nextActive(0, 3, 'ArrowUp'), 2);
  assert.equal(nextActive(1, 3, 'Home'), 0);
  assert.equal(nextActive(1, 3, 'End'), 2);
  assert.equal(nextActive(0, 0, 'ArrowDown'), 0);
});
