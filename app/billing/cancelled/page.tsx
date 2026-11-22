'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import BillingFrame, { PRIMARY_CTA, QUIET_LINK } from '../BillingFrame';
import { checkoutPagePath } from '@/components/billing/checkout';
import { isBillingInterval } from '@/lib/billing';

/** /billing/cancelled?interval=… — Stripe Checkout's cancel_url: the person backed out before paying. */
function Cancelled() {
  const raw = useSearchParams().get('interval');
  const interval = isBillingInterval(raw) ? raw : null;
  return (
    <BillingFrame
      tone="neutral"
      title="Checkout cancelled"
      subtitle="No payment was taken and your plan hasn't changed."
      footer={
        interval ? (
          <Link href={checkoutPagePath(interval)} className={QUIET_LINK}>
            Try checkout again
          </Link>
        ) : (
          <Link href="/pricing" className={QUIET_LINK}>
            See pricing
          </Link>
        )
      }
    >
      <Link href="/" className={`${PRIMARY_CTA} mt-7`}>
        Go to dashboard
      </Link>
    </BillingFrame>
  );
}

export default function BillingCancelledPage() {
  return (
    <Suspense fallback={null}>
      <Cancelled />
    </Suspense>
  );
}
