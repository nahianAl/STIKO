/**
 * Turning a WorkOS SDK exception into an outcome Stiko can act on.
 *
 * Duck-typed on the fields @workos-inc/node sets (code, rawData, errors,
 * retryAfter, status) rather than on its classes, so this stays pure and
 * testable, and a class rename in a minor SDK release degrades to 'unknown'
 * instead of crashing a sign-in.
 */
import type { AuthFailureResult } from '@/lib/authMessages';

export type AuthFailure = AuthFailureResult & {
  /** Server-only: finishes a sign-in paused for an email code. */
  pendingAuthenticationToken?: string;
  /** Server-only: used to fetch and re-send that code. */
  emailVerificationId?: string | null;
};

/** Pauses Stiko has no screen for. MFA stays optional and un-enrollable until one exists. */
const UNSUPPORTED = new Set([
  'mfa_enrollment',
  'mfa_challenge',
  'mfa_verification',
  'radar_email_challenge',
  'radar_sms_challenge',
  'sso_required',
  'organization_selection_required',
]);

// UNVERIFIED shape: the WorkOS docs name the password policy but not its error
// code. Task 13 captures the real one against Staging and pins it in the test.
const PASSWORD_POLICY = /password_(strength|policy|too|weak|breach|pwned|history|reuse|length)/;

type Fields = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
  retryAfter?: unknown;
  rawData?: Record<string, unknown>;
  errors?: Array<{ code?: unknown; message?: unknown }>;
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export function classifyWorkosError(err: unknown): AuthFailure {
  if (!err || typeof err !== 'object') return { ok: false, error: 'unknown' };
  const e = err as Fields;
  const code = str(e.code);
  const subErrors = Array.isArray(e.errors) ? e.errors : [];

  if (e.name === 'RateLimitExceededException' || e.status === 429) {
    return {
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds: typeof e.retryAfter === 'number' ? e.retryAfter : null,
    };
  }

  if (code === 'invalid_credentials') return { ok: false, error: 'invalid_credentials' };

  if (code === 'email_verification_required') {
    const token = str(e.rawData?.pending_authentication_token);
    const email = str(e.rawData?.email);
    if (!token || !email) return { ok: false, error: 'unknown' };
    return {
      ok: false,
      error: 'email_verification_required',
      email: email.toLowerCase(),
      pendingAuthenticationToken: token,
      emailVerificationId: str(e.rawData?.email_verification_id) ?? null,
    };
  }

  if (code && UNSUPPORTED.has(code)) return { ok: false, error: 'unsupported' };

  if (subErrors.some((s) => s?.code === 'email_not_available')) {
    return { ok: false, error: 'email_taken' };
  }

  const policyError = subErrors.find((s) => typeof s?.code === 'string' && PASSWORD_POLICY.test(s.code));
  if (policyError) return passwordRejected(str(policyError.message) ?? str(e.message));
  if (code && PASSWORD_POLICY.test(code)) return passwordRejected(str(e.message));

  return { ok: false, error: 'unknown' };
}

// No `message: undefined` key when WorkOS gave no sentence: the page falls back
// to its own wording only if the key is absent.
function passwordRejected(message: string | undefined): AuthFailure {
  return message
    ? { ok: false, error: 'password_rejected', message }
    : { ok: false, error: 'password_rejected' };
}

/** Copies only the fields a browser may see. An allow-list, so a server-only
 *  field added to AuthFailure later cannot leak by default. */
export function publicFailure(failure: AuthFailure): AuthFailureResult {
  const out: AuthFailureResult = { ok: false, error: failure.error };
  if (failure.email !== undefined) out.email = failure.email;
  if (failure.message !== undefined) out.message = failure.message;
  if (failure.retryAfterSeconds !== undefined) out.retryAfterSeconds = failure.retryAfterSeconds;
  return out;
}

export function failureStatus(failure: AuthFailureResult): number {
  switch (failure.error) {
    case 'invalid_credentials':
      return 401;
    case 'email_verification_required':
    case 'unsupported':
      return 403;
    case 'email_taken':
    case 'account_conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'unknown':
      return 502;
    default:
      return 400;
  }
}
