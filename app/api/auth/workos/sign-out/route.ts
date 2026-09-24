import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { workos } from '@/lib/workos';
import { workosDisabled } from '@/lib/workosFlow';

export async function POST() {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const { withAuth } = await import('@workos-inc/authkit-nextjs');
  const info = await withAuth();
  const sessionId = info.user ? info.sessionId : undefined;

  // Revoke server-side, not just delete the cookie: a copied cookie must stop
  // working too. That is one of the audit findings WorkOS was bought to close.
  // A failure here still clears the cookie below; the person asked to leave.
  if (sessionId) {
    try {
      await (await workos()).userManagement.revokeSession({ sessionId });
    } catch (err) {
      console.error('[auth] could not revoke the WorkOS session', err);
    }
  }

  cookies().delete(process.env.WORKOS_COOKIE_NAME || 'wos-session');
  return NextResponse.json({ ok: true });
}
