/**
 * The steps every WorkOS sign-in path shares: finish a successful
 * authentication (link the local row, save the session), and pause one that
 * needs an emailed code. Server-only; route handlers call these.
 *
 * WorkOS's own emails are turned off in its dashboard, so every email here is
 * sent by Stiko, from stiko.design, through lib/email.ts.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { authProvider } from '@/lib/authProvider';
import { workos, workosClientId, type WorkosAuthResponse } from '@/lib/workos';
import { linkLocalUser } from '@/lib/workosLink';
import { sendEmail, verificationCodeEmail } from '@/lib/email';
import { requestMeta } from '@/lib/requestMeta';
import {
  classifyWorkosError,
  failureStatus,
  publicFailure,
  type AuthFailure,
} from '@/lib/workosErrors';
import {
  PENDING_AUTH_COOKIE,
  encodePendingAuth,
  pendingAuthCookieOptions,
  type PendingAuth,
} from '@/lib/pendingAuth';
import type { AuthFailureResult } from '@/lib/authMessages';

const secureCookies = () => process.env.NODE_ENV === 'production';

/** These routes exist only while WorkOS is the provider. */
export function workosDisabled(): NextResponse | null {
  return authProvider() === 'workos'
    ? null
    : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function failureResponse(failure: AuthFailureResult): NextResponse {
  return NextResponse.json(failure, { status: failureStatus(failure) });
}

/**
 * Link the local row, then write the session cookie — in that order. A session
 * for a WorkOS user with no local row would make auth() return null on every
 * request: a sign-in that "worked" and changed nothing.
 */
export async function completeSignIn(
  request: NextRequest,
  response: WorkosAuthResponse
): Promise<NextResponse> {
  const linked = await linkLocalUser(response.user);
  if (!linked.ok) return failureResponse({ ok: false, error: 'account_conflict' });

  const { saveSession } = await import('@workos-inc/authkit-nextjs');
  await saveSession(response, request);
  return NextResponse.json({ ok: true });
}

export async function passwordSignIn(
  request: NextRequest,
  email: string,
  password: string
): Promise<NextResponse> {
  let response: WorkosAuthResponse;
  try {
    response = await (await workos()).userManagement.authenticateWithPassword({
      clientId: workosClientId(),
      email,
      password,
      ...requestMeta(request.headers),
    });
  } catch (err) {
    return handleAuthError(err);
  }
  return completeSignIn(request, response);
}

export async function handleAuthError(err: unknown): Promise<NextResponse> {
  const failure = classifyWorkosError(err);
  if (failure.error === 'email_verification_required') {
    await beginEmailVerification(failure);
  } else if (failure.error === 'unknown') {
    console.error('[auth] WorkOS call failed', err);
  }
  return failureResponse(publicFailure(failure));
}

async function beginEmailVerification(failure: AuthFailure): Promise<void> {
  const pending: PendingAuth = {
    token: failure.pendingAuthenticationToken as string,
    emailVerificationId: failure.emailVerificationId ?? null,
    email: failure.email as string,
  };
  cookies().set(PENDING_AUTH_COOKIE, encodePendingAuth(pending), pendingAuthCookieOptions(secureCookies()));
  // Not awaited for its result: whether or not delivery worked, the page must
  // move to the code step, which offers Resend. Failures are logged inside.
  await sendVerificationCode(pending);
}

export type CodeDelivery = 'sent' | 'expired' | 'failed';

/** WorkOS creates the code; Stiko emails it. */
export async function sendVerificationCode(pending: PendingAuth): Promise<CodeDelivery> {
  if (!pending.emailVerificationId) {
    console.error('[auth] WorkOS gave no email verification id; cannot send a code.');
    return 'failed';
  }
  try {
    const verification = await (await workos()).userManagement.getEmailVerification(
      pending.emailVerificationId
    );
    if (new Date(verification.expiresAt).getTime() <= Date.now()) return 'expired';

    const result = await sendEmail({
      to: pending.email,
      ...verificationCodeEmail({ code: verification.code }),
    });
    if (!result.delivered) {
      console.error(`[auth] verification code not delivered: ${result.reason}`);
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error('[auth] could not fetch the email verification', err);
    return 'failed';
  }
}

export function clearPendingAuth(): void {
  cookies().set(PENDING_AUTH_COOKIE, '', { ...pendingAuthCookieOptions(secureCookies()), maxAge: 0 });
}

/** For Task 9's forgot-password route. Null means log-and-say-nothing. */
export async function createWorkosPasswordReset(
  email: string
): Promise<{ token: string; expiresAt: Date } | null> {
  try {
    const reset = await (await workos()).userManagement.createPasswordReset({ email });
    return { token: reset.passwordResetToken, expiresAt: new Date(reset.expiresAt) };
  } catch (err) {
    console.error('[forgot-password] WorkOS could not create a reset', err);
    return null;
  }
}

/** For Task 9's reset-password route. */
export async function resetWorkosPassword(
  token: string,
  newPassword: string
): Promise<{ ok: true } | AuthFailure> {
  try {
    await (await workos()).userManagement.resetPassword({ token, newPassword });
    return { ok: true };
  } catch (err) {
    const failure = classifyWorkosError(err);
    if (failure.error === 'unknown') console.error('[reset-password] WorkOS refused the reset', err);
    return failure;
  }
}
