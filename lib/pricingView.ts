/**
 * Which button each plan card on /pricing shows, for the person looking at it.
 * Pure, so every viewer state can be tested; the page only maps these names to
 * JSX.
 *
 * Nothing is claimed until it is known: while the session, or (for a signed-in
 * visitor) the billing status, is still loading, both cards are 'loading'. A
 * signed-in customer must never see "Get Standard", and a paying one never
 * "Upgrade", even for a moment.
 */

import type { BillingStatusPayload } from './billing';

export type PricingAuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type StandardView =
  | 'loading'
  | 'signup' //      signed out: Get Standard
  | 'unavailable' // status could not be read: Try again
  | 'manage' //      paying: Manage billing
  | 'current' //     Standard with no subscription (granted by hand): nothing to manage
  | 'soon' //        billing is off: Coming soon
  | 'upgrade'; //    Free, billing on: Upgrade

export type FreeView =
  | 'loading'
  | 'signup' //   signed out: Start free
  | 'current' //  this is their plan
  | 'included' // they are on Standard, which includes everything here
  | 'none'; //    plan unknown: claim nothing

export function pricingView(input: {
  authStatus: PricingAuthStatus;
  billing: BillingStatusPayload | null;
  billingFailed: boolean;
}): { standard: StandardView; free: FreeView } {
  const { authStatus, billing, billingFailed } = input;

  if (authStatus === 'loading') return { standard: 'loading', free: 'loading' };
  if (authStatus === 'unauthenticated') return { standard: 'signup', free: 'signup' };

  if (!billing) {
    return billingFailed
      ? { standard: 'unavailable', free: 'none' }
      : { standard: 'loading', free: 'loading' };
  }

  if (billing.action === 'manage') return { standard: 'manage', free: 'included' };
  if (billing.plan === 'standard') return { standard: 'current', free: 'included' };
  if (billing.action === 'none') return { standard: 'soon', free: 'current' };
  return { standard: 'upgrade', free: 'current' };
}
