'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { formatBytes } from '@/lib/design';
import { PRICE_DISPLAY, type BillingInterval } from '@/lib/billing';
import { PLANS } from '@/lib/plans';
import type { PlanLimitPayload } from '@/lib/planLimits';
import { UPGRADE_EVENT } from '@/lib/planLimitClient';
import { startCheckout } from './checkout';

function headline(p: PlanLimitPayload | null): { title: string; subtitle: string } {
  const standard = PLANS.standard;
  const perks = `Standard gives you ${formatBytes(standard.storageBytes)} and unlimited projects.`;
  if (!p) return { title: 'Upgrade to Standard', subtitle: perks };
  if (!p.isOwner) {
    return {
      title: p.limit === 'storage' ? 'This project is out of storage' : 'This project is at its limit',
      subtitle:
        p.limit === 'storage'
          ? "The project's owner is on the Free plan and has used its storage. Ask them to upgrade to Standard."
          : "The project's owner is on the Free plan and has used its projects. Ask them to upgrade to Standard.",
    };
  }
  if (p.limit === 'projects') {
    return { title: `You've used your ${p.max} Free projects`, subtitle: perks };
  }
  const left = Math.max(0, p.max - p.used);
  return {
    title: 'Not enough storage',
    subtitle: `This needs ${formatBytes(p.adding)} — you have ${formatBytes(left)} left of ${formatBytes(
      p.max
    )}. ${perks}`,
  };
}

/** Mounted once in the root layout; opened by openUpgradeDialog(). */
export default function UpgradeDialogHost() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<PlanLimitPayload | null>(null);
  const [busy, setBusy] = useState<BillingInterval | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setPayload((e as CustomEvent<PlanLimitPayload | null>).detail ?? null);
      setError(null);
      setBusy(null);
      setOpen(true);
    };
    window.addEventListener(UPGRADE_EVENT, onOpen);
    return () => window.removeEventListener(UPGRADE_EVENT, onOpen);
  }, []);

  const { title, subtitle } = headline(payload);
  const canPay = !payload || payload.isOwner;

  const pay = async (interval: BillingInterval) => {
    setBusy(interval);
    setError(null);
    try {
      await startCheckout(interval);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => busy === null && setOpen(false)}
      title={title}
      subtitle={subtitle}
      width={460}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/pricing"
            onClick={() => setOpen(false)}
            className="text-[12.5px] font-semibold !text-stiko-secondary hover:!text-stiko-ink"
          >
            See plans
          </Link>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
            {canPay ? 'Not now' : 'OK'}
          </Button>
        </div>
      }
    >
      {canPay && (
        <div className="grid grid-cols-2 gap-2">
          {(['month', 'year'] as const).map((interval) => (
            <button
              key={interval}
              disabled={busy !== null}
              onClick={() => pay(interval)}
              className="rounded-[12px] border border-stiko-border px-4 py-3 text-left transition hover:border-stiko-primary hover:bg-stiko-tint disabled:opacity-60"
            >
              <div className="text-[10px] font-extrabold uppercase tracking-label text-stiko-primary">
                {interval === 'month' ? 'Monthly' : 'Yearly'}
              </div>
              <div className="text-[16px] font-bold text-stiko-ink">
                {busy === interval ? 'Opening…' : `${PRICE_DISPLAY[interval].perMonth}/mo`}
              </div>
              <div className="text-[11px] text-stiko-muted">{PRICE_DISPLAY[interval].note}</div>
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
    </Modal>
  );
}
