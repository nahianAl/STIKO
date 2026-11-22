'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import BillingFrame, { PRIMARY_CTA, QUIET_LINK } from '../BillingFrame';
import { openCheckout } from '@/components/billing/checkout';
import { isBillingInterval } from '@/lib/billing';
import { loginRedirectPath } from '@/lib/routeAccess';

/**
 * /billing/checkout?interval=month|year — the first step of paying. Opens
 * Stripe Checkout (or the portal, for someone already paying) and replaces
 * itself with it, so Back from Stripe returns to where the plan was chosen.
 * Every Upgrade button in the app comes through here.
 */
function Checkout() {
  const raw = useSearchParams().get('interval');
  const interval = isBillingInterval(raw) ? raw : null;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One Checkout Session per attempt, even under StrictMode's double effects.
  const started = useRef(-1);

  useEffect(() => {
    if (!interval || started.current === attempt) return;
    started.current = attempt;
    setError(null);
    openCheckout(interval).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      if (message === 'Unauthorized') {
        window.location.assign(loginRedirectPath(window.location.pathname + window.location.search));
        return;
      }
      setError(message);
    });
  }, [interval, attempt]);

  // Restored from the back/forward cache (Back from Stripe before the replace
  // landed): start again rather than sit on a spinner.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setAttempt((a) => a + 1);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  if (!interval) {
    return (
      <BillingFrame tone="neutral" title="Choose a plan first" subtitle="Pick monthly or yearly billing on the pricing page.">
        <Link href="/pricing" className={`${PRIMARY_CTA} mt-7`}>
          See pricing
        </Link>
      </BillingFrame>
    );
  }

  if (error) {
    return (
      <BillingFrame
        tone="neutral"
        title="Checkout didn't open"
        subtitle={error}
        footer={
          <Link href="/pricing" className={QUIET_LINK}>
            Back to pricing
          </Link>
        }
      >
        <button type="button" onClick={() => setAttempt((a) => a + 1)} className={`${PRIMARY_CTA} mt-7`}>
          Try again
        </button>
      </BillingFrame>
    );
  }

  return (
    <BillingFrame
      tone="pending"
      title="Opening secure checkout…"
      subtitle={`Standard, billed ${interval === 'year' ? 'yearly' : 'monthly'}. Payment is handled by Stripe.`}
    />
  );
}

export default function BillingCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <Checkout />
    </Suspense>
  );
}
