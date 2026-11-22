import 'server-only';
import { sql } from '@/lib/db';
import { stripe } from '@/lib/stripe';
import { track } from '@/lib/analytics/server';
import { newTransactionId, paymentFromInvoice, type PaymentReceipt } from '@/lib/payments';
import { planFor } from '@/lib/plans';
import type { BillingInterval } from '@/lib/billing';

/**
 * Stores successful payments (migration 021). The rules (what counts as a
 * payment, the ID format, the copy) are pure, in lib/payments.ts.
 */

/**
 * Record a paid invoice, fetched fresh from Stripe, and return its Stiko
 * transaction ID, or null when the invoice is not a payment (unpaid, $0).
 *
 * Safe to call any number of times for the same invoice, from the return route
 * and the invoice.paid webhook at once: stripe_invoice_id is UNIQUE, the first
 * INSERT wins, and later calls only fill in what the first could not know (the
 * Checkout Session, the user) and return the same ID. Only the first stamps the
 * ID on the Stripe invoice and sends payment_succeeded.
 */
export async function recordInvoicePayment(
  invoiceId: string,
  opts: { checkoutSessionId?: string | null } = {}
): Promise<string | null> {
  const invoice = await stripe().invoices.retrieve(invoiceId, { expand: ['payments'] });
  const subRef = invoice.parent?.subscription_details?.subscription ?? null;
  const subId = typeof subRef === 'string' ? subRef : subRef?.id ?? null;
  const sub = subId ? await stripe().subscriptions.retrieve(subId) : null;

  const facts = paymentFromInvoice(invoice, sub);
  if (!facts) return null;

  // The first invoice of a subscription came from a Checkout Session; find it
  // when the caller (the webhook) does not already know it.
  let checkoutSessionId = opts.checkoutSessionId ?? null;
  if (!checkoutSessionId && facts.billingReason === 'subscription_create' && facts.subscriptionId) {
    try {
      const { data } = await stripe().checkout.sessions.list({ subscription: facts.subscriptionId, limit: 1 });
      checkoutSessionId = data[0]?.id ?? null;
    } catch (err) {
      console.warn('[payments] could not look up the Checkout Session:', err instanceof Error ? err.message : err);
    }
  }

  const owner = await sql`SELECT id FROM users WHERE stripe_customer_id = ${facts.customerId}`;
  const userId = (owner[0]?.id as string | undefined) ?? null;
  // Only Standard is sold. A price that is not one of Stiko's still records.
  const plan = 'standard';

  const id = newTransactionId();
  const inserted = await sql`
    INSERT INTO payments (
      id, user_id, stripe_customer_id, stripe_invoice_id, stripe_invoice_number,
      stripe_subscription_id, stripe_payment_intent_id, stripe_checkout_session_id,
      stripe_price_id, plan, billing_interval, billing_reason,
      amount_cents, currency, livemode, paid_at
    ) VALUES (
      ${id}, ${userId}, ${facts.customerId}, ${facts.invoiceId}, ${facts.invoiceNumber},
      ${facts.subscriptionId}, ${facts.paymentIntentId}, ${checkoutSessionId},
      ${facts.priceId}, ${plan}, ${facts.interval}, ${facts.billingReason},
      ${facts.amountCents}, ${facts.currency}, ${facts.livemode}, ${facts.paidAt.toISOString()}
    )
    ON CONFLICT (stripe_invoice_id) DO NOTHING
    RETURNING id
  `;

  if (!inserted[0]) {
    const existing = await sql`
      UPDATE payments
      SET stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ${checkoutSessionId}),
          user_id = COALESCE(user_id, ${userId})
      WHERE stripe_invoice_id = ${facts.invoiceId}
      RETURNING id
    `;
    return (existing[0]?.id as string | undefined) ?? null;
  }

  // The same ID on Stripe's side, so a payment found in the dashboard leads
  // back here. Best effort: the row is the record.
  try {
    await stripe().invoices.update(facts.invoiceId, { metadata: { stiko_transaction_id: id } });
  } catch (err) {
    console.warn(`[payments] could not stamp ${id} on ${facts.invoiceId}:`, err instanceof Error ? err.message : err);
  }

  if (userId) {
    await track('payment_succeeded', {
      userId,
      properties: {
        transaction_id: id,
        plan,
        interval: facts.interval,
        amount: facts.amountCents / 100,
        currency: facts.currency,
        billing_reason: facts.billingReason,
        stripe_customer_id: facts.customerId,
        stripe_invoice_id: facts.invoiceId,
        stripe_subscription_id: facts.subscriptionId,
        stripe_checkout_session_id: checkoutSessionId,
      },
    });
  }
  console.info(`[payments] ${id} recorded for ${facts.customerId} (${facts.invoiceId}, ${facts.billingReason})`);
  return id;
}

/** The subscription's latest invoice ID, for flows that have no Checkout Session to name it. */
export async function latestInvoiceId(subscriptionId: string): Promise<{ id: string; reason: string | null } | null> {
  const sub = await stripe().subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
  const inv = sub.latest_invoice;
  if (!inv) return null;
  if (typeof inv === 'string') return { id: inv, reason: null };
  return { id: inv.id ?? '', reason: inv.billing_reason ?? null };
}

/** One of the user's own payments, by transaction ID or by the Checkout Session that made it. */
export async function receiptFor(
  userId: string,
  key: { transactionId: string } | { checkoutSessionId: string }
): Promise<PaymentReceipt | null> {
  const rows =
    'transactionId' in key
      ? await sql`
          SELECT id, plan, billing_interval, amount_cents, currency, paid_at
          FROM payments WHERE user_id = ${userId} AND id = ${key.transactionId}
        `
      : await sql`
          SELECT id, plan, billing_interval, amount_cents, currency, paid_at
          FROM payments WHERE user_id = ${userId} AND stripe_checkout_session_id = ${key.checkoutSessionId}
          ORDER BY paid_at DESC LIMIT 1
        `;
  const row = rows[0] as
    | { id: string; plan: string; billing_interval: string | null; amount_cents: number; currency: string; paid_at: Date | string }
    | undefined;
  if (!row) return null;
  const interval = row.billing_interval === 'month' || row.billing_interval === 'year' ? row.billing_interval : null;
  return {
    transactionId: row.id,
    plan: planFor(row.plan).id,
    interval: interval as BillingInterval | null,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    paidAt: new Date(row.paid_at).toISOString(),
  };
}
