import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { workos, workosClientId, type WorkosAuthResponse } from '@/lib/workos';
import { requestMeta } from '@/lib/requestMeta';
import { classifyWorkosError } from '@/lib/workosErrors';
import { PENDING_AUTH_COOKIE, decodePendingAuth } from '@/lib/pendingAuth';
import {
  clearPendingAuth,
  completeSignIn,
  failureResponse,
  readJson,
  workosDisabled,
} from '@/lib/workosFlow';

export async function POST(request: NextRequest) {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const { code } = await readJson(request);
  if (typeof code !== 'string' || !code.trim() || code.trim().length > 20) {
    return failureResponse({ ok: false, error: 'invalid_code' });
  }

  const pending = decodePendingAuth(cookies().get(PENDING_AUTH_COOKIE)?.value);
  if (!pending) return failureResponse({ ok: false, error: 'verification_expired' });

  let response: WorkosAuthResponse;
  try {
    response = await (await workos()).userManagement.authenticateWithEmailVerification({
      clientId: workosClientId(),
      code: code.trim(),
      pendingAuthenticationToken: pending.token,
      ...requestMeta(request.headers),
    });
  } catch (err) {
    const failure = classifyWorkosError(err);
    if (failure.error === 'rate_limited') return failureResponse(failure);
    // WorkOS's wrong-code and expired-code errors are not documented
    // precisely; either way the useful answer is "check it or resend".
    console.error('[auth] email code refused', err);
    return failureResponse({ ok: false, error: 'invalid_code' });
  }

  const done = await completeSignIn(request, response);
  if (done.status === 200) {
    clearPendingAuth();
    await sql`
      UPDATE users SET email_verified = COALESCE(email_verified, NOW())
      WHERE workos_user_id = ${response.user.id}
    `;
  }
  return done;
}
