/**
 * Payment records: the rules that need neither Stripe nor the database, so they
 * can be tested. The writes are in lib/paymentRecords.ts.
 *
 * A payment is a paid Stripe invoice with money in it: the first charge from
 * Checkout, every renewal, and the prorated charge for switching to yearly.
 * Each gets a Stiko transaction ID (STK-XXXX-XXXX-XXXX) stored beside the Stripe
 * customer, subscription, invoice, payment and Checkout Session IDs, so a
 * payment can be traced from any one of them.
 */

import type { BillingInterval } from './billing.ts';
import { planFor, type PlanId } from './plans.ts';

/** Crockford base32: no I, L, O or U, so an ID read aloud or retyped survives. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_CHARS = 12;

/**
 * A new transaction ID: STK- and 12 base32 characters in groups of four, 60
 * random bits. 256 is a multiple of 32, so taking each byte's low five bits is
 * unbiased. `bytes` is for tests.
 */
export function newTransactionId(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(ID_CHARS))): string {
  if (bytes.length < ID_CHARS) throw new Error(`newTransactionId needs ${ID_CHARS} bytes`);
  let out = '';
  for (let i = 0; i < ID_CHARS; i++) out += ALPHABET[bytes[i] & 31];
  return `STK-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

const TRANSACTION_ID = /^STK-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function isTransactionId(value: unknown): value is string {
  return typeof value === 'string' && TRANSACTION_ID.test(value);
}

/** A Stripe Checkout Session ID, as Stripe puts it in success_url. Anything else is not echoed back. */
export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(value);
}

type Ref = string | { id: string } | null | undefined;

function refId(ref: Ref): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

/** The parts of a Stripe Invoice this reads (retrieved with expand: ['payments']). */
export interface InvoiceLike {
  id?: string;
  status: string | null;
  amount_paid: number;
  currency: string;
  customer: Ref;
  number: string | null;
  billing_reason: string | null;
  livemode: boolean;
  created: number;
  status_transitions?: { paid_at: number | null } | null;
  parent?: { subscription_details?: { subscription: Ref } | null } | null;
  payments?: {
    data: Array<{ status: string; payment?: { payment_intent?: Ref; charge?: Ref } | null }>;
  } | null;
}

/** The parts of a Stripe Subscription this reads. */
export interface SubscriptionLike {
  id: string;
  items: { data: Array<{ price?: { id: string; recurring?: { interval?: string | null } | null } | null }> };
}

export interface PaymentFacts {
  invoiceId: string;
  invoiceNumber: string | null;
  customerId: string;
  subscriptionId: string | null;
  paymentIntentId: string | null;
  priceId: string | null;
  interval: BillingInterval | null;
  billingReason: string | null;
  amountCents: number;
  currency: string;
  livemode: boolean;
  paidAt: Date;
}

/**
 * What gets stored for a paid invoice, or null when it is not a payment: not
 * paid yet, no customer, or nothing charged (a 100% promotion code still makes
 * a $0 paid invoice, and that is not a transaction).
 *
 * The price and interval are the subscription's at the time of recording,
 * which for every invoice Stiko produces is the price that was charged.
 */
export function paymentFromInvoice(invoice: InvoiceLike, sub: SubscriptionLike | null): PaymentFacts | null {
  const customerId = refId(invoice.customer);
  if (!invoice.id || invoice.status !== 'paid' || !customerId) return null;
  if (!(invoice.amount_paid > 0)) return null;

  const paid = invoice.payments?.data?.find((p) => p.status === 'paid');
  const price = sub?.items?.data?.[0]?.price ?? null;
  const interval = price?.recurring?.interval;
  const paidAtSeconds = invoice.status_transitions?.paid_at ?? invoice.created;

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number ?? null,
    customerId,
    subscriptionId: refId(invoice.parent?.subscription_details?.subscription) ?? sub?.id ?? null,
    paymentIntentId: refId(paid?.payment?.payment_intent),
    priceId: price?.id ?? null,
    interval: interval === 'month' || interval === 'year' ? interval : null,
    billingReason: invoice.billing_reason ?? null,
    amountCents: invoice.amount_paid,
    currency: invoice.currency,
    livemode: invoice.livemode,
    paidAt: new Date(paidAtSeconds * 1000),
  };
}

/** What GET /api/billing/receipt returns, and the confirmation page shows. */
export interface PaymentReceipt {
  transactionId: string;
  plan: PlanId;
  interval: BillingInterval | null;
  amountCents: number;
  currency: string;
  /** ISO 8601. */
  paidAt: string;
}

export function intervalLabel(interval: BillingInterval | null | undefined): string | null {
  return interval === 'year' ? 'Yearly' : interval === 'month' ? 'Monthly' : null;
}

/** "Standard (Yearly)", or just "Standard" when the interval is not known. */
export function planWithInterval(plan: PlanId | string, interval: BillingInterval | null | undefined): string {
  const label = planFor(plan).label;
  const cadence = intervalLabel(interval);
  return cadence ? `${label} (${cadence})` : label;
}

/** "$216.00". Stripe amounts are in the currency's minor unit; Stiko charges USD. */
export function formatAmount(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
      amountCents / 100
    );
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export interface SuccessCopyInput {
  /** The recorded payment, once found. */
  receipt: PaymentReceipt | null;
  /** Still looking for it (the webhook can be a few seconds behind). */
  waiting: boolean;
  /** The plan as the server reports it, when there is no receipt to go on. */
  current: { plan: PlanId; interval: BillingInterval | null } | null;
}

/**
 * The confirmation screen's heading and line.
 *
 * Only a recorded payment, or a plan the server confirms, earns "you're now on
 * Standard": landing on this URL is not proof of anything by itself.
 */
export function successCopy({ receipt, waiting, current }: SuccessCopyInput): { title: string; subtitle: string } {
  if (receipt) {
    return {
      title: 'Payment successful',
      subtitle: `You're now on ${planWithInterval(receipt.plan, receipt.interval)}.`,
    };
  }
  if (waiting) {
    return { title: 'Confirming your payment…', subtitle: 'This usually takes a few seconds.' };
  }
  if (current && current.plan !== 'free') {
    return {
      title: 'Payment successful',
      subtitle: `You're now on ${planWithInterval(current.plan, current.interval)}. The transaction details can take a minute to appear here.`,
    };
  }
  return {
    title: 'Payment received',
    subtitle: 'Stripe is still confirming it. Your plan switches to Standard within a minute; refresh this page to check.',
  };
}
