'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SettingsShell, SettingsCard } from '@/components/settings/SettingsShell';
import { ACCOUNT_RAIL } from '@/components/settings/accountRail';
import UsageMeters, { type UsagePayload } from '@/components/shell/UsageMeters';
import Button from '@/components/ui/Button';
import { openPortal, startCheckout } from '@/components/billing/checkout';
import type { BillingInterval, BillingStatusPayload } from '@/lib/billing';
import { PLANS } from '@/lib/plans';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Settings → Plan & billing. */
export default function BillingSettings() {
  const [status, setStatus] = useState<BillingStatusPayload | null>(null);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A failed status call is billing "off" as far as this page goes: the plan
    // badge and meters still render, just without buttons.
    fetch('/api/billing/status')
      .then((r) => (r.ok ? r.json() : { action: 'none' }))
      .then(setStatus)
      .catch(() => setStatus({ action: 'none' }));
    fetch('/api/me/usage')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setUsage)
      .catch(() => setUsageFailed(true));
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      // Leave the spinner on: the page is navigating away.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  };

  const sub = status?.subscription;
  // Null until a real answer arrives: a badge that reads Free for a beat and
  // then flips to Standard looks like a bug (AvatarMenu holds back the same way).
  const planLabel = usage?.plan.label ?? (status?.plan ? PLANS[status.plan].label : null);

  let renewal: string | null = null;
  if (sub?.renewsAt) {
    const cadence = sub.interval === 'year' ? 'Yearly' : sub.interval === 'month' ? 'Monthly' : null;
    renewal = sub.cancelAtPeriodEnd
      ? `Cancels on ${formatDate(sub.renewsAt)}`
      : `Renews on ${formatDate(sub.renewsAt)}${cadence ? ` · ${cadence}` : ''}`;
  }

  return (
    <SettingsShell
      crumbs={[{ label: 'Settings' }, { label: 'Account' }]}
      railLabel="Account"
      items={ACCOUNT_RAIL}
      active="billing"
    >
      <SettingsCard heading="Plan" description={renewal ?? undefined}>
        <div className="flex items-center gap-2">
          {planLabel && (
            <span className="rounded-chip bg-stiko-tint px-[8px] py-[4px] text-[11px] font-extrabold uppercase tracking-label text-stiko-primary">
              {planLabel}
            </span>
          )}
          <Link href="/pricing" className="text-[12.5px] font-semibold !text-stiko-secondary hover:!text-stiko-ink">
            Compare plans
          </Link>
        </div>

        {sub?.status === 'past_due' && (
          <p className="rounded-[10px] bg-[#FFF5F5] px-3 py-2 text-[12.5px] font-semibold text-[#B23A52]">
            Your last payment failed. Update your card in Manage billing to keep Standard.
          </p>
        )}

        <div className="-mx-4 rounded-[12px] border border-stiko-border">
          <UsageMeters usage={usage} failed={usageFailed} />
        </div>

        {status?.action === 'upgrade' && (
          <div className="flex flex-wrap gap-2">
            {(['month', 'year'] as BillingInterval[]).map((interval) => {
              const perMonth = status.prices?.[interval].perMonth;
              return (
                <Button
                  key={interval}
                  variant={interval === 'year' ? 'primary' : 'secondary'}
                  disabled={busy !== null}
                  onClick={() => run(interval, () => startCheckout(interval))}
                >
                  {busy === interval
                    ? 'Opening…'
                    : `Upgrade ${interval === 'month' ? 'monthly' : 'yearly'}${perMonth ? ` · ${perMonth}/mo` : ''}`}
                </Button>
              );
            })}
            {status.hasBillingHistory && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => run('portal', openPortal)}>
                {busy === 'portal' ? 'Opening…' : 'Billing history'}
              </Button>
            )}
          </div>
        )}

        {status?.action === 'manage' && (
          <div>
            <Button variant="secondary" disabled={busy !== null} onClick={() => run('portal', openPortal)}>
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </Button>
            <p className="mt-2 text-[11.5px] text-stiko-muted">Change plan, update your card, see invoices or cancel.</p>
          </div>
        )}

        {error && <p className="text-[12px] text-red-600">{error}</p>}
      </SettingsCard>
    </SettingsShell>
  );
}
