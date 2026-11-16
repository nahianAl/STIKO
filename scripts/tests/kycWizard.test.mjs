import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, canContinue, stepForField, letterFor, indexForKey, stepValue } from '../../lib/kyc/wizard.ts';

const EMPTY = { pillar: '', segmentId: '', businessTypeOther: '', clientModel: '', companySizeBand: '', role: '' };
const FULL = { pillar: 'PD', segmentId: 'PD-07', businessTypeOther: '', clientModel: 'clients', companySizeBand: '5-9', role: 'engineer' };

test('five steps in the approved order', () => {
  assert.deepEqual(STEPS, ['pillar', 'business_type', 'client_model', 'company_size', 'role']);
});

test('each step needs its own answer', () => {
  for (let i = 0; i < 5; i++) assert.equal(canContinue(i, EMPTY), false, String(i));
  for (let i = 0; i < 5; i++) assert.equal(canContinue(i, FULL), true, String(i));
});

test('a business type from another pillar does not count', () => {
  assert.equal(canContinue(1, { ...FULL, segmentId: 'AC-06' }), false);
});

test('Other needs non-blank text', () => {
  const other = { ...FULL, segmentId: 'PD-99' };
  assert.equal(canContinue(1, other), false);
  assert.equal(canContinue(1, { ...other, businessTypeOther: '   ' }), false);
  assert.equal(canContinue(1, { ...other, businessTypeOther: 'Boat builder' }), true);
});

test('unknown codes never count', () => {
  assert.equal(canContinue(0, { ...FULL, pillar: 'XX' }), false);
  assert.equal(canContinue(3, { ...FULL, companySizeBand: '1-4' }), false);
  assert.equal(canContinue(4, { ...FULL, role: 'ceo' }), false);
});

test('server field errors map to their step', () => {
  assert.equal(stepForField('pillar'), 0);
  assert.equal(stepForField('segmentId'), 1);
  assert.equal(stepForField('businessTypeOther'), 1);
  assert.equal(stepForField('clientModel'), 2);
  assert.equal(stepForField('companySizeBand'), 3);
  assert.equal(stepForField('role'), 4);
  assert.equal(stepForField('nope'), null);
  assert.equal(stepForField('constructor'), null);
  assert.equal(stepForField('__proto__'), null);
});

test('letters A.. and key lookup within the option count', () => {
  assert.equal(letterFor(0), 'A');
  assert.equal(letterFor(10), 'K');
  assert.equal(indexForKey('a', 4), 0);
  assert.equal(indexForKey('D', 4), 3);
  assert.equal(indexForKey('e', 4), null);
  assert.equal(indexForKey('Enter', 4), null);
  assert.equal(indexForKey('1', 4), null);
});

test('the analytics value is the stored code for that step', () => {
  assert.deepEqual(STEPS.map((_, i) => stepValue(i, FULL)), ['PD', 'PD-07', 'clients', '5-9', 'engineer']);
});
