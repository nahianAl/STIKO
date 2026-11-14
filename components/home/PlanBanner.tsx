'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { openUpgradeDialog } from '@/lib/planLimitClient';
import { planBannerMessage } from '@/lib/upgradeCopy';
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
      // Thresholds (NEAR_LIMIT_FRACTION) and wording live in lib/upgradeCopy.ts.
      setMessage(planBannerMessage(usage));
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
    // border-strong: tint alone on the app background is all but invisible.
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 rounded-panel border border-stiko-border-strong bg-stiko-tint px-4 py-[10px] text-[12.5px] text-stiko-ink"
    >
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
        className="-m-1 rounded p-1 leading-none text-stiko-muted hover:text-stiko-ink"
      >
        ×
      </button>
    </div>
  );
}
