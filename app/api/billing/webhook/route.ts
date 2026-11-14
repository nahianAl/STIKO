import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe, syncSubscription } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Stripe → Stiko. Public (see lib/routeAccess.ts), so the signature check is
 * the only thing standing between the internet and users.plan.
 *
 * Every handled event re-fetches the subscription from Stripe and syncs from
 * that, so duplicate, late or out-of-order deliveries are harmless.
 *
 * Deliberately NOT gated by BILLING_ENABLED: turning the buttons off must not
 * stop cancellations from downgrading people who already pay.
 */
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    console.error('[api/billing/webhook] STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY is not set');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  // The raw body, exactly as sent: the signature is over these bytes.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.warn('[api/billing/webhook] bad signature:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (session.mode === 'subscription' && subscriptionId) {
        await syncSubscription(subscriptionId, session.client_reference_id);
      }
    } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(sub.id);
    }
  } catch (err) {
    // 500 makes Stripe retry with backoff for up to three days.
    console.error(`[api/billing/webhook] ${event.type} ${event.id} failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
