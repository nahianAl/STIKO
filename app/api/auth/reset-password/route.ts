import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { authProvider } from '@/lib/authProvider';
import { authErrorMessage } from '@/lib/authMessages';
import { resetWorkosPassword } from '@/lib/workosFlow';

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

  const userId =
    authProvider() === 'workos'
      ? await consumeWithWorkos(token, password)
      : await claimLocally(token);
  if (typeof userId !== 'string') return userId;

  // Written under WorkOS too. This local hash is what lets
  // AUTH_PROVIDER=nextauth roll back without locking out anyone who reset
  // their password while WorkOS was live.
  const hash = await hashPassword(password);
  await sql`
    UPDATE users SET password_hash = ${hash} WHERE id = ${userId}
  `;

  const emailRows = await sql`
    SELECT email FROM users WHERE id = ${userId}
  `;

  return NextResponse.json({ ok: true, email: emailRows[0]?.email ?? null });
}

function linkGone() {
  return NextResponse.json({ error: 'This link is no longer valid' }, { status: 410 });
}

async function claimLocally(token: string): Promise<string | NextResponse> {
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
  return claimed[0] ? (claimed[0].user_id as string) : linkGone();
}

async function consumeWithWorkos(token: string, password: string): Promise<string | NextResponse> {
  // Checked, not claimed, before calling WorkOS: if WorkOS refuses the
  // password as too weak, the person must be able to try again with the same
  // link. WorkOS's own token is single-use, so it guards the race instead.
  const rows = await sql`
    SELECT user_id FROM password_reset_tokens
    WHERE token = ${token} AND used_at IS NULL AND expires_at > NOW()
    LIMIT 1
  `;
  if (!rows[0]) return linkGone();

  const result = await resetWorkosPassword(token, password);
  if (!result.ok) {
    if (result.error === 'password_rejected' || result.error === 'rate_limited') {
      return NextResponse.json(
        { error: authErrorMessage(result) },
        { status: result.error === 'rate_limited' ? 429 : 400 }
      );
    }
    return linkGone();
  }

  await sql`
    UPDATE password_reset_tokens SET used_at = NOW()
    WHERE token = ${token} AND used_at IS NULL
  `;
  return rows[0].user_id as string;
}
