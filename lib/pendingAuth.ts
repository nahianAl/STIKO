/**
 * A sign-in paused for an emailed code.
 *
 * WorkOS answers an unverified sign-in with a pending authentication token that
 * finishes it once the code is entered. That token authorises completing
 * someone's sign-in, so it lives in an httpOnly cookie scoped to the WorkOS
 * routes, never in a JSON body page scripts could read. Ten minutes covers
 * finding the email; after that the person signs in again.
 */

export const PENDING_AUTH_COOKIE = 'stiko-pending-auth';

export interface PendingAuth {
  token: string;
  emailVerificationId: string | null;
  email: string;
}

export function encodePendingAuth(p: PendingAuth): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodePendingAuth(raw: string | undefined): PendingAuth | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (typeof v.token !== 'string' || !v.token) return null;
    if (typeof v.email !== 'string' || !v.email) return null;
    return {
      token: v.token,
      email: v.email,
      emailVerificationId: typeof v.emailVerificationId === 'string' ? v.emailVerificationId : null,
    };
  } catch {
    return null;
  }
}

export function pendingAuthCookieOptions(secure: boolean) {
  return {
    httpOnly: true as const,
    secure,
    sameSite: 'lax' as const,
    path: '/api/auth/workos' as const,
    maxAge: 600 as const,
  };
}
