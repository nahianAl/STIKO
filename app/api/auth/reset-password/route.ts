import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/password';

/** GET — is this token usable, and whose account is it for? (3d shows the email.) */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const rows = await sql`
    SELECT t.used_at, t.expires_at, u.email
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token = ${token}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'This link is not valid' }, { status: 404 });
  }
  const row = rows[0];
  if (row.used_at) {
    return NextResponse.json(
      { error: 'This link has already been used' },
      { status: 410 }
    );
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This link has expired' }, { status: 410 });
  }

  return NextResponse.json({ email: row.email });
}

/** POST — consume the token and set the new password. */
export async function POST(request: NextRequest) {
  const { token, password } = await request.json();

  if (typeof token !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Missing token or password' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  // Claim the token first. The `used_at IS NULL` guard makes this atomic: two
  // concurrent submissions cannot both consume the same single-use link.
  const claimed = await sql`
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE token = ${token}
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING user_id
  `;

  if (claimed.length === 0) {
    return NextResponse.json(
      { error: 'This link is no longer valid' },
      { status: 410 }
    );
  }

  const hash = await hashPassword(password);
  await sql`
    UPDATE users SET password_hash = ${hash} WHERE id = ${claimed[0].user_id}
  `;

  const emailRows = await sql`
    SELECT email FROM users WHERE id = ${claimed[0].user_id}
  `;

  return NextResponse.json({ ok: true, email: emailRows[0]?.email ?? null });
}
