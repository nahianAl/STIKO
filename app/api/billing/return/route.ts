import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { appBaseUrl } from '@/lib/appUrl';
import { billingEnabled } from '@/lib/billing';
import { isCheckoutSessionId } from '@/lib/payments';
import { latestInvoiceId, recordInvoicePayment } from '@/lib/paymentRecords';
import { getUserBilling, stripe, syncSubscription } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Where Stripe sends the browser after a payment:
 *   ?session_id=cs_…   Checkout's success_url
 *   ?flow=switch       the portal's "switch to yearly" confirm screen, on completion
 *
 * Syncs the plan and records the payment now, so the account is Standard and
 * the transaction exists on arrival rather than whenever the webhook lands,
 * then goes to the confirmation screen, /billing/success, carrying the
 * transaction ID. Any failure still lands there, without it: that page waits
 * for the webhook, which is the backstop and records the payment on its own.
 */
export async function GET(req: NextRequest) {
  const base = appBaseUrl();
  const params = req.nextUrl.searchParams;
  const raw = params.get('session_id');
  const sessionId = isCheckoutSessionId(raw) ? raw : null;
  const isSwitch = params.get('flow') === 'switch';

  const land = (transactionId: string | null) => {
    const q = new URLSearchParams();
    if (transactionId) q.set('txn', transactionId);
    if (sessionId) q.set('session_id', sessionId);
    if (isSwitch) q.set('flow', 'switch');
    const query = q.toString();
    return NextResponse.redirect(`${base}/billing/success${query ? `?${query}` : ''}`);
  };

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !billingEnabled()) return land(null);

  try {
    if (isSwitch) {
      const user = await getUserBilling(userId);
      if (!user?.stripeSubscriptionId) return land(null);
      await syncSubscription(user.stripeSubscriptionId, userId);
      // Changing to yearly invoices at once. Only that invoice is this flow's
      // payment; an older one would be a receipt for something else.
      const latest = await latestInvoiceId(user.stripeSubscriptionId);
      if (!latest || latest.reason !== 'subscription_update') return land(null);
      return land(await recordInvoicePayment(latest.id));
    }

    if (!sessionId) return land(null);
    const checkout = await stripe().checkout.sessions.retrieve(sessionId);
    // Only ever act on the signed-in user's own checkout.
    if (checkout.client_reference_id !== userId) return land(null);
    const subscriptionId =
      typeof checkout.subscription === 'string' ? checkout.subscription : checkout.subscription?.id;
    if (!subscriptionId) return land(null);
    await syncSubscription(subscriptionId, userId);

    const invoiceRef = checkout.invoice;
    const invoiceId =
      (typeof invoiceRef === 'string' ? invoiceRef : invoiceRef?.id) ?? (await latestInvoiceId(subscriptionId))?.id;
    if (!invoiceId) return land(null);
    return land(await recordInvoicePayment(invoiceId, { checkoutSessionId: sessionId }));
  } catch (err) {
    console.error('[api/billing/return]', err instanceof Error ? err.message : err);
    return land(null);
  }
}
