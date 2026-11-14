'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { openUpgradeDialog } from '@/lib/planLimitClient';
import { formatBytes } from '@/lib/design';
import type { AccountUsage } from '@/lib/queries';
import type { BillingStatusPayload } from '@/lib/billing';

const DISMISS_KEY = 'stiko:plan-banner-dismissed';

/**
 * A slim nudge for Free owners near a limit. Checks billing first and only
 * then pays for the usage query, so Standard accounts never run it.
 *
 * Any failure (signed out, 503, network) reads as "unknown" and renders
 * nothing: a nudge that can't be sure it's right stays quiet.
 */
export default function PlanBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) return;
    } catch {}
    let cancelled = false;
    (async () => {
      const status: BillingStatusPayload | null = await fetch('/api/billing/status')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (cancelled || !status || status.plan !== 'free' || !status.limitsEnforced) return;
      const usage: AccountUsage | null = await fetch('/api/me/usage')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!usage || cancelled) return;
      const { plan, storage, projects } = usage;
      if (projects.max !== null && projects.count >= projects.max) {
        setMessage(`You're using ${projects.count} of ${projects.max} Free projects.`);
      } else if (storage.totalBytes >= plan.storageBytes * 0.8) {
        setMessage(`You've used ${formatBytes(storage.totalBytes)} of ${formatBytes(plan.storageBytes)} storage.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!message) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {}
    setMessage(null);
  };

  return (
    <div className="flex shrink-0 items-center gap-3 rounded-panel bg-stiko-tint px-4 py-[10px] text-[12.5px] text-stiko-ink">
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={() => openUpgradeDialog(null)}
        className="font-bold text-stiko-primary hover:underline"
      >
        Upgrade
      </button>
      <Link href="/pricing" className="font-semibold !text-stiko-secondary hover:!text-stiko-ink">
        See plans
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-stiko-muted hover:text-stiko-ink"
      >
        ×
      </button>
    </div>
  );
}
