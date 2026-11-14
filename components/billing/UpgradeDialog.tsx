'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PRICE_DISPLAY, type BillingInterval } from '@/lib/billing';
import type { PlanLimitPayload } from '@/lib/planLimits';
import { UPGRADE_EVENT } from '@/lib/planLimitClient';
import { headline, offersCheckout } from '@/lib/upgradeCopy';
import { startCheckout, useResetOnPageShow } from './checkout';

/** Mounted once in the root layout; opened by openUpgradeDialog(). */
export default function UpgradeDialogHost() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<PlanLimitPayload | null>(null);
  const [busy, setBusy] = useState<BillingInterval | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Back from Stripe restores this dialog mid-"Opening…".
  useResetOnPageShow(() => setBusy(null));

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

  // This dialog is global, so it can open on top of anything that also closes on
  // Escape. Modal and Drawer both listen on `document` in the bubble phase, in
  // mount order, so one Escape would close this dialog AND the drawer behind it
  // (the documented Drawer-Escape trap). Capture on `window` runs before every
  // `document` listener, so claiming Escape there, and stopping it, means nothing
  // underneath ever sees it. Only Escape is claimed: Tab still reaches Modal's
  // focus trap. While a checkout is opening, Escape is swallowed but the dialog
  // stays, matching the busy guard on the scrim, the X and "Not now".
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (busy === null) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, busy]);

  const { title, subtitle } = headline(payload);
  // Not just "is the owner": a Standard owner at Standard's cap must not be
  // sent to a Checkout for the plan they already have.
  const canPay = offersCheckout(payload);

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
        <div className="flex w-full items-center justify-between gap-2">
          <Link
            href="/pricing"
            aria-disabled={busy !== null}
            tabIndex={busy !== null ? -1 : undefined}
            onClick={(e) => {
              // A checkout is already opening; leaving now would strand it.
              if (busy !== null) {
                e.preventDefault();
                return;
              }
              setOpen(false);
            }}
            className={`text-[12.5px] font-semibold !text-stiko-secondary hover:!text-stiko-ink ${
              busy !== null ? 'pointer-events-none opacity-60' : ''
            }`}
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
