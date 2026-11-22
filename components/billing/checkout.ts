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

/** Stripe Checkout for Standard. If already paying, the server returns the portal instead. */
export function startCheckout(interval: BillingInterval): Promise<void> {
  return follow('/api/billing/checkout', { interval });
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
