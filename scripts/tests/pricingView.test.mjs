import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offersSwitchToYearly, pricingView } from '../../lib/pricingView.ts';

// Who is looking at /pricing decides what each card's button says. The page
// only maps these states to JSX, so every viewer state is pinned here.
const CASES = [
  ['session still loading', { authStatus: 'loading', billing: null, billingFailed: false }, { standard: 'loading', free: 'loading' }],
  ['session loading ignores a stale billing answer', { authStatus: 'loading', billing: { action: 'manage', plan: 'standard' }, billingFailed: false }, { standard: 'loading', free: 'loading' }],
  ['signed out', { authStatus: 'unauthenticated', billing: null, billingFailed: false }, { standard: 'signup', free: 'signup' }],
  ['signed out ignores a failed flag', { authStatus: 'unauthenticated', billing: null, billingFailed: true }, { standard: 'signup', free: 'signup' }],
  ['signed in, status pending', { authStatus: 'authenticated', billing: null, billingFailed: false }, { standard: 'loading', free: 'loading' }],
  ['signed in, status failed', { authStatus: 'authenticated', billing: null, billingFailed: true }, { standard: 'unavailable', free: 'none' }],
  ['paying Standard', { authStatus: 'authenticated', billing: { action: 'manage', plan: 'standard' }, billingFailed: false }, { standard: 'manage', free: 'included' }],
  ['Standard granted by hand', { authStatus: 'authenticated', billing: { action: 'none', plan: 'standard' }, billingFailed: false }, { standard: 'current', free: 'included' }],
  ['billing off, Free plan', { authStatus: 'authenticated', billing: { action: 'none', plan: 'free' }, billingFailed: false }, { standard: 'soon', free: 'current' }],
  ['billing off, plan unknown', { authStatus: 'authenticated', billing: { action: 'none' }, billingFailed: false }, { standard: 'soon', free: 'current' }],
  ['Free and able to upgrade', { authStatus: 'authenticated', billing: { action: 'upgrade', plan: 'free' }, billingFailed: false }, { standard: 'upgrade', free: 'current' }],
];

for (const [name, input, expected] of CASES) {
  test(`pricingView: ${name}`, () => {
    assert.deepEqual(pricingView(input), expected);
  });
}

// "Switch to yearly" is offered only to someone paying monthly whose
// subscription is not already ending: a yearly payer has nothing to switch to,
// and a cancelling one would be talked back into a year they chose to leave.
const sub = (over) => ({ status: 'active', interval: 'month', renewsAt: null, cancelAtPeriodEnd: false, cancelAt: null, ...over });
const SWITCH_CASES = [
  ['no billing answer yet', null, false],
  ['paying monthly', { action: 'manage', plan: 'standard', subscription: sub() }, true],
  ['paying monthly, past_due (still Standard)', { action: 'manage', plan: 'standard', subscription: sub({ status: 'past_due' }) }, true],
  ['paying yearly', { action: 'manage', plan: 'standard', subscription: sub({ interval: 'year' }) }, false],
  ['monthly but cancelling', { action: 'manage', plan: 'standard', subscription: sub({ cancelAtPeriodEnd: true }) }, false],
  ['interval unknown', { action: 'manage', plan: 'standard', subscription: sub({ interval: null }) }, false],
  ['renewal facts missing (Stripe slow)', { action: 'manage', plan: 'standard' }, false],
  ['Free, able to upgrade', { action: 'upgrade', plan: 'free' }, false],
  ['Standard by hand', { action: 'none', plan: 'standard' }, false],
  ['churned: manage with a canceled sub', { action: 'manage', plan: 'free', subscription: sub({ status: 'canceled' }) }, false],
];
for (const [name, billing, expected] of SWITCH_CASES) {
  test(`offersSwitchToYearly: ${name}`, () => {
    assert.equal(offersSwitchToYearly(billing), expected);
  });
}
