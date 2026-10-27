import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { appBaseUrl } from '@/lib/appUrl';
import { billingEnabled } from '@/lib/billing';
import { getUserBilling, portalConfigurationId, stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/** Open Stripe's billing portal: change card, switch monthly/yearly, invoices, cancel. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!billingEnabled()) {
    return NextResponse.json({ error: 'Billing is not available.' }, { status: 404 });
  }

  try {
    const user = await getUserBilling(session.user.id);
    if (!user?.stripeCustomerId) {
      return NextResponse.json({ error: 'No billing account yet.' }, { status: 404 });
    }
    const portal = await stripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appBaseUrl()}/`,
      configuration: await portalConfigurationId(),
    });
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    console.error('[api/billing/portal]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not open billing. Please try again.' }, { status: 500 });
  }
}
