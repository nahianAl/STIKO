'use client';

import React, { useState } from 'react';
import type { BillingAction, BillingInterval } from '@/lib/billing';

export interface BillingStatusPayload {
  action: BillingAction;
  hasBillingHistory?: boolean;
  prices?: Record<BillingInterval, { perMonth: string; note: string }>;
}

/**
 * Upgrade / Manage billing in the account menu. Both hand off to a Stripe
 * page by following the URL the server returns.
 */
export default function BillingActions({ status }: { status: BillingStatusPayload | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!status || status.action === 'none') return null;

  async function go(endpoint: string, key: string, body?: object) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Something went wrong.');
      window.location.assign(data.url);
      // Leave the spinner on: the page is navigating away.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  }

  if (status.action === 'manage') {
    return (
      <div className="border-t border-stiko-border p-2">
        <MenuButton onClick={() => go('/api/billing/portal', 'portal')} busy={busy === 'portal'}>
          Manage billing
        </MenuButton>
        {error && <ErrorLine text={error} />}
      </div>
    );
  }

  const prices = status.prices;
  return (
    <div className="border-t border-stiko-border px-4 py-3">
      <div className="text-[12.5px] font-bold text-stiko-ink">Upgrade to Standard</div>
      <div className="mb-[10px] text-[11.5px] text-stiko-muted">100 GB storage, unlimited projects</div>
      <div className="grid grid-cols-2 gap-2">
        {(['month', 'year'] as const).map((interval) => (
          <button
            key={interval}
            disabled={busy !== null}
            onClick={() => go('/api/billing/checkout', interval, { interval })}
            className="rounded-[10px] border border-stiko-border px-3 py-[9px] text-left transition hover:border-stiko-primary hover:bg-stiko-tint disabled:opacity-60"
          >
            <div className="text-[10px] font-extrabold uppercase tracking-label text-stiko-primary">
              {interval === 'month' ? 'Monthly' : 'Yearly'}
            </div>
            <div className="text-[14px] font-bold text-stiko-ink">
              {busy === interval ? 'Opening…' : `${prices?.[interval].perMonth ?? ''}/mo`}
            </div>
            <div className="text-[10.5px] text-stiko-muted">{prices?.[interval].note}</div>
          </button>
        ))}
      </div>
      {status.hasBillingHistory && (
        <button
          disabled={busy !== null}
          onClick={() => go('/api/billing/portal', 'portal')}
          className="mt-2 text-[11.5px] font-semibold text-stiko-secondary hover:text-stiko-ink"
        >
          {busy === 'portal' ? 'Opening…' : 'Billing history'}
        </button>
      )}
      {error && <ErrorLine text={error} />}
    </div>
  );
}

function MenuButton({
  onClick,
  busy,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="block w-full rounded-[10px] px-3 py-[9px] text-left text-[13px] font-semibold text-stiko-secondary transition hover:bg-stiko-app hover:text-stiko-ink disabled:opacity-60"
    >
      {busy ? 'Opening…' : children}
    </button>
  );
}

function ErrorLine({ text }: { text: string }) {
  return <div className="px-1 pt-2 text-[11.5px] text-red-600">{text}</div>;
}
