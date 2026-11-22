'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import BillingFrame, { PRIMARY_CTA, QUIET_LINK } from '../BillingFrame';
import type { BillingStatusPayload } from '@/lib/billing';
import { loginRedirectPath } from '@/lib/routeAccess';
import {
  formatAmount,
  isCheckoutSessionId,
  isTransactionId,
  planWithInterval,
  successCopy,
  type PaymentReceipt,
  type SuccessCopyInput,
} from '@/lib/payments';

/** How long to wait for the webhook to record a Checkout payment: 10 × 2s. */
const POLL_TRIES = 10;
const POLL_MS = 2000;

type ReceiptResult = PaymentReceipt | 'unauthorized' | null;

async function fetchReceipt(query: string): Promise<ReceiptResult> {
  try {
    const res = await fetch(`/api/billing/receipt?${query}`, { cache: 'no-store' });
    if (res.status === 401) return 'unauthorized';
    return res.ok ? ((await res.json()) as PaymentReceipt) : null;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[11px]">
      <dt className="text-[13px] text-stiko-muted">{label}</dt>
      <dd className="text-right text-[13.5px] font-bold text-stiko-ink">{children}</dd>
    </div>
  );
}

function TransactionId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(id)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-[12.5px] tracking-[0.02em]">{id}</span>
      <button
        type="button"
        onClick={copy}
        className="rounded-[7px] bg-[#EEF1FB] px-2 py-[3px] text-[11px] font-extrabold text-[#4247D6] hover:bg-[#E2E7F8]"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

/**
 * /billing/success — the payment confirmation screen, the last step of paying.
 *
 *   ?txn=STK-…&session_id=cs_…  from /api/billing/return, payment recorded
 *   ?session_id=cs_…            recorded late: wait for the webhook
 *   ?flow=switch                switched to yearly, payment not found yet
 *
 * Once the payment is found the URL is rewritten to carry its transaction ID,
 * so a refresh or a bookmark shows the same receipt.
 */
function Success() {
  const params = useSearchParams();
  const txnParam = params.get('txn');
  const sessionParam = params.get('session_id');
  const txn = isTransactionId(txnParam) ? txnParam : null;
  const sessionId = isCheckoutSessionId(sessionParam) ? sessionParam : null;

  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [current, setCurrent] = useState<SuccessCopyInput['current']>(null);

  useEffect(() => {
    let cancelled = false;
    const toLogin = () => window.location.assign(loginRedirectPath(window.location.pathname + window.location.search));
    const found = (r: PaymentReceipt) => {
      if (cancelled) return;
      setReceipt(r);
      setWaiting(false);
      const url = new URL(window.location.href);
      if (url.searchParams.get('txn') !== r.transactionId) {
        url.searchParams.set('txn', r.transactionId);
        window.history.replaceState(window.history.state, '', url.toString());
      }
    };

    (async () => {
      if (txn) {
        const r = await fetchReceipt(`txn=${encodeURIComponent(txn)}`);
        if (r === 'unauthorized') return toLogin();
        if (r) return found(r);
      }
      if (sessionId) {
        for (let i = 0; i < POLL_TRIES && !cancelled; i++) {
          if (i > 0) await new Promise((done) => window.setTimeout(done, POLL_MS));
          if (cancelled) return;
          const r = await fetchReceipt(`session_id=${encodeURIComponent(sessionId)}`);
          if (r === 'unauthorized') return toLogin();
          if (r) return found(r);
        }
      }
      // No record to show: fall back to what the server says the plan is now.
      const status = await fetch('/api/billing/status?include=renewal', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<BillingStatusPayload>) : null))
        .catch(() => null);
      if (cancelled) return;
      setCurrent(status?.plan ? { plan: status.plan, interval: status.subscription?.interval ?? null } : null);
      setWaiting(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [txn, sessionId]);

  const { title, subtitle } = successCopy({ receipt, waiting, current });
  const tone = waiting ? 'pending' : receipt || (current && current.plan !== 'free') ? 'success' : 'pending';

  return (
    <BillingFrame
      tone={tone}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          Questions about a charge?{' '}
          <Link href="/settings/billing" className={QUIET_LINK}>
            Plan &amp; billing
          </Link>
        </>
      }
    >
      {receipt && (
        <dl className="mt-7 divide-y divide-[#EEF0F6] rounded-[14px] bg-[#FBFCFF] px-4 text-left ring-1 ring-inset ring-[#EEF0F6]">
          <Detail label="Plan">{planWithInterval(receipt.plan, receipt.interval)}</Detail>
          <Detail label="Amount paid">{formatAmount(receipt.amountCents, receipt.currency)}</Detail>
          <Detail label="Date">{formatDate(receipt.paidAt)}</Detail>
          <Detail label="Transaction ID">
            <TransactionId id={receipt.transactionId} />
          </Detail>
        </dl>
      )}

      <Link href="/" className={`${PRIMARY_CTA} mt-7`}>
        Go to dashboard
      </Link>
    </BillingFrame>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={null}>
      <Success />
    </Suspense>
  );
}
