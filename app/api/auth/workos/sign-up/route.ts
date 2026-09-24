import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { inviteVouchesForEmail } from '@/lib/inviteBinding';
import { splitName } from '@/lib/workosIdentity';
import { workos, type WorkosUser } from '@/lib/workos';
import { linkLocalUser } from '@/lib/workosLink';
import {
  failureResponse,
  handleAuthError,
  passwordSignIn,
  readJson,
  workosDisabled,
} from '@/lib/workosFlow';

export async function POST(request: NextRequest) {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const { name, email: rawEmail, password, inviteToken } = await readJson(request);
  if (
    typeof name !== 'string' || !name.trim() ||
    typeof rawEmail !== 'string' || !rawEmail.trim() ||
    typeof password !== 'string' || !password
  ) {
    return failureResponse({ ok: false, error: 'invalid_request', message: 'Name, email and password are required' });
  }
  // WorkOS enforces its own, stronger policy; this keeps the floor Stiko has
  // always had even if that policy is loosened in the dashboard.
  if (password.length < 8) {
    return failureResponse({ ok: false, error: 'password_rejected', message: 'Password must be at least 8 characters' });
  }
  const email = rawEmail.trim().toLowerCase();

  const existing = await sql`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`;
  if (existing[0]) return failureResponse({ ok: false, error: 'email_taken' });

  // Invited reviewers skip the emailed code: a live invitation addressed to
  // this exact address already proves they read that inbox (design spec,
  // "Email verification"). Share links never qualify.
  let emailVerified = false;
  if (typeof inviteToken === 'string' && inviteToken) {
    const rows = await sql`
      SELECT email, multi_use, expires_at, revoked_at FROM invite_tokens
      WHERE token = ${inviteToken} LIMIT 1
    `;
    const row = rows[0];
    emailVerified = inviteVouchesForEmail({
      invite: row
        ? {
            email: (row.email as string | null) ?? null,
            multiUse: Boolean(row.multi_use),
            expiresAt: row.expires_at as string,
            revokedAt: (row.revoked_at as string | null) ?? null,
          }
        : null,
      email,
      now: new Date(),
    });
  }

  const { firstName, lastName } = splitName(name);
  let created: WorkosUser;
  try {
    created = await (await workos()).userManagement.createUser({
      email,
      password,
      firstName,
      lastName,
      emailVerified,
    });
  } catch (err) {
    return handleAuthError(err);
  }

  // The local row is created now, not at first sign-in, so the bcrypt hash can
  // be written while the password is in hand. That hash is what lets
  // AUTH_PROVIDER=nextauth roll back without locking this account out.
  const linked = await linkLocalUser(created, {
    name: name.trim(),
    passwordHash: await hashPassword(password),
  });
  if (!linked.ok) return failureResponse({ ok: false, error: 'account_conflict' });

  return passwordSignIn(request, email, password);
}
