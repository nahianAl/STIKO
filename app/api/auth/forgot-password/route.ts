import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { sendEmail, passwordResetEmail } from '@/lib/email';
import { appBaseUrlOrNull } from '@/lib/appUrl';
import { authProvider } from '@/lib/authProvider';
import { createWorkosPasswordReset } from '@/lib/workosFlow';

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  const address = email.trim().toLowerCase();

  const rows = await sql`
    SELECT id FROM users WHERE lower(email) = ${address} LIMIT 1
  `;

  // 3c: always report the sent state, even for an unregistered address — never
  // confirm whether an account exists. The work below is skipped, but the
  // response is identical.
  if (rows.length > 0) {
    // The link host comes from configuration, never from the request. Deriving
    // it from the Host header would let an attacker request a reset for someone
    // else's address and have the victim receive a working token pointed at the
    // attacker's host.
    const base = appBaseUrlOrNull();

    if (!base) {
      // Refuse to mint a token we cannot send safely. Still fall through to the
      // same generic response below, so this does not become an oracle for
      // whether the address is registered.
      console.error(
        '[forgot-password] NEXTAUTH_URL is not configured — reset email not sent.'
      );
    } else {
      // Under WorkOS the password lives there, so WorkOS must issue the token
      // its resetPassword call will accept. It is still recorded locally so the
      // reset page can check it and show whose account it is.
      const issued =
        authProvider() === 'workos'
          ? await createWorkosPasswordReset(address)
          : { token: uuidv4(), expiresAt: new Date(Date.now() + ONE_HOUR_MS) };

      if (issued) {
        await sql`
          INSERT INTO password_reset_tokens (id, token, user_id, expires_at)
          VALUES (${uuidv4()}, ${issued.token}, ${rows[0].id}, ${issued.expiresAt.toISOString()})
        `;

        const result = await sendEmail({
          to: address,
          ...passwordResetEmail({ link: `${base}/reset-password/${issued.token}` }),
        });
        // Logged, never returned: the response must stay the same for
        // registered and unregistered addresses. Before this line the result
        // was discarded, which is how broken resets went unnoticed.
        if (!result.delivered) {
          console.error(`[forgot-password] reset email not delivered: ${result.reason}`);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
