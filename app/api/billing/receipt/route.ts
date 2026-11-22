import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isCheckoutSessionId, isTransactionId } from '@/lib/payments';
import { receiptFor } from '@/lib/paymentRecords';

export const dynamic = 'force-dynamic';

/**
 * One of the signed-in user's own payments, for the confirmation screen:
 *   ?txn=STK-…        by Stiko transaction ID
 *   ?session_id=cs_…  by the Checkout Session that made it (while the
 *                      webhook is still on its way, the page polls this)
 *
 * Read-only, and scoped to the caller: someone else's ID is a 404, the same as
 * an ID that does not exist. Not gated by BILLING_ENABLED, since a payment
 * already made stays the payer's to see.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const txn = params.get('txn');
  const sessionId = params.get('session_id');
  const key = isTransactionId(txn)
    ? { transactionId: txn }
    : isCheckoutSessionId(sessionId)
      ? { checkoutSessionId: sessionId }
      : null;
  if (!key) return NextResponse.json({ error: 'txn or session_id is required.' }, { status: 400 });

  try {
    const receipt = await receiptFor(userId, key);
    if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(receipt, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[api/billing/receipt]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not load the payment.' }, { status: 500 });
  }
}
