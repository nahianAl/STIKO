/**
 * What a sign-in, sign-up or code attempt can come back with, and what to
 * tell the person. Shared by the API routes (which return these shapes as
 * JSON) and the pages (which show the sentence). Pure and client-safe.
 */

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_verification_required'
  | 'email_taken'
  | 'account_conflict'
  | 'password_rejected'
  | 'invalid_code'
  | 'verification_expired'
  | 'rate_limited'
  | 'unsupported'
  | 'invalid_request'
  | 'unknown';

export type AuthFailureResult = {
  ok: false;
  error: AuthErrorCode;
  /** The address a code was sent to (email_verification_required). */
  email?: string;
  /** A human sentence from the server, where it has a better one than ours. */
  message?: string;
  retryAfterSeconds?: number | null;
};

export type AuthResult = { ok: true } | AuthFailureResult;

const HELP = 'Email hello@stiko.design and we’ll sort it out.';

export function authErrorMessage(result: AuthFailureResult): string {
  switch (result.error) {
    case 'invalid_credentials':
      return 'Invalid email or password';
    case 'email_verification_required':
      return 'Check your email for a code to finish signing in.';
    case 'email_taken':
      return 'Email already in use';
    case 'account_conflict':
      return `This account can’t be signed in to right now. ${HELP}`;
    case 'password_rejected':
      return result.message ?? 'Choose a stronger password: longer, and not one used on other sites.';
    case 'invalid_code':
      return 'That code didn’t work. Check it, or send a new one.';
    case 'verification_expired':
      return 'That code has expired. Sign in again to get a new one.';
    case 'rate_limited':
      return 'Too many attempts. Wait a minute and try again.';
    case 'unsupported':
      return `This account needs a sign-in step Stiko doesn’t support yet. ${HELP}`;
    case 'invalid_request':
      return result.message ?? 'Fill in every field and try again.';
    case 'unknown':
      return result.message ?? 'Something went wrong. Try again in a moment.';
  }
}
