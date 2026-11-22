'use client';

import { useEffect, useRef } from 'react';
import type { BillingInterval } from '@/lib/billing';

async function follow(endpoint: string, body?: object): Promise<void> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Something went wrong.');
  window.location.assign(data.url);
}

/**
 * Go to /billing/checkout, the first step of paying, which opens Stripe Checkout
 * for Standard (or the portal, if already paying). Each step has its own URL so
 * a payment can be traced; see app/api/billing/checkout/route.ts.
 */
export function startCheckout(interval: BillingInterval): Promise<void> {
  window.location.assign(checkoutPagePath(interval));
  return Promise.resolve();
}

export function checkoutPagePath(interval: BillingInterval): string {
  return `/billing/checkout?interval=${interval}`;
}

/** Used by /billing/checkout: asks the server for the Checkout URL and replaces this page with it. */
export async function openCheckout(interval: BillingInterval): Promise<void> {
  const res = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interval }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Something went wrong.');
  // replace, not assign: Back from Stripe returns to where the person chose a
  // plan, not to this page, which would open Checkout all over again.
  window.location.replace(data.url);
}

export function openPortal(): Promise<void> {
  return follow('/api/billing/portal');
}

/** Stripe's confirm screen for moving a monthly subscription to yearly. Nothing changes until confirmed there. */
export function startSwitchToYearly(): Promise<void> {
  return follow('/api/billing/switch-to-yearly');
}

/**
 * Call `reset` when the browser restores this page from its back/forward cache.
 *
 * A successful startCheckout/openPortal leaves the "Opening…" state on because
 * the page is navigating away. Pressing Back from Stripe then restores the page
 * exactly as it was left, frozen mid-"Opening…" with nothing left to finish it.
 * `pageshow` with `persisted` is the signal that this happened.
 */
export function useResetOnPageShow(reset: () => void): void {
  const latest = useRef(reset);
  useEffect(() => {
    latest.current = reset;
  });
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) latest.current();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
}
