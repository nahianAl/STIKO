import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { sendEmail, passwordResetEmail } from '@/lib/email';

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const rows = await sql`
    SELECT id FROM users WHERE lower(email) = lower(${email.trim()}) LIMIT 1
  `;

  // 3c: always report the sent state, even for an unregistered address — never
  // confirm whether an account exists. The work below is skipped, but the
  // response is identical.
  if (rows.length > 0) {
    const token = uuidv4();
    await sql`
      INSERT INTO password_reset_tokens (id, token, user_id, expires_at)
      VALUES (
        ${uuidv4()}, ${token}, ${rows[0].id},
        ${new Date(Date.now() + ONE_HOUR_MS).toISOString()}
      )
    `;

    const base = process.env.NEXTAUTH_URL ?? request.nextUrl.origin;
    await sendEmail({
      to: email.trim(),
      ...passwordResetEmail({ link: `${base}/reset-password/${token}` }),
    });
  }

  return NextResponse.json({ ok: true });
}
