/**
 * Which sign-in system this deploy runs.
 *
 * AUTH_PROVIDER is the WorkOS cutover switch and also its rollback: set it
 * back to anything but "workos" and redeploy, and NextAuth is live again with
 * every password intact. Unset means NextAuth, so shipping the WorkOS code
 * changes nothing until someone deliberately flips it.
 *
 * Pure and client-safe: the root layout passes the result to the browser.
 */

export type AuthProviderName = 'nextauth' | 'workos';

export function authProvider(
  env: Record<string, string | undefined> = process.env
): AuthProviderName {
  return env.AUTH_PROVIDER?.trim().toLowerCase() === 'workos' ? 'workos' : 'nextauth';
}
