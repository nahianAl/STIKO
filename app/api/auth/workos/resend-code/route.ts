import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PENDING_AUTH_COOKIE, decodePendingAuth } from '@/lib/pendingAuth';
import { failureResponse, sendVerificationCode, workosDisabled } from '@/lib/workosFlow';

export async function POST() {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const pending = decodePendingAuth(cookies().get(PENDING_AUTH_COOKIE)?.value);
  if (!pending) return failureResponse({ ok: false, error: 'verification_expired' });

  const delivery = await sendVerificationCode(pending);
  if (delivery === 'sent') return NextResponse.json({ ok: true });
  if (delivery === 'expired') return failureResponse({ ok: false, error: 'verification_expired' });
  return failureResponse({
    ok: false,
    error: 'unknown',
    message: 'We couldn’t send the code just now. Try again in a minute.',
  });
}
