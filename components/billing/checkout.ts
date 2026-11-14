'use client';

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
