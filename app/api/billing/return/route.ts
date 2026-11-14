import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { appBaseUrl } from '@/lib/appUrl';
import { billingEnabled } from '@/lib/billing';
import { stripe, syncSubscription } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Where Stripe Checkout sends the browser after payment. Syncs the plan now,
 * so the account is Standard on arrival rather than whenever the webhook lands,
 * then goes to the dashboard. Any failure still lands on the dashboard: the
 * webhook is the backstop and will apply the plan on its own.
 */
export async function GET(req: NextRequest) {
  const base = appBaseUrl();
  const done = (status: string) => NextResponse.redirect(`${base}/?billing=${status}`);

  const session = await auth();
  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!session?.user?.id || !sessionId || !billingEnabled()) return done('success');

  try {
    const checkout = await stripe().checkout.sessions.retrieve(sessionId);
    // Only ever sync the signed-in user's own checkout.
    if (checkout.client_reference_id !== session.user.id) return done('success');
    const subscriptionId =
      typeof checkout.subscription === 'string' ? checkout.subscription : checkout.subscription?.id;
    if (subscriptionId) await syncSubscription(subscriptionId, session.user.id);
  } catch (err) {
    console.error('[api/billing/return]', err instanceof Error ? err.message : err);
  }
  return done('success');
}
