import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { appBaseUrl } from '@/lib/appUrl';
import { billingEnabled, isBillingInterval, planForSubscriptionStatus } from '@/lib/billing';
import { ensureCustomer, getUserBilling, portalConfigurationId, priceIdFor, stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Start a Stripe Checkout for Standard. Returns { url } for the browser to
 * follow; the payment page is Stripe's (on Stiko's custom domain once that is
 * set up in the Stripe dashboard — no code is involved in that).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!billingEnabled()) {
    return NextResponse.json({ error: 'Billing is not available.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const interval = (body as { interval?: unknown }).interval;
  if (!isBillingInterval(interval)) {
    return NextResponse.json({ error: 'interval must be "month" or "year".' }, { status: 400 });
  }

  try {
    const user = await getUserBilling(session.user.id);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const customer = await ensureCustomer(user);
    const base = appBaseUrl();

    // Already paying: a second Checkout would start a second subscription and
    // bill twice. Send them to manage the one they have instead.
    if (planForSubscriptionStatus(user.stripeSubscriptionStatus) === 'standard') {
      const portal = await stripe().billingPortal.sessions.create({
        customer,
        return_url: `${base}/`,
        configuration: await portalConfigurationId(),
      });
      return NextResponse.json({ url: portal.url });
    }

    const checkout = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price: await priceIdFor(interval), quantity: 1 }],
      subscription_data: { metadata: { stiko_user_id: user.id } },
      metadata: { stiko_user_id: user.id },
      allow_promotion_codes: true,
      // The return route syncs the plan straight away, so the account shows
      // Standard on arrival even if the webhook is a few seconds behind.
      success_url: `${base}/api/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?billing=cancelled`,
    });

    if (!checkout.url) throw new Error('Stripe returned a Checkout Session without a URL');
    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    console.error('[api/billing/checkout]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
  }
}
